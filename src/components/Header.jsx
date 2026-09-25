import { 
  Gamepad2, 
  ShieldCheck, 
  ShieldAlert, 
  FolderOpen, 
  Play, 
  Plus, 
  UserPlus, 
  RefreshCw,
  GitBranch
} from 'lucide-react';

export default function Header({ 
  project, 
  systemStatus, 
  onRefresh, 
  onOpenSetup, 
  onOpenJoin, 
  onLaunchUE, 
  onOpenExplorer,
  isLoading 
}) {
  const isUe = systemStatus?.isUnrealRunning;
  const ghUser = systemStatus?.github?.user;

  return (
    <header className="border-b border-slate-800 bg-[#0d111a]/80 backdrop-blur-md sticky top-0 z-40 px-6 py-3.5">
      <div className="flex items-center justify-between gap-4">
        {/* Left: Brand & Active Project */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/20 text-white font-black text-xl">
              <Gamepad2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold tracking-tight text-white text-lg">UnrealSync</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  UE5 Shield
                </span>
              </div>
              <p className="text-xs text-slate-400">Zero-Hassle Git & GitHub Collaboration</p>
            </div>
          </div>

          <div className="h-6 w-[1px] bg-slate-800 hidden md:block"></div>

          {/* Current Project Pill */}
          {project ? (
            <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300">
              <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
              <span className="font-medium text-white max-w-[160px] truncate" title={project.path}>
                {project.projectName}
              </span>
              {project.engineVersion && project.engineVersion !== 'Unknown' && (
                <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                  UE {project.engineVersion}
                </span>
              )}
              {project.currentBranch && (
                <span className="flex items-center gap-1 text-[11px] text-cyan-400 bg-cyan-950/60 border border-cyan-800/40 px-2 py-0.5 rounded">
                  <GitBranch className="w-3 h-3" />
                  {project.currentBranch}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-slate-400 italic">No project active</span>
          )}
        </div>

        {/* Center/Right: Engine Guard Status & Actions */}
        <div className="flex items-center gap-3">
          {/* Unreal Engine Status Indicator */}
          <div 
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              isUe 
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' 
                : 'bg-slate-900/60 text-slate-400 border-slate-800'
            }`}
            title={isUe ? "Unreal Engine is running! Files are locked." : "Unreal Engine is closed. Safe to sync/revert."}
          >
            {isUe ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
                <span className="hidden sm:inline">UE5 Running (Locked)</span>
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span className="hidden sm:inline">UE5 Idle (Safe)</span>
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              </>
            )}
          </div>

          {/* Quick Project Actions */}
          {project && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={onLaunchUE}
                className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-colors"
                title="Launch this project in Unreal Engine"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span className="hidden md:inline">Open UE5</span>
              </button>

              <button
                onClick={onOpenExplorer}
                className="p-1.5 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg transition-colors"
                title="Open Project Folder in Explorer"
              >
                <FolderOpen className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Refresh button */}
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-1.5 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg transition-colors disabled:opacity-50"
            title="Refresh status"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>

          {/* New / Clone buttons */}
          <div className="flex items-center gap-1 border-l border-slate-800 pl-3">
            <button
              onClick={onOpenSetup}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-700/60 transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-cyan-400" />
              <span>Setup Project</span>
            </button>
            <button
              onClick={onOpenJoin}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-700/60 transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Join Project</span>
            </button>
          </div>

          {/* GitHub User Badge */}
          {ghUser ? (
            <div className="flex items-center gap-2 border-l border-slate-800 pl-3">
              <img 
                src={ghUser.avatar_url} 
                alt={ghUser.login} 
                className="w-7 h-7 rounded-full border border-cyan-500/40"
              />
              <span className="text-xs font-medium text-slate-300 hidden xl:inline">
                {ghUser.login}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-xs text-slate-400 pl-2">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
