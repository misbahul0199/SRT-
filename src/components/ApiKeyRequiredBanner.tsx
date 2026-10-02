import React from 'react';
import { KeyRound, ExternalLink, Sliders } from 'lucide-react';

interface ApiKeyRequiredBannerProps {
  onOpenSettings: () => void;
  compact?: boolean;
}

export const ApiKeyRequiredBanner: React.FC<ApiKeyRequiredBannerProps> = ({
  onOpenSettings,
  compact = false,
}) => {
  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-300 text-xs">
        <div className="flex items-center gap-2 truncate">
          <KeyRound className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="truncate">Gemini API key is required. Open Settings to add your key.</span>
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] shrink-0 transition-colors cursor-pointer"
        >
          Open Settings
        </button>
      </div>
    );
  }

  return (
    <div className="w-full p-4 rounded-2xl bg-gradient-to-r from-amber-950/50 via-slate-900 to-amber-950/30 border border-amber-600/40 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in">
      <div className="flex items-start sm:items-center gap-3.5">
        <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40 shrink-0">
          <KeyRound className="w-5 h-5" />
        </div>
        <div>
          <div className="text-sm font-bold text-white flex items-center gap-2">
            <span>Gemini API key is required. Open Settings to add your key.</span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            SubSync is 100% Bring Your Own Key (BYOK). Your key is stored securely in your own browser/device storage.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2.5 shrink-0">
        <a
          href="https://aistudio.google.com/app/apikey"
          target="_blank"
          rel="noreferrer"
          className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors flex items-center gap-1.5"
        >
          <span>Get Free Key</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>

        <button
          type="button"
          onClick={onOpenSettings}
          className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md shadow-amber-950/50 transition-all flex items-center gap-1.5 cursor-pointer"
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Open Settings</span>
        </button>
      </div>
    </div>
  );
};
