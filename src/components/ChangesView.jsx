import React, { useState } from 'react';
import { 
  CheckSquare, 
  Square, 
  RotateCcw, 
  Send, 
  AlertTriangle, 
  Layers, 
  FileBox, 
  Code2, 
  Settings2, 
  FileText,
  Sparkles
} from 'lucide-react';

export default function ChangesView({ 
  changes = [], 
  onCommitAndPush, 
  onDiscard, 
  isCommitting 
}) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [commitMessage, setCommitMessage] = useState('');
  const [selectAll, setSelectAll] = useState(true);

  // Initialize selected files
  React.useEffect(() => {
    if (selectAll) {
      setSelectedFiles(changes.map((c) => c.file));
    }
  }, [changes, selectAll]);

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedFiles([]);
      setSelectAll(false);
    } else {
      setSelectedFiles(changes.map((c) => c.file));
      setSelectAll(true);
    }
  };

  const toggleFile = (file) => {
    if (selectedFiles.includes(file)) {
      setSelectedFiles(selectedFiles.filter((f) => f !== file));
      setSelectAll(false);
    } else {
      const updated = [...selectedFiles, file];
      setSelectedFiles(updated);
      if (updated.length === changes.length) setSelectAll(true);
    }
  };

  const handlePresetClick = (preset) => {
    setCommitMessage(preset);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!commitMessage.trim()) return;
    onCommitAndPush(commitMessage.trim(), selectedFiles);
    setCommitMessage('');
  };

  // Check if any dangerous binary files are in the list
  const dangerousFiles = changes.filter((c) => c.isDangerousMerge);

  // Icon & Category badges
  const getCategoryBadge = (category) => {
    switch (category) {
      case 'blueprint':
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-cyan-400 bg-cyan-950/60 border border-cyan-800/40 px-2 py-0.5 rounded">
            <Layers className="w-3 h-3" /> Blueprint
          </span>
        );
      case 'level':
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-purple-400 bg-purple-950/60 border border-purple-800/40 px-2 py-0.5 rounded">
            <FileBox className="w-3 h-3" /> Level / Map
          </span>
        );
      case 'code':
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded">
            <Code2 className="w-3 h-3" /> C++ Source
          </span>
        );
      case 'config':
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-950/60 border border-amber-800/40 px-2 py-0.5 rounded">
            <Settings2 className="w-3 h-3" /> Config
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
            <FileText className="w-3 h-3" /> Asset
          </span>
        );
    }
  };

  return (
    <div className="rounded-2xl bg-[#0e131d]/90 border border-slate-800 p-6 shadow-xl backdrop-blur-xl">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-white">Uncommitted Changes</h2>
          <span className="text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-bold px-2 py-0.5 rounded-full">
            {changes.length} {changes.length === 1 ? 'file' : 'files'}
          </span>
        </div>

        {changes.length > 0 && (
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSelectAll}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {selectAll ? <CheckSquare className="w-3.5 h-3.5 text-cyan-400" /> : <Square className="w-3.5 h-3.5" />}
              <span>{selectAll ? 'Deselect All' : 'Select All'}</span>
            </button>

            <button
              onClick={() => onDiscard(selectedFiles)}
              className="text-xs text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
              title="Discard selected changes (Engine Guard will check if UE is running)"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Discard</span>
            </button>
          </div>
        )}
      </div>

      {/* Dangerous File Warning */}
      {dangerousFiles.length > 0 && (
        <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Caution: Binary Map/Blueprint Changes Detected!</span>
            <p className="text-[11px] text-amber-300/80 mt-0.5">
              Level maps (`.umap`) and Player Blueprints cannot be merged automatically. Ensure your teammates aren't actively modifying them right now before pushing.
            </p>
          </div>
        </div>
      )}

      {/* File List */}
      <div className="mt-4 space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
        {changes.length === 0 ? (
          <div className="text-center py-10 text-slate-500 text-xs">
            ✨ Clean workspace! No modified files detected. You are ready to develop in Unreal Engine.
          </div>
        ) : (
          changes.map((item) => {
            const isSelected = selectedFiles.includes(item.file);
            return (
              <div
                key={item.file}
                onClick={() => toggleFile(item.file)}
                className={`flex items-center justify-between p-2.5 rounded-xl border text-xs cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-slate-900/90 border-slate-700/80 text-slate-200'
                    : 'bg-slate-950/40 border-slate-900 text-slate-400 opacity-60'
                }`}
              >
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <div className="text-slate-400">
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-cyan-400" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </div>
                  <span className="font-mono text-slate-300 truncate" title={item.file}>
                    {item.file}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {item.isDangerousMerge && (
                    <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold">
                      Binary
                    </span>
                  )}
                  {getCategoryBadge(item.category)}
                  <span className="font-mono text-[10px] text-slate-500 font-bold px-1 rounded bg-slate-950">
                    {item.status}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Smart Commit Box */}
      {changes.length > 0 && (
        <form onSubmit={handleSubmit} className="mt-6 pt-5 border-t border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>Commit Summary (Present tense)</span>
            </label>
            <span className="text-[10px] text-slate-500">
              {selectedFiles.length} of {changes.length} staged
            </span>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="e.g., Add dash mechanic to player blueprint"
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
            />
            <button
              type="submit"
              disabled={isCommitting || !commitMessage.trim() || selectedFiles.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isCommitting ? 'Committing...' : 'Commit & Push'}</span>
            </button>
          </div>

          {/* Quick Preset Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[10px] text-slate-500 mr-1">Quick templates:</span>
            {[
              'Add player blueprint mechanic',
              'Update level environment layout',
              'Fix character movement collision',
              'Implement interaction component',
              'Update project settings & inputs',
            ].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handlePresetClick(preset)}
                className="text-[10px] bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 border border-slate-800 px-2 py-0.5 rounded-md transition-colors cursor-pointer"
              >
                + {preset}
              </button>
            ))}
          </div>
        </form>
      )}
    </div>
  );
}
