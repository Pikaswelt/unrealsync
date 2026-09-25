import { invoke } from "@tauri-apps/api/core";

export type Account = {
  kind: "github" | "server";
  baseUrl: string;
  login: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
};

export type Project = { name: string; path: string; remoteUrl: string; githubRepo?: string | null };

export type AppSnapshot = {
  account: Account | null;
  projects: Project[];
  activeProject: Project | null;
  autoLock: boolean;
  closeToTray: boolean;
  githubClientId: string | null;
  gitVersion: string;
  bundledGit: boolean;
};

export type FolderCheck = {
  exists: boolean;
  uproject: string | null;
  inOnedrive: boolean;
  isGitRepo: boolean;
  totalBytes: number;
  fileCount: number;
  bigFiles: [string, number][];
  sourceFiles: [string, number][];
};

export type S3Location = { endpoint: string; bucket: string; region: string; prefix: string };
export type S3Keys = { accessKey: string; secretKey: string };
export type StorageInput = { type: "lfs" } | { type: "s3"; location: S3Location; keys: S3Keys };

export type Change = {
  path: string;
  oldPath: string | null;
  status: "modified" | "added" | "deleted" | "renamed" | "conflict";
  kind: "asset" | "map" | "code" | "config" | "other";
  asset: string | null;
  size: number | null;
};

export type CommitInfo = {
  hash: string;
  short: string;
  author: string;
  date: string;
  message: string;
  files: [string, string][];
};

export type Status = {
  branch: string;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
  changes: Change[];
  conflicts: string[];
  rebaseInProgress: boolean;
  unrealRunning: boolean;
  incoming: CommitInfo[];
  needsAccessCode: boolean;
};

export type LockInfo = { id: string; path: string; owner: string; lockedAt: string; ours: boolean };
export type SyncResult = { result: "done" | "conflict"; conflicts: string[]; message: string };

export type RemoteRepo = {
  fullName: string;
  name: string;
  cloneUrl: string;
  htmlUrl: string;
  private: boolean;
  owner: string;
  updatedAt: string;
  sizeKb: number;
};
export type Invitation = { id: number; repo: RemoteRepo; inviter: string };
export type Collaborator = { login: string; avatarUrl: string | null; pending: boolean };
export type DeviceCode = { deviceCode: string; userCode: string; verificationUri: string; interval: number; expiresIn: number };

export type StorageInfo = {
  backend: "github" | "server" | "s3";
  location: (S3Location & { type?: string }) | null;
  lfsBytes: number;
  lfsFiles: number;
  localCacheBytes: number;
  quotaBytes: number | null;
  hasKeys: boolean;
};

export type OpProgress = { op: string; step: string; message: string; percent: number | null };

export const api = {
  appState: () => invoke<AppSnapshot>("get_app_state"),
  updateSettings: (patch: { autoLock?: boolean; closeToTray?: boolean; githubClientId?: string }) =>
    invoke<void>("update_settings", { patch }),
  selectProject: (path: string) => invoke<boolean>("select_project", { path }),
  removeProject: (path: string) => invoke<void>("remove_project", { path }),
  openPath: (path: string) => invoke<void>("open_path", { path }),
  openUnreal: () => invoke<void>("open_unreal"),
  notify: (title: string, body: string) => invoke<void>("notify", { title, body }),

  deviceStart: () => invoke<DeviceCode>("github_device_start"),
  devicePoll: (deviceCode: string) => invoke<Account | null>("github_device_poll", { deviceCode }),
  tokenLogin: (token: string) => invoke<Account>("github_token_login", { token }),
  serverLogin: (baseUrl: string, login: string, token: string, email?: string) =>
    invoke<Account>("server_login", { baseUrl, login, token, email }),
  logout: () => invoke<void>("logout"),
  listRepos: () => invoke<RemoteRepo[]>("github_list_repos"),
  invitations: () => invoke<Invitation[]>("github_invitations"),
  acceptInvitation: (id: number) => invoke<void>("github_accept_invitation", { id }),
  teamMembers: () => invoke<Collaborator[]>("team_members"),
  teamInvite: (login: string) => invoke<void>("team_invite", { login }),

  checkFolder: (path: string) => invoke<FolderCheck>("check_folder", { path }),
  createProject: (input: {
    path: string;
    repoName: string;
    private: boolean;
    storage: StorageInput;
    serverRepoUrl?: string;
    invite?: string;
  }) => invoke<Project>("create_project", { input }),
  joinProject: (input: { cloneUrl: string; parentDir: string; folderName: string; githubRepo?: string | null }) =>
    invoke<{ project: Project; needsAccessCode: boolean }>("join_project", { input }),
  submitAccessCode: (code: string) => invoke<void>("submit_access_code", { code }),

  status: () => invoke<Status>("get_status"),
  fetchRemote: () => invoke<Status>("fetch_remote"),
  pull: (force: boolean) => invoke<SyncResult>("pull_changes", { force }),
  upload: (paths: string[], message: string, keepLocks: boolean) =>
    invoke<SyncResult>("upload_changes", { paths, message, keepLocks }),
  resolveConflict: (path: string, keep: "mine" | "theirs") => invoke<string[]>("resolve_conflict", { path, keep }),
  continueAfterConflicts: () => invoke<SyncResult>("continue_after_conflicts"),
  abortSync: () => invoke<void>("abort_sync"),
  discard: (paths: string[]) => invoke<void>("discard_changes", { paths }),
  history: (limit?: number) => invoke<CommitInfo[]>("get_history", { limit }),

  locks: () => invoke<LockInfo[]>("get_locks"),
  lock: (paths: string[]) => invoke<LockInfo[]>("lock_files", { paths }),
  unlock: (paths: string[], force: boolean) => invoke<LockInfo[]>("unlock_files", { paths, force }),
  listAssets: (query: string) => invoke<string[]>("list_assets", { query }),

  storageInfo: () => invoke<StorageInfo>("storage_info"),
  testS3: (location: S3Location, keys: S3Keys) => invoke<void>("test_s3", { location, keys }),
  accessCode: () => invoke<string>("get_access_code"),
  migrate: (target: StorageInput) => invoke<void>("migrate_storage", { target }),
  pruneCache: () => invoke<string>("prune_cache"),
};

export function errText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
