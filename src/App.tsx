import React, { useState, useEffect, useRef } from 'react';
import { Scissors, Film, FileText, Sliders } from 'lucide-react';
import { Header } from './components/Header';
import { SmartClipStudio } from './components/SmartClipStudio';
import { UploadWorkflow } from './components/UploadWorkflow';
import { StudioPlayer } from './components/StudioPlayer';
import { SubtitleEditorList } from './components/SubtitleEditorList';
import { SettingsTab } from './components/SettingsTab';
import { GeminiApiSettingsModal } from './components/GeminiApiSettingsModal';
import { ApiKeyRequiredBanner } from './components/ApiKeyRequiredBanner';
import { SubtitleSegment, AppSettings } from './types';
import { safeFetchJson, getStoredApiKey } from './utils/apiHelper';

export default function App() {
  const [activeTab, setActiveTab] = useState<'clips' | 'workflow' | 'editor' | 'settings'>('clips');
  const [hasCustomKey, setHasCustomKey] = useState(false);
  const [isApiSettingsOpen, setIsApiSettingsOpen] = useState(false);
  const [isFirstRun, setIsFirstRun] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Subtitle Data
  const [subtitles, setSubtitles] = useState<SubtitleSegment[]>([]);
  const [sourceLang, setSourceLang] = useState<string>('ur'); // Default Urdu as user originally had
  const [targetLang, setTargetLang] = useState<string>('bn'); // Default Bengali as user originally had

  const [originalVolume, setOriginalVolume] = useState<number>(1);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);

  // App Settings
  const [settings, setSettings] = useState<AppSettings>({
    maxCharsPerLine: 42,
    maxLines: 2,
    globalOffsetMs: 0,
    subtitleFontSize: 17,
    autoScrollToActive: true,
    originalVolume: 1,
  });

  // Check first-run experience & track API key changes
  useEffect(() => {
    const key = getStoredApiKey();
    const hasKey = Boolean(key);
    setHasCustomKey(hasKey);

    const firstRunSeen = localStorage.getItem('subsync_first_run_seen');
    if (!hasKey && !firstRunSeen) {
      setIsFirstRun(true);
      setIsApiSettingsOpen(true);
      localStorage.setItem('subsync_first_run_seen', 'true');
    }

    const checkKey = () => {
      setHasCustomKey(Boolean(getStoredApiKey()));
    };
    window.addEventListener('subsync_api_key_changed', checkKey);
    return () => window.removeEventListener('subsync_api_key_changed', checkKey);
  }, []);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    };
  }, [mediaUrl]);

  // Find currently active subtitle
  const effectiveTime = currentTime + settings.globalOffsetMs / 1000;
  const activeSubtitle = subtitles.find(
    (sub) => effectiveTime >= sub.start && effectiveTime <= sub.end
  );

  // Auto-scroll to active subtitle in editor
  useEffect(() => {
    if (activeSubtitle && activeTab === 'editor' && settings.autoScrollToActive) {
      const el = document.getElementById(`sub-card-${activeSubtitle.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [activeSubtitle, activeTab, settings.autoScrollToActive]);

  // Handle Translate All Segments into a new Target Language
  const handleTranslateAll = async (newTargetLang: string) => {
    if (subtitles.length === 0) return;
    setIsTranslating(true);
    setTargetLang(newTargetLang);

    try {
      const data = await safeFetchJson<{
        success: boolean;
        segments: SubtitleSegment[];
      }>(
        '/api/subtitles/translate-segments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            segments: subtitles,
            targetLang: newTargetLang,
            maxCharsPerLine: settings.maxCharsPerLine,
            maxLines: settings.maxLines,
          }),
        },
        'অনুবাদ সম্পন্ন করা সম্ভব হয়নি।'
      );

      setSubtitles(data.segments);
    } catch (err) {
      console.error(err);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleResetDefaults = () => {
    setSettings({
      maxCharsPerLine: 42,
      maxLines: 2,
      globalOffsetMs: 0,
      subtitleFontSize: 17,
      autoScrollToActive: true,
      originalVolume: 1,
    });
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans selection:bg-emerald-500/30 overflow-hidden">
      {/* Top Application Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        subtitles={subtitles}
        fileName={file?.name || ''}
        sourceLang={sourceLang}
        targetLang={targetLang}
        offsetMs={settings.globalOffsetMs}
        maxCharsPerLine={settings.maxCharsPerLine}
        maxLines={settings.maxLines}
        onOpenApiSettings={() => {
          setIsFirstRun(false);
          setIsApiSettingsOpen(true);
        }}
      />

      {/* Main Body with bottom padding for mobile navigation */}
      <main className="flex-1 flex flex-col overflow-hidden relative pb-16 md:pb-0">
        {/* Missing API Key Sticky Alert Banner for immediate user guidance */}
        {!hasCustomKey && activeTab !== 'settings' && (
          <div className="px-4 sm:px-6 pt-3 pb-1 z-20 shrink-0">
            <ApiKeyRequiredBanner
              onOpenSettings={() => {
                setIsFirstRun(false);
                setIsApiSettingsOpen(true);
              }}
              compact
            />
          </div>
        )}

        {/* Tab: Smart Content Repurposing Agent & Audio Cutter */}
        {activeTab === 'clips' && (
          <SmartClipStudio
            file={file}
            setFile={setFile}
            mediaUrl={mediaUrl}
            setMediaUrl={setMediaUrl}
            duration={duration}
            setDuration={setDuration}
            onSwitchToFullEditor={(subs) => {
              setSubtitles(subs);
              setActiveTab('editor');
            }}
          />
        )}

        {/* Tab 1: Upload & Language Configuration */}
        {activeTab === 'workflow' && (
          <UploadWorkflow
            file={file}
            setFile={setFile}
            mediaUrl={mediaUrl}
            setMediaUrl={setMediaUrl}
            duration={duration}
            setDuration={setDuration}
            sourceLang={sourceLang}
            setSourceLang={setSourceLang}
            targetLang={targetLang}
            setTargetLang={setTargetLang}
            settings={settings}
            setSubtitles={setSubtitles}
            setActiveTab={setActiveTab}
          />
        )}

        {/* Tab 2: Studio Video Player & Subtitle Editor */}
        {activeTab === 'editor' && (
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden w-full h-full">
            <StudioPlayer
              mediaUrl={mediaUrl}
              file={file}
              currentTime={currentTime}
              duration={duration}
              isPlaying={isPlaying}
              onTimeUpdate={(t) => setCurrentTime(t)}
              onLoadedMetadata={(d) => setDuration(d)}
              onPlayPause={() => setIsPlaying(!isPlaying)}
              onSeek={(t) => setCurrentTime(t)}
              activeSubtitle={activeSubtitle}
              settings={settings}
              setSettings={setSettings}
              originalVolume={originalVolume}
              setOriginalVolume={setOriginalVolume}
              subtitles={subtitles}
              setSubtitles={setSubtitles}
              setMediaUrl={setMediaUrl}
              setFile={setFile}
              setDuration={setDuration}
            />

            <SubtitleEditorList
              subtitles={subtitles}
              setSubtitles={setSubtitles}
              currentTime={currentTime}
              onSeek={(t) => {
                setCurrentTime(t);
                setIsPlaying(true);
              }}
              settings={settings}
              targetLang={targetLang}
              setTargetLang={setTargetLang}
              onTranslateAll={handleTranslateAll}
              isTranslating={isTranslating}
              duration={duration}
              setDuration={setDuration}
              fileName={file?.name || ''}
            />
          </div>
        )}

        {/* Tab 3: Subtitle & Line Formatting Settings */}
        {activeTab === 'settings' && (
          <SettingsTab
            settings={settings}
            setSettings={setSettings}
            onSaveAndReturn={() => setActiveTab(subtitles.length > 0 ? 'editor' : 'workflow')}
            onResetDefaults={handleResetDefaults}
            subtitles={subtitles}
            setSubtitles={setSubtitles}
          />
        )}

      </main>

      {/* Mobile Bottom Navigation Bar (< 768px) - Highly friendly for phones */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-950/95 backdrop-blur-md border-t border-slate-800/90 h-16 flex items-center justify-around px-2 shadow-2xl safe-area-pb"
      >
        <button
          onClick={() => setActiveTab('clips')}
          className={`flex flex-col items-center justify-center flex-1 py-1.5 transition-all cursor-pointer ${
            activeTab === 'clips' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Scissors className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] leading-tight">ক্লিপ কাটিং</span>
        </button>

        <button
          onClick={() => setActiveTab('workflow')}
          className={`flex flex-col items-center justify-center flex-1 py-1.5 transition-all cursor-pointer ${
            activeTab === 'workflow' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Film className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] leading-tight">ফুল ভিডিও</span>
        </button>

        <button
          onClick={() => setActiveTab('editor')}
          disabled={subtitles.length === 0}
          className={`relative flex flex-col items-center justify-center flex-1 py-1.5 transition-all cursor-pointer ${
            activeTab === 'editor'
              ? 'text-emerald-400 font-bold'
              : subtitles.length === 0
              ? 'text-slate-600 opacity-40 cursor-not-allowed'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileText className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] leading-tight">এডিটর</span>
          {subtitles.length > 0 && (
            <span className="absolute top-1 right-4 text-[9px] bg-emerald-600 text-white font-mono px-1 rounded-full font-bold">
              {subtitles.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`relative flex flex-col items-center justify-center flex-1 py-1.5 transition-all cursor-pointer ${
            activeTab === 'settings' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] leading-tight">সেটিংস</span>
          {hasCustomKey && (
            <span className="absolute top-1.5 right-5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-slate-950" />
          )}
        </button>
      </nav>

      {/* Gemini API Settings & First-Run Setup Modal */}
      <GeminiApiSettingsModal
        isOpen={isApiSettingsOpen}
        onClose={() => setIsApiSettingsOpen(false)}
        isFirstRun={isFirstRun}
      />
    </div>
  );
}
