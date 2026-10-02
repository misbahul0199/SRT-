import React, { useState, useEffect } from 'react';
import { 
  Sparkles, Sliders, Film, FileText, Download, 
  Languages, KeyRound, Scissors, Check
} from 'lucide-react';
import { SubtitleSegment } from '../types';
import { downloadBlob, generateSrtContent, generateVttContent, generateTxtTranscript } from '../utils/subtitleUtils';
import { getStoredApiKey, maskApiKey } from '../utils/apiHelper';

interface HeaderProps {
  activeTab: 'clips' | 'workflow' | 'editor' | 'settings';
  setActiveTab: (tab: 'clips' | 'workflow' | 'editor' | 'settings') => void;
  subtitles: SubtitleSegment[];
  fileName: string;
  sourceLang: string;
  targetLang: string;
  offsetMs: number;
  maxCharsPerLine?: number;
  maxLines?: number;
  onOpenApiSettings?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  subtitles,
  fileName,
  sourceLang,
  targetLang,
  offsetMs,
  maxCharsPerLine,
  maxLines,
  onOpenApiSettings,
}) => {
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [hasCustomKey, setHasCustomKey] = useState(false);

  const checkApiKey = () => {
    const key = getStoredApiKey();
    setHasCustomKey(Boolean(key));
  };

  useEffect(() => {
    checkApiKey();
    window.addEventListener('subsync_api_key_changed', checkApiKey);
    return () => {
      window.removeEventListener('subsync_api_key_changed', checkApiKey);
    };
  }, []);

  const baseFileName = fileName ? fileName.replace(/\.[^/.]+$/, '') : 'subtitles';

  const handleDownloadSrt = () => {
    const srt = generateSrtContent(subtitles, offsetMs, maxCharsPerLine, maxLines);
    downloadBlob(srt, `${baseFileName}_${targetLang}.srt`, 'text/srt');
    setDownloadOpen(false);
  };

  const handleDownloadVtt = () => {
    const vtt = generateVttContent(subtitles, offsetMs, maxCharsPerLine, maxLines);
    downloadBlob(vtt, `${baseFileName}_${targetLang}.vtt`, 'text/vtt');
    setDownloadOpen(false);
  };

  const handleDownloadTxt = () => {
    const txt = generateTxtTranscript(subtitles);
    downloadBlob(txt, `${baseFileName}_transcript_${targetLang}.txt`, 'text/plain');
    setDownloadOpen(false);
  };

  return (
    <header className="flex flex-wrap justify-between items-center px-4 sm:px-6 py-3 border-b border-slate-800 bg-slate-900/90 backdrop-blur z-30 sticky top-0">
      {/* Brand & Language Tag */}
      <div className="flex items-center space-x-3 my-1">
        <div className="bg-gradient-to-tr from-emerald-600 to-teal-500 p-2.5 rounded-xl text-white shadow-lg shadow-emerald-900/40 flex items-center justify-center">
          <Languages className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm sm:text-base font-bold tracking-tight text-white flex items-center gap-1.5">
              SubSync AI Studio
            </h1>
            <span className="hidden md:inline-flex text-[10px] bg-emerald-950 border border-emerald-800/80 text-emerald-400 px-2 py-0.5 rounded-full font-medium tracking-wide">
              স্পিচ-সিঙ্কড SRT স্টুডিও
            </span>
          </div>
          <p className="text-xs text-slate-400">
            ভিডিও ও অডিওর কথার সাথে নিখুঁত টাইমে বাংলা ও বহুভাষিক সাবটাইটেল (SRT / VTT)
          </p>
        </div>
      </div>

      {/* Navigation Tabs, API Key Button & Downloads */}
      <div className="flex items-center gap-2.5 my-1">
        {/* Desktop Tabs Switcher (hidden on mobile, navigated via bottom bar) */}
        <div className="hidden md:flex bg-slate-950 border border-slate-800 rounded-xl p-1 space-x-1">
          <button
            id="tab-clips-btn"
            onClick={() => setActiveTab('clips')}
            className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'clips'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-900/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Scissors className="w-3.5 h-3.5 text-emerald-300" />
            <span className="font-bold">ক্লিপ কাটিং ও সিঙ্ক</span>
            <span className="text-[10px] bg-emerald-950/80 border border-emerald-700/80 text-emerald-300 px-1.5 py-0.2 rounded-full hidden sm:inline">
              AI Agent
            </span>
          </button>

          <button
            id="tab-workflow-btn"
            onClick={() => setActiveTab('workflow')}
            className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'workflow'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>ফুল ভিডিও সাবটাইটেল</span>
          </button>

          <button
            id="tab-editor-btn"
            onClick={() => setActiveTab('editor')}
            disabled={subtitles.length === 0}
            className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'editor'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/30'
                : 'text-slate-400 hover:text-slate-200'
            } ${subtitles.length === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>এডিটর</span>
            {subtitles.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 text-[10px] bg-slate-900 text-emerald-400 rounded-full border border-emerald-800 font-mono">
                {subtitles.length}
              </span>
            )}
          </button>

          <button
            id="tab-settings-btn"
            onClick={() => setActiveTab('settings')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'settings'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>সেটিংস</span>
          </button>
        </div>

        {/* Dedicated Gemini API Settings Trigger */}
        <button
          id="gemini-api-settings-btn"
          onClick={() => {
            if (onOpenApiSettings) {
              onOpenApiSettings();
            } else {
              setActiveTab('settings');
            }
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer shadow-sm ${
            hasCustomKey
              ? 'bg-slate-950/80 border-emerald-800/80 text-emerald-300 hover:bg-slate-900'
              : 'bg-amber-950/70 border-amber-600/80 text-amber-300 hover:bg-amber-900/80'
          }`}
          title="Gemini API Settings"
        >
          <KeyRound className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden sm:inline">Gemini API Settings</span>
          <span className="sm:hidden font-mono text-[11px]">{hasCustomKey ? 'Key: OK' : 'No Key'}</span>
          <span
            className={`w-2 h-2 rounded-full ${
              hasCustomKey ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
            }`}
          />
        </button>


        {/* Global Download Menu */}
        {subtitles.length > 0 && (
          <div className="relative">
            <button
              id="export-dropdown-btn"
              onClick={() => setDownloadOpen(!downloadOpen)}
              className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold shadow-lg shadow-emerald-900/30 flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              <span>ডাউনলোড</span>
            </button>

            {downloadOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setDownloadOpen(false)}
                ></div>
                <div className="absolute right-0 mt-2 w-56 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-1.5 z-50 flex flex-col space-y-1 font-sans">
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 border-b border-slate-800">
                    এক্সপোর্ট ফরম্যাট নির্বাচন করুন
                  </div>
                  <button
                    onClick={handleDownloadSrt}
                    className="flex items-center justify-between w-full px-3 py-2 rounded-lg text-xs text-left text-slate-200 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
                  >
                    <span className="font-semibold text-emerald-400">.SRT সাবটাইটেল</span>
                    <span className="text-[10px] text-slate-400">নিখুঁত টাইমকোড</span>
                  </button>

                  <button
                    onClick={handleDownloadVtt}
                    className="flex items-center justify-between w-full px-3 py-2 rounded-lg text-xs text-left text-slate-200 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
                  >
                    <span className="font-semibold text-teal-400">.VTT সাবটাইটেল</span>
                    <span className="text-[10px] text-slate-400">ওয়েব প্লেয়ার</span>
                  </button>

                  <button
                    onClick={handleDownloadTxt}
                    className="flex items-center justify-between w-full px-3 py-2 rounded-lg text-xs text-left text-slate-200 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
                  >
                    <span className="font-medium text-slate-300">.TXT ট্রান্সক্রিপ্ট</span>
                    <span className="text-[10px] text-slate-400">টেক্সট অনুলিপি</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
