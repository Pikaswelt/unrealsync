import React, { useState, useEffect } from 'react';
import { 
  Users, 
  UserPlus, 
  Copy, 
  Check, 
  ShieldCheck, 
  ExternalLink, 
  Loader2,
  AlertCircle
} from 'lucide-react';

export default function TeamHub({ 
  project, 
  isOpen, 
  onClose 
}) {
  const [collaborators, setCollaborators] = useState([]);
  const [loading, setLoading] = useState(false);
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteStatus, setInviteStatus] = useState(null);
  const [copied, setCopied] = useState(false);

  const repoOwnerRepo = project?.repoOwnerRepo;

  useEffect(() => {
    if (isOpen && repoOwnerRepo) {
      loadCollaborators();
    }
  }, [isOpen, repoOwnerRepo]);

  const loadCollaborators = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/team/collaborators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoOwnerRepo }),
      });
      const data = await res.json();
      setCollaborators(data.collaborators || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteUsername.trim() || !repoOwnerRepo) return;

    setInviting(true);
    setInviteStatus(null);
    try {
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoOwnerRepo, username: inviteUsername.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setInviteStatus({ success: true, message: `Invite sent to @${inviteUsername}!` });
        setInviteUsername('');
        loadCollaborators();
      } else {
        setInviteStatus({ success: false, message: data.error || 'Failed to send invite' });
      }
    } catch (err) {
      setInviteStatus({ success: false, message: err.message });
    } finally {
      setInviting(false);
    }
  };

  const copyCloneUrl = () => {
    if (project?.gitRemote) {
      navigator.clipboard.writeText(project.gitRemote);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-xl rounded-3xl bg-[#0f141f] border border-indigo-500/30 p-6 shadow-2xl relative overflow-hidden">
        {/* Glow */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white font-bold">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white">Team & Collaborators</h2>
              <p className="text-xs text-slate-400">Invite team members to build games together</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-xs text-slate-400 hover:text-white px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Clone URL Box */}
        <div className="mt-4 p-3 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3 text-xs">
          <div className="overflow-hidden">
            <span className="text-[10px] text-slate-400 block font-medium">Repository Clone URL:</span>
            <span className="font-mono text-cyan-300 truncate block select-all">
              {project?.gitRemote || 'No remote URL found'}
            </span>
          </div>
          <button
            onClick={copyCloneUrl}
            className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-slate-300 px-3 py-1.5 rounded-xl border border-slate-800 transition-colors shrink-0 cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>

        {/* Invite Form */}
        <form onSubmit={handleInvite} className="mt-4 space-y-2">
          <label className="text-xs font-semibold text-slate-300 block">
            Invite Teammate via GitHub:
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={inviteUsername}
              onChange={(e) => setInviteUsername(e.target.value)}
              placeholder="Enter GitHub username (e.g. johndoe)"
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
            />
            <button
              type="submit"
              disabled={inviting || !inviteUsername.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-40 cursor-pointer"
            >
              {inviting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
              <span>Invite</span>
            </button>
          </div>
        </form>

        {inviteStatus && (
          <div className={`mt-2 p-2.5 rounded-xl text-xs flex items-center gap-2 ${
            inviteStatus.success ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' : 'bg-red-500/10 text-red-300 border border-red-500/30'
          }`}>
            {inviteStatus.success ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{inviteStatus.message}</span>
          </div>
        )}

        {/* Current Collaborators List */}
        <div className="mt-5">
          <h3 className="text-xs font-bold text-slate-300 mb-2">Current Collaborators</h3>
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {loading ? (
              <div className="py-6 flex items-center justify-center text-xs text-slate-500 gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                <span>Loading team members...</span>
              </div>
            ) : collaborators.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                No extra collaborators found yet. Invite your friends above!
              </div>
            ) : (
              collaborators.map((c) => (
                <div 
                  key={c.login} 
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60 text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <img 
                      src={c.avatar_url} 
                      alt={c.login} 
                      className="w-6 h-6 rounded-full border border-slate-700" 
                    />
                    <span className="font-semibold text-slate-200">@{c.login}</span>
                  </div>
                  <span className="text-[10px] text-indigo-400 bg-indigo-950/60 border border-indigo-800/40 px-2 py-0.5 rounded font-mono">
                    {c.permissions?.admin ? 'Admin' : c.permissions?.push ? 'Write / Push' : 'Read'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
