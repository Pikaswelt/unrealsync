import React from 'react';
import { ShieldAlert, AlertTriangle, Check, X, RefreshCw } from 'lucide-react';

export default function SyncGuardModal({ 
  isOpen, 
  actionType = 'pull', 
  onConfirmRetry, 
  onCancel, 
  onForce 
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-md rounded-3xl bg-[#0f141f] border-2 border-amber-500/50 p-6 shadow-2xl relative overflow-hidden">
        {/* Glow */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <div>
            <h3 className="font-extrabold text-white text-base">
              Unreal Engine is Running!
            </h3>
            <span className="text-[11px] font-semibold text-amber-400">
              UnrealSync Engine-Guard Active
            </span>
          </div>
        </div>

        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 text-xs text-amber-200/90 space-y-2">
          <p>
            Unreal Engine currently has project files locked in memory. 
            Performing a <strong>{actionType.toUpperCase()}</strong> or reverting files right now can cause asset corruption or file-permission crashes.
          </p>
          <div className="font-semibold text-white pt-1">
            👉 Please save your work in Unreal Editor and close it now.
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={onConfirmRetry}
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>I have closed Unreal Engine — Continue</span>
          </button>

          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 font-medium text-xs border border-slate-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={onForce}
              className="py-2 px-3 rounded-xl bg-transparent hover:bg-red-500/10 text-slate-500 hover:text-red-400 font-mono text-[10px] transition-colors cursor-pointer"
              title="Only choose this if you are sure files are not locked"
            >
              Force Anyway (Risky)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
