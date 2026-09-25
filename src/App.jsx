import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header.jsx';
import ProjectOverview from './components/ProjectOverview.jsx';
import ChangesView from './components/ChangesView.jsx';
import HistoryView from './components/HistoryView.jsx';
import SetupModal from './components/SetupModal.jsx';
import JoinModal from './components/JoinModal.jsx';
import TeamHub from './components/TeamHub.jsx';
import ConflictAssistant from './components/ConflictAssistant.jsx';
import SyncGuardModal from './components/SyncGuardModal.jsx';
import { 
  FolderPlus, 
  Layers, 
  History, 
  Users, 
  Gamepad2, 
  ShieldCheck, 
  CheckCircle,
  AlertTriangle,
  Sparkles,
  RefreshCw
} from 'lucide-react';

export default function App() {
  const [projectPath, setProjectPath] = useState(() => {
    return localStorage.getItem('unrealsync_active_project') || '';
  });
  const [project, setProject] = useState(null);
  const [gitStatus, setGitStatus] = useState(null);
  const [systemStatus, setSystemStatus] = useState(null);
  const [activeTab, setActiveTab] = useState('changes');

  // Loading & Action states
  const [isLoading, setIsLoading] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [notification, setNotification] = useState(null);

  // Modals
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [isTeamOpen, setIsTeamOpen] = useState(false);
  const [isConflictOpen, setIsConflictOpen] = useState(false);
  const [syncGuardAction, setSyncGuardAction] = useState(null); // 'pull' | 'discard'

  const showToast = (type, message) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  // 1. Fetch system status (Engine running, GitHub login)
  const fetchSystemStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/system/status');
      if (res.ok) {
        const data = await res.json();
        setSystemStatus(data);
      }
    } catch (e) {
      console.error('System status error:', e);
    }
  }, []);

  // 2. Fetch project details
  const fetchProjectData = useCallback(async (pathToCheck) => {
    const targetPath = pathToCheck || projectPath;
    if (!targetPath) return;

    setIsLoading(true);
    try {
      const res = await fetch('/api/project/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: targetPath }),
      });
      if (res.ok) {
        const data = await res.json();
        setProject(data.project);
        setGitStatus(data.gitStatus);
        localStorage.setItem('unrealsync_active_project', targetPath);

        // Auto-open conflict shield if conflicts exist
        if (data.gitStatus?.hasConflicts) {
          setIsConflictOpen(true);
        }
      } else {
        setProject(null);
        setGitStatus(null);
      }
    } catch (e) {
      console.error('Project inspect error:', e);
    } finally {
      setIsLoading(false);
    }
  }, [projectPath]);

  // Initial load & Polling for Unreal Engine process
  useEffect(() => {
    fetchSystemStatus();
    if (projectPath) {
      fetchProjectData(projectPath);
    } else {
      // If no project is selected, open setup modal by default
      setIsSetupOpen(true);
    }

    const interval = setInterval(() => {
      fetchSystemStatus();
    }, 4000);

    return () => clearInterval(interval);
  }, [fetchSystemStatus, fetchProjectData, projectPath]);

  const handleRefresh = async () => {
    await fetchSystemStatus();
    if (projectPath) await fetchProjectData(projectPath);
    showToast('success', 'Workspace refreshed');
  };

  // Push Commits
  const handlePush = async () => {
    if (!projectPath) return;
    setIsPushing(true);
    try {
      const res = await fetch('/api/git/commit-and-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectDir: projectPath,
          message: 'Update Unreal Engine assets and code',
          files: [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to push');
      showToast('success', 'Changes successfully pushed to GitHub!');
      fetchProjectData();
    } catch (e) {
      showToast('error', e.message);
    } finally {
      setIsPushing(false);
    }
  };

  // Pull / Sync
  const handlePullRequest = async (force = false) => {
    if (!projectPath) return;

    if (systemStatus?.isUnrealRunning && !force) {
      setSyncGuardAction('pull');
      return;
    }

    setIsPulling(true);
    try {
      const res = await fetch('/api/git/sync-pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: projectPath, force }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'UE_RUNNING') {
          setSyncGuardAction('pull');
          return;
        }
        throw new Error(data.error || 'Pull failed');
      }

      showToast('success', 'Project successfully updated with latest changes!');
      fetchProjectData();
    } catch (e) {
      showToast('error', e.message);
    } finally {
      setIsPulling(false);
    }
  };

  // Commit and Push
  const handleCommitAndPush = async (message, files) => {
    if (!projectPath) return;
    setIsCommitting(true);
    try {
      const res = await fetch('/api/git/commit-and-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectDir: projectPath,
          message,
          files,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Commit failed');
      showToast('success', `Committed: "${message}" and pushed to Cloud!`);
      fetchProjectData();
    } catch (e) {
      showToast('error', e.message);
    } finally {
      setIsCommitting(false);
    }
  };

  // Discard changes
  const handleDiscard = async (files, force = false) => {
    if (!projectPath) return;

    if (systemStatus?.isUnrealRunning && !force) {
      setSyncGuardAction('discard');
      return;
    }

    try {
      const res = await fetch('/api/git/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: projectPath, files, force }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'UE_RUNNING') {
          setSyncGuardAction('discard');
          return;
        }
        throw new Error(data.error || 'Discard failed');
      }
      showToast('success', 'Uncommitted changes reverted');
      fetchProjectData();
    } catch (e) {
      showToast('error', e.message);
    }
  };

  // Conflict Resolution
  const handleResolveConflict = async (file, resolution) => {
    if (!projectPath) return;
    const res = await fetch('/api/git/resolve-conflict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir: projectPath, file, resolution }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Conflict resolution failed');
    fetchProjectData();
    return data;
  };

  // Launch Unreal Engine
  const handleLaunchUE = async () => {
    if (!project?.path || !project?.uprojectFile) return;
    try {
      await fetch('/api/project/launch-ue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectDir: project.path,
          uprojectFile: project.uprojectFile,
        }),
      });
      showToast('success', 'Launching Unreal Engine 5...');
    } catch (e) {
      showToast('error', e.message);
    }
  };

  // Open Explorer
  const handleOpenExplorer = async () => {
    if (!project?.path) return;
    try {
      await fetch('/api/system/open-explorer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: project.path }),
      });
    } catch (e) {
      console.error(e);
    }
  };

  // Setup / Clone success callbacks
  const handleProjectLoaded = (newPath) => {
    setProjectPath(newPath);
    fetchProjectData(newPath);
    showToast('success', 'Project loaded successfully!');
  };

  return (
    <div className="min-h-screen bg-[#0b0e14] text-slate-100 flex flex-col">
      {/* Toast Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-2xl shadow-2xl border text-xs font-semibold flex items-center gap-2 transition-all ${
          notification.type === 'success' 
            ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/40 shadow-emerald-900/30' 
            : 'bg-rose-950/90 text-rose-200 border-rose-500/40 shadow-rose-900/30'
        }`}>
          {notification.type === 'success' ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-rose-400" />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Main Header */}
      <Header
        project={project}
        systemStatus={systemStatus}
        onRefresh={handleRefresh}
        onOpenSetup={() => setIsSetupOpen(true)}
        onOpenJoin={() => setIsJoinOpen(true)}
        onLaunchUE={handleLaunchUE}
        onOpenExplorer={handleOpenExplorer}
        isLoading={isLoading}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 space-y-6">
        {project ? (
          <>
            {/* Top Project Dashboard Card */}
            <ProjectOverview
              project={project}
              gitStatus={gitStatus}
              onPush={handlePush}
              onPullRequest={() => handlePullRequest(false)}
              onOpenTeam={() => setIsTeamOpen(true)}
              onOpenConflicts={() => setIsConflictOpen(true)}
              isPushing={isPushing}
              isPulling={isPulling}
            />

            {/* Navigation Tabs */}
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <button
                onClick={() => setActiveTab('changes')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'changes'
                    ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Layers className="w-4 h-4" />
                <span>Changes & Commit</span>
                {gitStatus?.changes?.length > 0 && (
                  <span className="bg-cyan-400 text-slate-950 px-1.5 py-0.2 rounded-full text-[10px]">
                    {gitStatus.changes.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('history')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'history'
                    ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <History className="w-4 h-4" />
                <span>Commit History</span>
              </button>

              <button
                onClick={() => setIsTeamOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-all cursor-pointer ml-auto"
              >
                <Users className="w-4 h-4 text-indigo-400" />
                <span>Team Collaborators</span>
              </button>
            </div>

            {/* Tab Contents */}
            {activeTab === 'changes' ? (
              <ChangesView
                changes={gitStatus?.changes || []}
                onCommitAndPush={handleCommitAndPush}
                onDiscard={(files) => handleDiscard(files, false)}
                isCommitting={isCommitting}
              />
            ) : (
              <HistoryView commits={gitStatus?.commits || []} />
            )}
          </>
        ) : (
          /* Empty State: Prompt to select or setup */
          <div className="text-center py-20 px-6 rounded-3xl bg-slate-900/40 border border-dashed border-slate-800 max-w-xl mx-auto my-12">
            <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center justify-center mx-auto mb-4">
              <Gamepad2 className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">No Project Selected</h2>
            <p className="text-xs text-slate-400 mb-6 leading-relaxed">
              Connect your existing Unreal Engine 5 project or join a teammate's game repository to get started with zero-friction version control.
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setIsSetupOpen(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs shadow-xl shadow-cyan-600/25 transition-all cursor-pointer"
              >
                <FolderPlus className="w-4 h-4" />
                <span>Setup My Project</span>
              </button>
              <button
                onClick={() => setIsJoinOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 transition-colors cursor-pointer"
              >
                <Users className="w-4 h-4 text-indigo-400" />
                <span>Join Teammate Project</span>
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      <SetupModal
        isOpen={isSetupOpen}
        onClose={() => setIsSetupOpen(false)}
        onSetupSuccess={handleProjectLoaded}
      />

      <JoinModal
        isOpen={isJoinOpen}
        onClose={() => setIsJoinOpen(false)}
        onCloneSuccess={handleProjectLoaded}
      />

      <TeamHub
        project={project}
        isOpen={isTeamOpen}
        onClose={() => setIsTeamOpen(false)}
      />

      {isConflictOpen && (
        <ConflictAssistant
          conflicts={gitStatus?.changes?.filter((c) => c.isConflict) || []}
          onResolve={handleResolveConflict}
          onClose={() => setIsConflictOpen(false)}
          onOpenExplorer={handleOpenExplorer}
        />
      )}

      <SyncGuardModal
        isOpen={!!syncGuardAction}
        actionType={syncGuardAction || 'pull'}
        onConfirmRetry={async () => {
          setSyncGuardAction(null);
          await fetchSystemStatus();
          if (syncGuardAction === 'pull') handlePullRequest(false);
          else if (syncGuardAction === 'discard') handleDiscard([], false);
        }}
        onCancel={() => setSyncGuardAction(null)}
        onForce={() => {
          const action = syncGuardAction;
          setSyncGuardAction(null);
          if (action === 'pull') handlePullRequest(true);
          else if (action === 'discard') handleDiscard([], true);
        }}
      />
    </div>
  );
}
