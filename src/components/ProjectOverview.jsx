import React from 'react';
import { 
  ArrowUpCircle, 
  ArrowDownCircle, 
  FileCode, 
  AlertTriangle, 
  Share2, 
  CloudCheck, 
  Sparkles,
  GitCommit
} from 'lucide-react';

export default function ProjectOverview({ 
  project, 
  gitStatus, 
  onPush, 
  onPullRequest, 
  onOpenTeam, 
  onOpenConflicts,
  isPushing, 
  isPulling 
}) {
  if (!project) return null;

  const ahead = gitStatus?.ahead || 0;
  const behind = gitStatus?.behind || 0;
  const changesCount = gitStatus?.changes?.length || 0;
  const hasConflicts = gitStatus?.hasConflicts;

  return (
    <div className="space-y-4">
      {/* Conflict Warning Banner if Active */}
      {hasConflicts && (
        <div className="bg-red-500/10 border-2 border-red-500/50 rounded-2xl p-4 flex items-center justify-between shadow-xl shadow-red-950/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/20 text-red-400 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-6 h-6 animate-bounce" />
            </div>
            <div>
              <h3 className="font-bold text-red-200 text-sm">Merge Conflict Detected!</h3>
              <p className="text-xs text-red-300/80">
                Binary or text files have conflicting changes from your teammate. Use the Conflict Shield to resolve safely.
              </p>
            </div>
          </div>
          <button
            onClick={onOpenConflicts}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-red-600/30 transition-all cursor-pointer"
          >
            Open Conflict Shield 🛡️
          </button>
        </div>
      )}

      {/* Main Project Card */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-900/90 to-[#0e131d]/90 border border-slate-800 p-6 shadow-2xl backdrop-blur-xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          {/* Project Details */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-black text-white tracking-tight">
                {project.projectName}
              </h1>
              {project.gitRemote ? (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2.5 py-0.5 rounded-full">
                  <CloudCheck className="w-3 h-3" />
                  Cloud Synced
                </span>
              ) : (
                <span className="text-[11px] font-semibold text-amber-400 bg-amber-950/60 border border-amber-800/40 px-2.5 py-0.5 rounded-full">
                  Local Only
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 font-mono select-all">
              {project.path}
            </p>
            {project.repoOwnerRepo && (
              <a 
                href={`https://github.com/${project.repoOwnerRepo}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-cyan-400 hover:underline inline-flex items-center gap-1 mt-1 font-medium"
              >
                github.com/{project.repoOwnerRepo} ↗
              </a>
            )}
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Push Button */}
            <button
              onClick={onPush}
              disabled={isPushing || ahead === 0}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs shadow-lg transition-all ${
                ahead > 0
                  ? 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-cyan-600/25 ring-2 ring-cyan-400/20 scale-[1.02]'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 border border-slate-700/50'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              <ArrowUpCircle className={`w-4 h-4 ${isPushing ? 'animate-bounce' : ''}`} />
              <span>{isPushing ? 'Pushing...' : 'Push to Cloud'}</span>
              {ahead > 0 && (
                <span className="ml-1 bg-cyan-400 text-slate-950 text-[10px] font-black px-1.5 py-0.2 rounded-full">
                  +{ahead}
                </span>
              )}
            </button>

            {/* Sync / Pull Button */}
            <button
              onClick={onPullRequest}
              disabled={isPulling}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs shadow-lg transition-all ${
                behind > 0
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/25 ring-2 ring-emerald-400/20 animate-pulse'
                  : 'bg-slate-800/80 text-slate-300 hover:text-white border border-slate-700/50'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              <ArrowDownCircle className={`w-4 h-4 ${isPulling ? 'animate-spin' : ''}`} />
              <span>{isPulling ? 'Pulling...' : 'Pull Updates'}</span>
              {behind > 0 && (
                <span className="ml-1 bg-emerald-400 text-slate-950 text-[10px] font-black px-1.5 py-0.2 rounded-full">
                  {behind} new
                </span>
              )}
            </button>

            {/* Team Hub */}
            <button
              onClick={onOpenTeam}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60 shadow transition-colors"
            >
              <Share2 className="w-4 h-4 text-indigo-400" />
              <span>Team & Access</span>
            </button>
          </div>
        </div>

        {/* Status Metrics Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 pt-5 border-t border-slate-800/80">
          <div className="bg-slate-950/40 rounded-xl p-3 border border-slate-800/40">
            <span className="text-[11px] text-slate-400 font-medium">Unpushed Commits</span>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xl font-black ${ahead > 0 ? 'text-cyan-400' : 'text-slate-300'}`}>
                {ahead}
              </span>
              <span className="text-[10px] text-slate-400">ready to push</span>
            </div>
          </div>

          <div className="bg-slate-950/40 rounded-xl p-3 border border-slate-800/40">
            <span className="text-[11px] text-slate-400 font-medium">Pending Updates</span>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xl font-black ${behind > 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                {behind}
              </span>
              <span className="text-[10px] text-slate-400">from teammates</span>
            </div>
          </div>

          <div className="bg-slate-950/40 rounded-xl p-3 border border-slate-800/40">
            <span className="text-[11px] text-slate-400 font-medium">Uncommitted Changes</span>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xl font-black ${changesCount > 0 ? 'text-amber-400' : 'text-slate-300'}`}>
                {changesCount}
              </span>
              <span className="text-[10px] text-slate-400">files modified</span>
            </div>
          </div>

          <div className="bg-slate-950/40 rounded-xl p-3 border border-slate-800/40">
            <span className="text-[11px] text-slate-400 font-medium">Git Safety Protection</span>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs font-bold text-cyan-400 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                Active
              </span>
              <span className="text-[10px] text-slate-400">.gitignore & Guard</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
