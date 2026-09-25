import React from 'react';
import { GitCommit, Calendar, User, CheckCircle2 } from 'lucide-react';

export default function HistoryView({ commits = [] }) {
  return (
    <div className="rounded-2xl bg-[#0e131d]/90 border border-slate-800 p-6 shadow-xl backdrop-blur-xl">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <GitCommit className="w-4 h-4 text-cyan-400" />
          <h2 className="text-base font-bold text-white">Recent Project History</h2>
        </div>
        <span className="text-xs text-slate-500 font-mono">Last {commits.length} commits</span>
      </div>

      <div className="mt-4 space-y-3">
        {commits.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-xs">
            No commit history available yet. Make your first commit above!
          </div>
        ) : (
          commits.map((commit, idx) => (
            <div
              key={commit.hash || idx}
              className="flex items-start justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800/60 text-xs hover:border-slate-700/80 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-slate-900 text-cyan-400 border border-slate-800 flex items-center justify-center shrink-0 mt-0.5">
                  <GitCommit className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="font-semibold text-slate-200">
                    {commit.message}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1">
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {commit.author}
                    </span>
                    <span className="flex items-center gap-1 text-slate-400">
                      <Calendar className="w-3 h-3" />
                      {commit.date}
                    </span>
                  </div>
                </div>
              </div>

              <span className="font-mono text-[10px] text-cyan-400/80 bg-cyan-950/60 border border-cyan-800/40 px-2 py-0.5 rounded shrink-0">
                {commit.hash}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
