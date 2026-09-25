import React, { useState } from 'react';
import { 
  FolderSearch, 
  Sparkles, 
  Lock, 
  Globe, 
  Check, 
  AlertCircle, 
  Loader2, 
  Gamepad2,
  FolderGit2
} from 'lucide-react';

export default function SetupModal({ isOpen, onClose, onSetupSuccess }) {
  const [projectPath, setProjectPath] = useState('');
  const [repoName, setRepoName] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [useLfs, setUseLfs] = useState(false);
  const [createRemote, setCreateRemote] = useState(true);
  
  const [inspecting, setInspecting] = useState(false);
  const [detectedProject, setDetectedProject] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  // Auto-inspect path when user types or pastes
  const handlePathChange = async (e) => {
    const val = e.target.value;
    setProjectPath(val);
    setError(null);

    if (val.length > 3) {
      setInspecting(true);
      try {
        const res = await fetch('/api/project/inspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectDir: val }),
        });
        const data = await res.json();
        if (data.project) {
          setDetectedProject(data.project);
          if (!repoName) {
            setRepoName(data.project.projectName);
          }
        } else {
          setDetectedProject(null);
        }
      } catch (err) {
        setDetectedProject(null);
      } finally {
        setInspecting(false);
      }
    }
  };

  const handleInitSubmit = async (e) => {
    e.preventDefault();
    if (!projectPath) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/project/init-and-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectDir: projectPath,
          repoName: repoName || (detectedProject ? detectedProject.projectName : 'MyUE5Game'),
          isPrivate,
          useLfs,
          createRemote,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to initialize project');
      }

      onSetupSuccess(projectPath);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-xl rounded-3xl bg-[#0f141f] border border-cyan-500/30 p-6 shadow-2xl relative overflow-hidden">
        {/* Glow */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center text-white font-bold">
              <FolderGit2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white">1-Click UE5 Project Setup</h2>
              <p className="text-xs text-slate-400">Initialize Git and link your project to GitHub Cloud</p>
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

        <form onSubmit={handleInitSubmit} className="mt-5 space-y-4">
          {/* Path input */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">
              Unreal Engine Project Folder Path:
            </label>
            <div className="relative">
              <input
                type="text"
                value={projectPath}
                onChange={handlePathChange}
                placeholder="e.g. C:\Users\Chris\Documents\Unreal Projects\MyGame"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-4 pr-10 py-2.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
                required
              />
              <div className="absolute right-3 top-3 text-slate-500">
                {inspecting ? <Loader2 className="w-4 h-4 animate-spin text-cyan-400" /> : <FolderSearch className="w-4 h-4" />}
              </div>
            </div>
          </div>

          {/* Detected Project Pill */}
          {detectedProject && (
            <div className="p-3 rounded-2xl bg-cyan-950/30 border border-cyan-500/30 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5">
                <Gamepad2 className="w-5 h-5 text-cyan-400" />
                <div>
                  <div className="font-bold text-white">{detectedProject.projectName}</div>
                  <div className="text-[11px] text-cyan-300/80">
                    Engine Version: {detectedProject.engineVersion}
                  </div>
                </div>
              </div>
              <span className="text-[10px] bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full font-semibold">
                .uproject Found
              </span>
            </div>
          )}

          {/* Remote Settings */}
          <div className="bg-slate-950/60 rounded-2xl p-4 border border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">
                Create GitHub Cloud Repository
              </span>
              <input
                type="checkbox"
                checked={createRemote}
                onChange={(e) => setCreateRemote(e.target.checked)}
                className="w-4 h-4 rounded text-cyan-500 focus:ring-cyan-500 bg-slate-900 border-slate-700"
              />
            </div>

            {createRemote && (
              <>
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    Repository Name on GitHub:
                  </label>
                  <input
                    type="text"
                    value={repoName}
                    onChange={(e) => setRepoName(e.target.value)}
                    placeholder="MyGame-UE5"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="flex items-center gap-4 pt-1 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                    <input
                      type="radio"
                      name="visibility"
                      checked={isPrivate}
                      onChange={() => setIsPrivate(true)}
                      className="text-cyan-500 focus:ring-0"
                    />
                    <Lock className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Private (Recommended)</span>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-400 hover:text-slate-300">
                    <input
                      type="radio"
                      name="visibility"
                      checked={!isPrivate}
                      onChange={() => setIsPrivate(false)}
                      className="text-cyan-500 focus:ring-0"
                    />
                    <Globe className="w-3.5 h-3.5 text-slate-400" />
                    <span>Public</span>
                  </label>
                </div>
              </>
            )}
          </div>

          {/* Safeguard Highlights */}
          <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5 bg-slate-950/40 p-2 rounded-xl border border-slate-800/40">
              <Check className="w-3.5 h-3.5 text-cyan-400" />
              <span>Auto-generates UE5 .gitignore</span>
            </div>
            <div className="flex items-center gap-1.5 bg-slate-950/40 p-2 rounded-xl border border-slate-800/40">
              <Check className="w-3.5 h-3.5 text-cyan-400" />
              <span>Prevents CRLF Corruption</span>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={submitting || !projectPath}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-black text-xs shadow-xl shadow-cyan-600/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Initializing, generating .gitignore & pushing to GitHub...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Initialize & Publish to GitHub</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
