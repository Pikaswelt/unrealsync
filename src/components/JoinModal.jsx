import React, { useState } from 'react';
import { DownloadCloud, FolderDown, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function JoinModal({ isOpen, onClose, onCloneSuccess }) {
  const [repoUrl, setRepoUrl] = useState('');
  const [destinationDir, setDestinationDir] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleClone = async (e) => {
    e.preventDefault();
    if (!repoUrl || !destinationDir) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/project/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: repoUrl.trim(), destinationDir: destinationDir.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to clone repository');
      }

      onCloneSuccess(destinationDir.trim());
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-lg rounded-3xl bg-[#0f141f] border border-indigo-500/30 p-6 shadow-2xl relative overflow-hidden">
        {/* Glow */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white font-bold">
              <DownloadCloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white">Join / Clone Team Project</h2>
              <p className="text-xs text-slate-400">Clone an existing Unreal Engine 5 repo to your PC</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-xs text-slate-400 hover:text-white px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleClone} className="mt-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">
              GitHub Repository URL:
            </label>
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/Username/MyGame.git"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
              required
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">
              Destination Folder on your PC:
            </label>
            <input
              type="text"
              value={destinationDir}
              onChange={(e) => setDestinationDir(e.target.value)}
              placeholder="C:\Users\Chris\Documents\Unreal Projects\MyGame"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading || !repoUrl || !destinationDir}
            className="w-full mt-2 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-black text-xs shadow-xl shadow-indigo-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Cloning project and verifying .uproject...</span>
              </>
            ) : (
              <>
                <FolderDown className="w-4 h-4" />
                <span>Clone & Open Project</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
