import express from 'express';
import cors from 'cors';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { UE5_GITIGNORE } from './ue5_gitignore.js';
import { UE5_GITATTRIBUTES_STANDARD, UE5_GITATTRIBUTES_LFS } from './ue5_gitattributes.js';

const execAsync = promisify(exec);
const app = express();
const PORT = 3088;

app.use(cors());
app.use(express.json());

// Helper: Run shell command in a specific working directory
async function runCmd(cmd, cwd = process.cwd()) {
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd, maxBuffer: 1024 * 1024 * 16 });
    return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stdout: error.stdout ? error.stdout.trim() : '',
      stderr: error.stderr ? error.stderr.trim() : '',
    };
  }
}

// 1. Process Monitor: Check if Unreal Editor is running
async function isUnrealRunning() {
  const result = await runCmd('tasklist /FI "IMAGENAME eq UnrealEditor.exe" /FO CSV /NH');
  if (result.success && result.stdout.toLowerCase().includes('unrealeditor.exe')) {
    return true;
  }
  return false;
}

// 2. GitHub CLI Auth & User status
async function getGitHubUser() {
  const authRes = await runCmd('gh auth status');
  const userRes = await runCmd('gh api user --jq "{login: .login, name: .name, avatar_url: .avatar_url, html_url: .html_url}"');

  let user = null;
  if (userRes.success) {
    try {
      user = JSON.parse(userRes.stdout);
    } catch (e) {
      // fallback
    }
  }

  return {
    isLoggedIn: userRes.success && !!user,
    user: user || null,
    details: authRes.stdout || authRes.stderr,
  };
}

// 3. Inspect UE5 Project
async function inspectProject(projectDir) {
  if (!fs.existsSync(projectDir)) {
    throw new Error('Project directory does not exist');
  }

  // Find .uproject file
  const files = fs.readdirSync(projectDir);
  const uprojectFile = files.find((f) => f.endsWith('.uproject'));

  let uprojectData = null;
  if (uprojectFile) {
    try {
      const content = fs.readFileSync(path.join(projectDir, uprojectFile), 'utf8');
      uprojectData = JSON.parse(content);
    } catch (e) {
      uprojectData = { rawName: uprojectFile };
    }
  }

  const hasGit = fs.existsSync(path.join(projectDir, '.git'));
  const hasGitignore = fs.existsSync(path.join(projectDir, '.gitignore'));
  const hasGitattributes = fs.existsSync(path.join(projectDir, '.gitattributes'));

  let gitRemote = null;
  let currentBranch = null;
  let repoOwnerRepo = null;

  if (hasGit) {
    const remoteRes = await runCmd('git remote get-url origin', projectDir);
    if (remoteRes.success) {
      gitRemote = remoteRes.stdout;
      // Extract owner/repo
      const match = gitRemote.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/i);
      if (match) {
        repoOwnerRepo = `${match[1]}/${match[2]}`;
      }
    }

    const branchRes = await runCmd('git rev-parse --abbrev-ref HEAD', projectDir);
    if (branchRes.success) {
      currentBranch = branchRes.stdout;
    }
  }

  return {
    path: projectDir,
    uprojectFile: uprojectFile || null,
    projectName: uprojectFile ? path.basename(uprojectFile, '.uproject') : path.basename(projectDir),
    engineVersion: uprojectData?.EngineAssociation || 'Unknown',
    hasGit,
    hasGitignore,
    hasGitattributes,
    gitRemote,
    currentBranch,
    repoOwnerRepo,
  };
}

// 4. Git Status & Categorization
async function getProjectGitStatus(projectDir) {
  if (!fs.existsSync(path.join(projectDir, '.git'))) {
    return { hasGit: false };
  }

  const branchRes = await runCmd('git rev-parse --abbrev-ref HEAD', projectDir);
  const branch = branchRes.success ? branchRes.stdout : 'main';

  // Ahead / behind count
  let ahead = 0;
  let behind = 0;
  const countRes = await runCmd(`git rev-list --left-right --count origin/${branch}...${branch}`, projectDir);
  if (countRes.success) {
    const parts = countRes.stdout.split(/\s+/);
    if (parts.length >= 2) {
      behind = parseInt(parts[0], 10) || 0;
      ahead = parseInt(parts[1], 10) || 0;
    }
  }

  // File status
  const statusRes = await runCmd('git status --porcelain=v1', projectDir);
  const rawStatus = statusRes.success ? statusRes.stdout.split('\n').filter(Boolean) : [];

  const changes = [];
  let hasConflicts = false;

  for (const line of rawStatus) {
    const code = line.substring(0, 2);
    const filePath = line.substring(3).trim().replace(/^"|"$/g, '');
    const ext = path.extname(filePath).toLowerCase();

    // Categorize
    let category = 'other';
    let isBinary = false;
    let isDangerousMerge = false;

    if (ext === '.uasset') {
      category = 'blueprint';
      isBinary = true;
      if (filePath.toLowerCase().includes('character') || filePath.toLowerCase().includes('player') || filePath.toLowerCase().includes('gamemode')) {
        isDangerousMerge = true;
      }
    } else if (ext === '.umap') {
      category = 'level';
      isBinary = true;
      isDangerousMerge = true;
    } else if (['.cpp', '.h', '.cs'].includes(ext)) {
      category = 'code';
    } else if (['.ini', '.config'].includes(ext)) {
      category = 'config';
    } else if (['.png', '.fbx', '.obj', '.wav', '.mp3', '.tga', '.exr'].includes(ext)) {
      category = 'asset';
      isBinary = true;
    }

    const isConflict = ['UU', 'AA', 'UD', 'DU', 'DD', 'AU', 'UA'].includes(code);
    if (isConflict) hasConflicts = true;

    changes.push({
      status: code,
      file: filePath,
      category,
      isBinary,
      isDangerousMerge,
      isConflict,
    });
  }

  // Recent commits
  const logRes = await runCmd('git log -n 8 --pretty=format:"%h|%an|%ar|%s"', projectDir);
  const commits = [];
  if (logRes.success && logRes.stdout) {
    logRes.stdout.split('\n').forEach((line) => {
      const [hash, author, date, message] = line.split('|');
      if (hash) {
        commits.push({ hash, author, date, message });
      }
    });
  }

  return {
    hasGit: true,
    branch,
    ahead,
    behind,
    changes,
    hasConflicts,
    commits,
  };
}

// ================= API ROUTES =================

// GET /api/system/status
app.get('/api/system/status', async (req, res) => {
  const isUe = await isUnrealRunning();
  const gh = await getGitHubUser();
  res.json({
    isUnrealRunning: isUe,
    github: gh,
  });
});

// POST /api/project/inspect
app.post('/api/project/inspect', async (req, res) => {
  try {
    const { projectDir } = req.body;
    if (!projectDir) return res.status(400).json({ error: 'Missing projectDir' });

    const info = await inspectProject(projectDir);
    const gitStatus = info.hasGit ? await getProjectGitStatus(projectDir) : null;

    res.json({
      project: info,
      gitStatus,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/project/init-and-push
app.post('/api/project/init-and-push', async (req, res) => {
  const { projectDir, repoName, isPrivate = true, useLfs = false, createRemote = true } = req.body;
  if (!projectDir) return res.status(400).json({ error: 'Missing projectDir' });

  try {
    // 1. Write .gitignore
    const gitignorePath = path.join(projectDir, '.gitignore');
    fs.writeFileSync(gitignorePath, UE5_GITIGNORE, 'utf8');

    // 2. Write .gitattributes
    const gitattrPath = path.join(projectDir, '.gitattributes');
    fs.writeFileSync(gitattrPath, useLfs ? UE5_GITATTRIBUTES_LFS : UE5_GITATTRIBUTES_STANDARD, 'utf8');

    // 3. Git init & configuration
    await runCmd('git init -b main', projectDir);
    await runCmd('git config core.autocrlf false', projectDir);

    // 4. Git add & commit
    await runCmd('git add .gitignore .gitattributes', projectDir);
    await runCmd('git add .', projectDir);
    const commitRes = await runCmd('git commit -m "Initial Unreal Engine 5 setup via UnrealSync"', projectDir);

    let remoteCreated = false;
    let remoteUrl = null;

    // 5. Create GitHub Repo via gh CLI if requested
    if (createRemote && repoName) {
      const visibilityFlag = isPrivate ? '--private' : '--public';
      const ghRes = await runCmd(`gh repo create "${repoName}" ${visibilityFlag} --source=. --remote=origin --push`, projectDir);
      if (ghRes.success) {
        remoteCreated = true;
        const remoteGet = await runCmd('git remote get-url origin', projectDir);
        remoteUrl = remoteGet.stdout;
      } else {
        // If repo already exists or failed, attempt setting remote
        return res.json({
          success: true,
          localInit: true,
          remoteWarning: ghRes.error || ghRes.stderr,
          message: 'Local git setup successful, but GitHub repo creation returned a notice.',
        });
      }
    }

    res.json({
      success: true,
      remoteCreated,
      remoteUrl,
      message: 'Unreal Engine 5 project successfully initialized with Version Control!',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/git/commit-and-push
app.post('/api/git/commit-and-push', async (req, res) => {
  const { projectDir, message, files = [] } = req.body;
  if (!projectDir || !message) return res.status(400).json({ error: 'Missing parameters' });

  try {
    if (files.length > 0) {
      for (const f of files) {
        await runCmd(`git add "${f}"`, projectDir);
      }
    } else {
      await runCmd('git add -A', projectDir);
    }

    // Escape double quotes in message
    const cleanMsg = message.replace(/"/g, '\\"');
    const commitRes = await runCmd(`git commit -m "${cleanMsg}"`, projectDir);
    if (!commitRes.success && !commitRes.stdout.includes('nothing to commit')) {
      return res.status(500).json({ error: commitRes.error || commitRes.stderr });
    }

    // Push
    const branchRes = await runCmd('git rev-parse --abbrev-ref HEAD', projectDir);
    const branch = branchRes.stdout || 'main';
    const pushRes = await runCmd(`git push origin ${branch}`, projectDir);

    res.json({
      success: true,
      commit: commitRes.stdout,
      push: pushRes.stdout || pushRes.stderr,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/git/sync-pull
app.post('/api/git/sync-pull', async (req, res) => {
  const { projectDir, force = false } = req.body;
  if (!projectDir) return res.status(400).json({ error: 'Missing projectDir' });

  // Guard: check if Unreal Engine is running
  const ueRunning = await isUnrealRunning();
  if (ueRunning && !force) {
    return res.status(409).json({
      code: 'UE_RUNNING',
      error: 'Unreal Engine is currently running. Please save and close the editor before pulling to prevent locked files.',
    });
  }

  try {
    const branchRes = await runCmd('git rev-parse --abbrev-ref HEAD', projectDir);
    const branch = branchRes.stdout || 'main';

    const pullRes = await runCmd(`git pull origin ${branch}`, projectDir);
    if (!pullRes.success) {
      return res.status(500).json({
        error: pullRes.error || pullRes.stderr,
        details: pullRes.stdout,
      });
    }

    res.json({ success: true, output: pullRes.stdout });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/git/discard
app.post('/api/git/discard', async (req, res) => {
  const { projectDir, files = [], force = false } = req.body;
  if (!projectDir) return res.status(400).json({ error: 'Missing projectDir' });

  const ueRunning = await isUnrealRunning();
  if (ueRunning && !force) {
    return res.status(409).json({
      code: 'UE_RUNNING',
      error: 'Unreal Engine is running. Reverting files while they are open in the editor can cause corruption.',
    });
  }

  try {
    if (files.length > 0) {
      for (const f of files) {
        await runCmd(`git restore "${f}"`, projectDir);
        await runCmd(`git clean -fd "${f}"`, projectDir);
      }
    } else {
      await runCmd('git restore .', projectDir);
      await runCmd('git clean -fd', projectDir);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/git/resolve-conflict
app.post('/api/git/resolve-conflict', async (req, res) => {
  const { projectDir, file, resolution } = req.body;
  // resolution: 'ours' | 'theirs' | 'smart-rescue'
  if (!projectDir || !file || !resolution) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    let backupPath = null;

    if (resolution === 'smart-rescue') {
      const backupDir = path.join(projectDir, 'Saved', 'Conflict_Backups');
      fs.mkdirSync(backupDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = path.basename(file);
      backupPath = path.join(backupDir, `${timestamp}_MINE_${filename}`);

      const fullSourcePath = path.join(projectDir, file);
      if (fs.existsSync(fullSourcePath)) {
        fs.copyFileSync(fullSourcePath, backupPath);
      }

      // After backing up local version, take remote version
      await runCmd(`git checkout --theirs -- "${file}"`, projectDir);
      await runCmd(`git add "${file}"`, projectDir);
    } else if (resolution === 'ours') {
      await runCmd(`git checkout --ours -- "${file}"`, projectDir);
      await runCmd(`git add "${file}"`, projectDir);
    } else if (resolution === 'theirs') {
      await runCmd(`git checkout --theirs -- "${file}"`, projectDir);
      await runCmd(`git add "${file}"`, projectDir);
    }

    res.json({
      success: true,
      resolution,
      backupPath,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/team/collaborators
app.post('/api/team/collaborators', async (req, res) => {
  const { repoOwnerRepo } = req.body;
  if (!repoOwnerRepo) return res.status(400).json({ error: 'Missing repoOwnerRepo' });

  try {
    const listRes = await runCmd(`gh api "repos/${repoOwnerRepo}/collaborators" --jq "[.[] | {login: .login, avatar_url: .avatar_url, permissions: .permissions}]"`);
    if (listRes.success) {
      res.json({ collaborators: JSON.parse(listRes.stdout) });
    } else {
      res.json({ collaborators: [] });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/team/invite
app.post('/api/team/invite', async (req, res) => {
  const { repoOwnerRepo, username } = req.body;
  if (!repoOwnerRepo || !username) return res.status(400).json({ error: 'Missing parameters' });

  try {
    const inviteRes = await runCmd(`gh api --method PUT "repos/${repoOwnerRepo}/collaborators/${username}" -f permission=push`);
    if (inviteRes.success) {
      res.json({ success: true, message: `Invitation sent to ${username}!` });
    } else {
      res.status(500).json({ error: inviteRes.error || inviteRes.stderr });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/project/clone
app.post('/api/project/clone', async (req, res) => {
  const { repoUrl, destinationDir } = req.body;
  if (!repoUrl || !destinationDir) return res.status(400).json({ error: 'Missing parameters' });

  try {
    fs.mkdirSync(destinationDir, { recursive: true });
    const cloneRes = await runCmd(`git clone "${repoUrl}" .`, destinationDir);
    if (!cloneRes.success) {
      return res.status(500).json({ error: cloneRes.error || cloneRes.stderr });
    }

    const info = await inspectProject(destinationDir);
    res.json({ success: true, project: info });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/project/launch-ue
app.post('/api/project/launch-ue', async (req, res) => {
  const { projectDir, uprojectFile } = req.body;
  if (!projectDir || !uprojectFile) return res.status(400).json({ error: 'Missing parameters' });

  const fullPath = path.join(projectDir, uprojectFile);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });

  // On Windows, start launches default app for .uproject
  runCmd(`cmd /c start "" "${fullPath}"`);
  res.json({ success: true, message: 'Unreal Engine launched!' });
});

// POST /api/system/open-explorer
app.post('/api/system/open-explorer', async (req, res) => {
  const { folderPath } = req.body;
  if (folderPath && fs.existsSync(folderPath)) {
    runCmd(`explorer.exe "${folderPath}"`);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Path not found' });
  }
});

app.listen(PORT, () => {
  console.log(`🎮 UnrealSync Backend running on http://localhost:${PORT}`);
});
