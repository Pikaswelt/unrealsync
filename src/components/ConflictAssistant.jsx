import React, { useState } from 'react';
import { 
  AlertOctagon, 
  ShieldAlert, 
  Download, 
  Upload, 
  LifeBuoy, 
  FolderCheck, 
  ArrowRight,
  ExternalLink,
  CheckCircle2
} from 'lucide-react';

export default function ConflictAssistant({ 
  conflicts = [], 
  onResolve, 
  onClose,
  onOpenExplorer 
}) {
  const [activeFile, setActiveFile] = useState(conflicts[0]?.file || null);
  const [resolving, setResolving] = useState(false);
  const [resolvedStatus, setResolvedStatus] = useState(null);

  const handleResolveAction = async (resolution) => {
    if (!activeFile) return;
    setResolving(true);
    try {
      const res = await onResolve(activeFile, resolution);
      setResolvedStatus(res);
    } catch (e) {
      console.error(e);
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-3xl rounded-3xl bg-[#0f141f] border-2 border-red-500/40 p-6 shadow-2xl relative overflow-hidden">
        {/* Glow */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-red-500/10 rounded-full blur-3xl pointer-events-none"></div>

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/20 text-red-400 flex items-center justify-center">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white flex items-center gap-2">
                <span>UE5 Conflict Shield</span>
                <span className="text-xs bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full font-bold">
                  {conflicts.length} Conflicted File{conflicts.length > 1 ? 's' : ''}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Binary merge conflict detected in Unreal Engine assets. Resolve safely without losing work.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer"
          >
            Close
          </button>
        </div>

        {/* Success Notice if resolved */}
        {resolvedStatus && (
          <div className="mt-4 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200">
            <div className="flex items-center gap-2 font-bold text-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Conflict resolved for {activeFile}!</span>
            </div>
            {resolvedStatus.backupPath && (
              <div className="mt-2 space-y-1">
                <p className="text-emerald-300">
                  📁 Your local work was backed up to:
                </p>
                <code className="block bg-slate-950 p-2 rounded text-[11px] font-mono text-cyan-300 break-all">
                  {resolvedStatus.backupPath}
                </code>
                <p className="text-slate-400 text-[11px] mt-1">
                  💡 You can now launch Unreal Engine and copy any custom nodes or assets from this backup.
                </p>
              </div>
            )}
          </div>
        )}

        {/* File Selector */}
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {conflicts.map((item) => (
            <button
              key={item.file}
              onClick={() => {
                setActiveFile(item.file);
                setResolvedStatus(null);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono transition-all ${
                activeFile === item.file
                  ? 'bg-red-500/20 text-red-200 border border-red-500/40 font-bold'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              {item.file}
            </button>
          ))}
        </div>

        {/* Resolution Options */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Option 1: Keep Mine */}
          <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-4 flex flex-col justify-between hover:border-slate-700 transition-all">
            <div>
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center mb-2">
                <Upload className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-slate-200 text-sm">Keep My Version</h3>
              <p className="text-xs text-slate-400 mt-1">
                Prioritizes your local changes. Overwrites whatever changes your teammate made to this asset.
              </p>
            </div>
            <button
              onClick={() => handleResolveAction('ours')}
              disabled={resolving}
              className="mt-4 w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
            >
              Use My File
            </button>
          </div>

          {/* Option 2: Keep Theirs */}
          <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-4 flex flex-col justify-between hover:border-slate-700 transition-all">
            <div>
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center mb-2">
                <Download className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-slate-200 text-sm">Keep Teammate's Version</h3>
              <p className="text-xs text-slate-400 mt-1">
                Discards your local changes on this file and accepts your teammate's cloud version.
              </p>
            </div>
            <button
              onClick={() => handleResolveAction('theirs')}
              disabled={resolving}
              className="mt-4 w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
            >
              Use Cloud File
            </button>
          </div>

          {/* Option 3: Smart Rescue (Recommended!) */}
          <div className="rounded-2xl bg-gradient-to-b from-cyan-950/40 to-slate-900 border-2 border-cyan-500/40 p-4 flex flex-col justify-between shadow-lg shadow-cyan-950/30">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
                  <LifeBuoy className="w-4 h-4" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-wider bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full">
                  Recommended
                </span>
              </div>
              <h3 className="font-bold text-white text-sm">Smart Rescue & Backup</h3>
              <p className="text-xs text-slate-300/80 mt-1">
                Saves your work to a dedicated backup folder, applies your teammate's version, and lets you merge nodes in UE5.
              </p>
            </div>
            <button
              onClick={() => handleResolveAction('smart-rescue')}
              disabled={resolving}
              className="mt-4 w-full py-2 px-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs shadow-md shadow-cyan-600/30 transition-all disabled:opacity-50 cursor-pointer"
            >
              {resolving ? 'Backing up...' : 'Smart Backup & Accept'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
