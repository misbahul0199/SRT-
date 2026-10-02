import React, { useState, useRef } from 'react';
import { 
  Search, Plus, Trash2, Clock, Volume2, Split, ArrowUpDown, 
  Languages, Check, Sparkles, AlertCircle, ChevronDown, ChevronUp, Copy,
  Mic2, User, Baby, Upload, Download, CheckCircle2
} from 'lucide-react';
import { SubtitleSegment, AppSettings, SpeakerGender } from '../types';
import { 
  formatSrtTime, formatDisplayTime, enforceSubtitleConstraints, 
  parseSrtContent, downloadBlob, generateSrtContent 
} from '../utils/subtitleUtils';
import { TARGET_LANGUAGES } from '../utils/languages';

interface SubtitleEditorListProps {
  subtitles: SubtitleSegment[];
  setSubtitles: React.Dispatch<React.SetStateAction<SubtitleSegment[]>>;
  currentTime: number;
  onSeek: (time: number) => void;
  settings: AppSettings;
  targetLang: string;
  setTargetLang: (lang: string) => void;
  onTranslateAll: (newTargetLang: string) => void;
  isTranslating: boolean;
  duration?: number;
  setDuration?: (dur: number) => void;
  fileName?: string;
}

export const SubtitleEditorList: React.FC<SubtitleEditorListProps> = ({
  subtitles,
  setSubtitles,
  currentTime,
  onSeek,
  settings,
  targetLang,
  setTargetLang,
  onTranslateAll,
  isTranslating,
  duration,
  setDuration,
  fileName = '',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showOriginals, setShowOriginals] = useState(true);
  const [translateMenuOpen, setTranslateMenuOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | number | null>(null);
  const [importAlert, setImportAlert] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Time adjustment for an individual segment
  const adjustSegmentTime = (id: string | number, startDelta: number, endDelta: number) => {
    setSubtitles((prev) =>
      prev.map((sub) => {
        if (sub.id === id) {
          const newStart = Math.max(0, Math.round((sub.start + startDelta) * 100) / 100);
          const newEnd = Math.max(newStart + 0.2, Math.round((sub.end + endDelta) * 100) / 100);
          return { ...sub, start: newStart, end: newEnd, isCustomEdited: true };
        }
        return sub;
      })
    );
  };

  // Lock segment start to current video playback time
  const setStartToCurrentTime = (id: string | number) => {
    setSubtitles((prev) =>
      prev.map((sub) => {
        if (sub.id === id) {
          const newStart = Math.round(currentTime * 100) / 100;
          const newEnd = Math.max(newStart + 0.5, sub.end);
          return { ...sub, start: newStart, end: newEnd, isCustomEdited: true };
        }
        return sub;
      })
    );
  };

  // Lock segment end to current video playback time
  const setEndToCurrentTime = (id: string | number) => {
    setSubtitles((prev) =>
      prev.map((sub) => {
        if (sub.id === id) {
          const newEnd = Math.round(currentTime * 100) / 100;
          const newStart = Math.min(sub.start, Math.max(0, newEnd - 0.5));
          return { ...sub, start: newStart, end: newEnd, isCustomEdited: true };
        }
        return sub;
      })
    );
  };

  // Shift all subtitles by offset delta
  const shiftAllSubtitles = (delta: number) => {
    setSubtitles((prev) =>
      prev.map((sub) => ({
        ...sub,
        start: Math.max(0, sub.start + delta),
        end: Math.max(0.3, sub.end + delta),
      }))
    );
  };

  // Add a new blank subtitle after a specific index
  const addNewSegmentAfter = (index: number) => {
    const currentSub = subtitles.find((s) => s.index === index);
    const newStart = currentSub ? currentSub.end + 0.1 : 0;
    const newEnd = newStart + 2.5;

    const newSub: SubtitleSegment = {
      id: Date.now(),
      index: index + 1,
      start: Math.round(newStart * 100) / 100,
      end: Math.round(newEnd * 100) / 100,
      text: 'নতুন সাবটাইটেল টেক্সট লিখুন...',
      speaker: 'Speaker 1',
    };

    const newArr = [...subtitles];
    newArr.splice(index, 0, newSub);

    // Re-index
    const reindexed = newArr.map((s, i) => ({ ...s, index: i + 1 }));
    setSubtitles(reindexed);
  };

  // Delete segment
  const deleteSegment = (id: string | number) => {
    if (subtitles.length <= 1) return;
    const filtered = subtitles.filter((s) => s.id !== id);
    const reindexed = filtered.map((s, i) => ({ ...s, index: i + 1 }));
    setSubtitles(reindexed);
  };

  // Split a segment into two halves
  const splitSegment = (sub: SubtitleSegment) => {
    const midTime = (sub.start + sub.end) / 2;
    const lines = sub.text.split('\n');
    let text1 = sub.text;
    let text2 = '...';

    if (lines.length > 1) {
      text1 = lines[0];
      text2 = lines.slice(1).join('\n');
    } else {
      const words = sub.text.split(' ');
      const half = Math.ceil(words.length / 2);
      text1 = words.slice(0, half).join(' ');
      text2 = words.slice(half).join(' ');
    }

    const sub1: SubtitleSegment = {
      ...sub,
      end: Math.round(midTime * 100) / 100,
      text: text1,
    };

    const sub2: SubtitleSegment = {
      id: Date.now(),
      index: sub.index + 1,
      start: Math.round(midTime * 100) / 100,
      end: sub.end,
      text: text2,
      speaker: sub.speaker,
    };

    const idx = subtitles.findIndex((s) => s.id === sub.id);
    const updated = [...subtitles];
    updated.splice(idx, 1, sub1, sub2);
    setSubtitles(updated.map((s, i) => ({ ...s, index: i + 1 })));
  };

  // Automatically split any oversized segment according to settings.maxCharsPerLine & settings.maxLines
  const autoSplitSegment = (sub: SubtitleSegment) => {
    const split = enforceSubtitleConstraints([sub], settings.maxCharsPerLine, settings.maxLines);
    if (split.length <= 1 && split[0].text === sub.text) return;

    const idx = subtitles.findIndex((s) => s.id === sub.id);
    const updated = [...subtitles];
    updated.splice(idx, 1, ...split);
    setSubtitles(updated.map((s, i) => ({ ...s, index: i + 1 })));
  };

  // Re-format and split all subtitles to current settings
  const autoSplitAllSubtitles = () => {
    const formatted = enforceSubtitleConstraints(subtitles, settings.maxCharsPerLine, settings.maxLines);
    setSubtitles(formatted);
  };

  // Direct SRT / VTT Import from Editor
  const handleImportSrt = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const parsed = parseSrtContent(content);
        if (parsed.length > 0) {
          setSubtitles(parsed);
          const maxEnd = Math.max(...parsed.map((p) => p.end), 10);
          if (setDuration) {
            setDuration(maxEnd);
          }
          setImportAlert(`সফলভাবে ${parsed.length}টি সাবটাইটেল সেগমেন্ট ইমপোর্ট করা হয়েছে!`);
          setTimeout(() => setImportAlert(null), 3500);
        } else {
          setImportAlert('SRT ফাইলটি সঠিকভাবে পড়া সম্ভব হয়নি। ফাইল ফরম্যাট যাচাই করুন।');
          setTimeout(() => setImportAlert(null), 4000);
        }
      }
    };
    reader.readAsText(file, 'UTF-8');
    if (e.target) e.target.value = '';
  };

  // Quick download of current subtitles as .SRT
  const handleQuickDownloadSrt = () => {
    if (subtitles.length === 0) return;
    const srt = generateSrtContent(subtitles, settings.globalOffsetMs, settings.maxCharsPerLine, settings.maxLines);
    const baseName = fileName ? fileName.replace(/\.[^/.]+$/, '') : 'subtitles';
    downloadBlob(srt, `${baseName}_${targetLang}.srt`, 'text/srt');
  };

  // Quick single-line TTS playback preview using Web Speech
  const speakLinePreview = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  };

  // Copy text to clipboard
  const copySubtitleText = (sub: SubtitleSegment) => {
    navigator.clipboard.writeText(sub.text);
    setCopiedId(sub.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // Update character gender
  const handleGenderChange = (id: string | number, newGender: SpeakerGender) => {
    setSubtitles((prev) =>
      prev.map((s) => {
        if (s.id === id) {
          const defaultVoice = newGender === 'female' ? 'Aoede' : newGender === 'child' ? 'Zephyr' : 'Charon';
          return { ...s, speakerGender: newGender, assignedVoice: defaultVoice };
        }
        return s;
      })
    );
  };

  const filtered = subtitles.filter(
    (s) =>
      s.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.originalText && s.originalText.toLowerCase().includes(searchQuery.toLowerCase())) ||
      String(s.index).includes(searchQuery)
  );

  return (
    <div className="flex-1 flex flex-col bg-slate-950 p-4 sm:p-5 overflow-hidden">
      
      {/* Top Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="সাবটাইটেল খুঁজুন..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 w-36 sm:w-48 transition-all"
            />
          </div>

          <button
            onClick={() => setShowOriginals(!showOriginals)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1 cursor-pointer ${
              showOriginals
                ? 'bg-slate-900 border-slate-700 text-slate-200'
                : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}
            title="মূল ভাষার স্পিচ প্রদর্শন টগল করুন"
          >
            <Languages className="w-3.5 h-3.5 text-teal-400" />
            <span className="hidden sm:inline">মূল ভাষা</span>
          </button>
        </div>

        {/* Global actions: Translate all, Shift all, Add */}
        <div className="flex items-center gap-2">
          {/* Quick Translate all into new language */}
          <div className="relative">
            <button
              onClick={() => setTranslateMenuOpen(!translateMenuOpen)}
              disabled={isTranslating}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 hover:bg-slate-800 border border-slate-800 text-teal-400 hover:text-teal-300 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-3 h-3 text-teal-400" />
              <span>অন্য ভাষায় অনুবাদ</span>
              <ChevronDown className="w-3 h-3" />
            </button>

            {translateMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setTranslateMenuOpen(false)}></div>
                <div className="absolute right-0 mt-2 w-52 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-1.5 z-40 max-h-60 overflow-y-auto">
                  <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    লক্ষ্য ভাষা নির্বাচন করুন
                  </div>
                  {TARGET_LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => {
                        setTranslateMenuOpen(false);
                        onTranslateAll(lang.code);
                      }}
                      className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-slate-800 hover:text-white flex items-center justify-between transition-colors"
                    >
                      <span>{lang.flag} {lang.name}</span>
                      {targetLang === lang.code && <Check className="w-3 h-3 text-teal-400" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Shift all timing buttons */}
          <div className="flex items-center space-x-1 text-xs bg-slate-900 border border-slate-800 rounded-lg p-0.5">
            <span className="text-[10px] text-slate-400 px-1 hidden md:inline">টাইম শিফট:</span>
            <button
              onClick={() => shiftAllSubtitles(-1.0)}
              className="px-1.5 py-0.5 hover:bg-slate-800 rounded text-amber-300 font-mono text-[11px]"
              title="সবগুলো ১.০ সেকেন্ড এগিয়ে আনুন"
            >
              -1s
            </button>
            <button
              onClick={() => shiftAllSubtitles(-0.5)}
              className="px-1.5 py-0.5 hover:bg-slate-800 rounded text-amber-300 font-mono text-[11px]"
              title="সবগুলো ০.৫ সেকেন্ড এগিয়ে আনুন"
            >
              -0.5s
            </button>
            <button
              onClick={() => shiftAllSubtitles(-0.2)}
              className="px-1.5 py-0.5 hover:bg-slate-800 rounded text-slate-300 font-mono text-[11px]"
              title="সবগুলো ০.২ সেকেন্ড এগিয়ে আনুন"
            >
              -0.2s
            </button>
            <button
              onClick={() => shiftAllSubtitles(0.2)}
              className="px-1.5 py-0.5 hover:bg-slate-800 rounded text-slate-300 font-mono text-[11px]"
              title="সবগুলো ০.২ সেকেন্ড পিছিয়ে দিন"
            >
              +0.2s
            </button>
            <button
              onClick={() => shiftAllSubtitles(0.5)}
              className="px-1.5 py-0.5 hover:bg-slate-800 rounded text-emerald-300 font-mono text-[11px]"
              title="সবগুলো ০.৫ সেকেন্ড পিছিয়ে দিন"
            >
              +0.5s
            </button>
            <button
              onClick={() => shiftAllSubtitles(1.0)}
              className="px-1.5 py-0.5 hover:bg-slate-800 rounded text-emerald-300 font-mono text-[11px]"
              title="সবগুলো ১.০ সেকেন্ড পিছিয়ে দিন"
            >
              +1s
            </button>
          </div>

          {/* Auto-Split / Length Enforcer Button */}
          <button
            onClick={autoSplitAllSubtitles}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer shadow-sm ${
              subtitles.some((sub) => {
                const lines = sub.text.split('\n');
                return lines.some((l) => l.length > settings.maxCharsPerLine) || lines.length > settings.maxLines;
              })
                ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/50 shadow-amber-950/40 animate-pulse'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800'
            }`}
            title={`সকল সাবটাইটেলকে সর্বোচ্চ ${settings.maxCharsPerLine} অক্ষরে সীমাবদ্ধ রাখতে স্বয়ংক্রিয়ভাবে কাটুন`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="hidden sm:inline">অটো-স্প্লিট</span>
            <span className="font-mono text-[10px] bg-slate-950 px-1 rounded text-emerald-400">
              {settings.maxCharsPerLine}ব
            </span>
          </button>

          {/* Import SRT Button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer transition-all"
            title="কম্পিউটার থেকে বিদ্যমান .SRT ফাইল ইমপোর্ট করুন"
          >
            <Upload className="w-3.5 h-3.5 text-teal-400" />
            <span className="hidden md:inline">SRT ইমপোর্ট</span>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            accept=".srt,.vtt"
            onChange={handleImportSrt}
            className="hidden"
          />

          {/* Quick Download SRT Button */}
          {subtitles.length > 0 && (
            <button
              onClick={handleQuickDownloadSrt}
              className="bg-slate-900 hover:bg-slate-800 text-emerald-400 border border-emerald-900/60 hover:border-emerald-700 px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer transition-all"
              title="বর্তমান সাবটাইটেল সরাসরি .SRT ফরম্যাটে ডাউনলোড করুন"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden md:inline">SRT সেভ</span>
            </button>
          )}

          {/* Add Segment */}
          <button
            onClick={() => addNewSegmentAfter(subtitles.length)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-md shadow-emerald-900/30 flex items-center gap-1 cursor-pointer transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">নতুন ব্লক</span>
          </button>
        </div>
      </div>

      {/* Import Feedback Toast Alert */}
      {importAlert && (
        <div className="mt-2 p-2.5 rounded-lg bg-emerald-950/90 border border-emerald-700/80 text-emerald-200 text-xs flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{importAlert}</span>
        </div>
      )}

      {/* Subtitles Scrollable List */}
      <div className="flex-1 overflow-y-auto space-y-3 pt-3 pr-1">
        {filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs py-12">
            <Search className="w-8 h-8 text-slate-700 mb-2" />
            <span>কোনো সাবটাইটেল পাওয়া যায়নি</span>
          </div>
        ) : (
          filtered.map((sub) => {
            const isActive = currentTime >= sub.start && currentTime <= sub.end;
            const lines = sub.text.split('\n');
            const maxLineLength = Math.max(...lines.map((l) => l.length), 0);
            const isOverLimit = maxLineLength > settings.maxCharsPerLine;

            return (
              <div
                key={sub.id}
                id={`sub-card-${sub.id}`}
                className={`bg-slate-900 border rounded-2xl p-3.5 sm:p-4 transition-all duration-200 ${
                  isActive
                    ? 'border-emerald-500 bg-emerald-950/20 shadow-xl shadow-emerald-950/50 ring-1 ring-emerald-500/30'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Segment Top Bar */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-300 bg-slate-950 px-2 py-0.5 rounded-md border border-slate-800">
                      #{sub.index}
                    </span>

                    {/* Jump / Play this segment */}
                    <button
                      onClick={() => onSeek(sub.start)}
                      className="text-xs font-mono text-emerald-400 hover:text-emerald-300 hover:underline flex items-center gap-1 cursor-pointer"
                      title="এই সময়ে প্লেয়ার নিয়ে যান"
                    >
                      <span>▶</span>
                      <span>{formatDisplayTime(sub.start)}</span>
                      <span className="text-slate-500">→</span>
                      <span>{formatDisplayTime(sub.end)}</span>
                    </button>

                    <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">
                      ({(sub.end - sub.start).toFixed(2)}s)
                    </span>
                  </div>

                  {/* Character Gender & Language Bar */}
                  <div className="flex items-center gap-1.5">
                    {/* Character Gender Dropdown */}
                    <select
                      value={sub.speakerGender || 'male'}
                      onChange={(e) => handleGenderChange(sub.id, e.target.value as SpeakerGender)}
                      className="bg-slate-950 border border-slate-800 text-[10px] text-slate-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-violet-500 cursor-pointer"
                      title="এই লাইনের চরিত্রের জেন্ডার পরিবর্তন করুন"
                    >
                      <option value="male">👨 পুরুষ</option>
                      <option value="female">👩 মহিলা</option>
                      <option value="child">🧒 বাচ্চা</option>
                    </select>

                    {/* Mixed Language indicator if detected */}
                    {sub.detectedLanguage && (
                      <span className="text-[9px] font-mono bg-slate-950 border border-slate-800 text-teal-400 px-1.5 py-0.5 rounded hidden sm:inline">
                        {sub.detectedLanguage}
                      </span>
                    )}
                  </div>

                  {/* Character count & line limit indicator */}
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                        isOverLimit
                          ? 'bg-amber-950 text-amber-400 border-amber-800/80 font-bold'
                          : 'bg-emerald-950 text-emerald-400 border-emerald-800/80'
                      }`}
                      title={
                        isOverLimit
                          ? `নির্ধারিত সর্বোচ্চ ${settings.maxCharsPerLine} অক্ষরের চেয়ে বড়`
                          : 'অক্ষর সংখ্যা মানানসই'
                      }
                    >
                      {maxLineLength}/{settings.maxCharsPerLine} বর্ণ {lines.length > settings.maxLines ? `(${lines.length} লাইন)` : ''}
                    </span>

                    {/* Quick per-card auto-split button if over limit */}
                    {isOverLimit && (
                      <button
                        onClick={() => autoSplitSegment(sub)}
                        className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer"
                        title="এই সেগমেন্টকে সীমার মধ্যে স্বয়ংক্রিয়ভাবে ছোট ব্লকে ভাগ করুন"
                      >
                        <Split className="w-3 h-3" />
                        <span>অটো-স্প্লিট</span>
                      </button>
                    )}

                    {/* Preview speak line button */}
                    <button
                      onClick={() => speakLinePreview(sub.text)}
                      className="p-1 text-slate-400 hover:text-emerald-300 hover:bg-slate-800 rounded transition-colors"
                      title="এই লাইনের ভয়েস প্রিভিউ শুনুন"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>

                    {/* Copy text */}
                    <button
                      onClick={() => copySubtitleText(sub)}
                      className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
                      title="টেক্সট কপি করুন"
                    >
                      {copiedId === sub.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Original Source Speech (if enabled & present) */}
                {showOriginals && sub.originalText && (
                  <div className="mb-2 p-2 rounded-lg bg-slate-950/70 border border-slate-800/60 text-xs text-slate-400 font-sans">
                    <span className="text-[10px] uppercase font-bold text-slate-500 mr-2 tracking-wider">
                      মূল কথ্য বাক্য:
                    </span>
                    <span className="text-slate-300 select-text">{sub.originalText}</span>
                  </div>
                )}

                {/* Editable Subtitle Content Textarea */}
                <textarea
                  value={sub.text}
                  rows={Math.min(4, Math.max(2, lines.length))}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSubtitles((prev) =>
                      prev.map((s) => (s.id === sub.id ? { ...s, text: val, isCustomEdited: true } : s))
                    );
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs sm:text-sm text-slate-100 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 resize-none font-medium leading-relaxed select-text"
                  placeholder="সাবটাইটেল টেক্সট..."
                />

                {/* Bottom Segment Fine-Tuning & Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-800/60 text-xs">
                  {/* Time adjustments */}
                  <div className="flex flex-wrap items-center gap-1 font-mono text-[11px] text-slate-400">
                    {/* Live Speech Sync to Player */}
                    <button
                      onClick={() => setStartToCurrentTime(sub.id)}
                      className="px-2 py-0.5 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-800/90 rounded text-emerald-300 text-[10px] font-sans font-bold flex items-center gap-1 transition-colors cursor-pointer"
                      title="ভিডিও প্লেয়ারের বর্তমান সময়কে এই সাবটাইটেলের শুরুর সময় হিসেবে লক করুন"
                    >
                      <span>কথার শুরু ⏱</span>
                    </button>

                    <button
                      onClick={() => setEndToCurrentTime(sub.id)}
                      className="px-2 py-0.5 bg-teal-950/80 hover:bg-teal-900 border border-teal-800/90 rounded text-teal-300 text-[10px] font-sans font-bold flex items-center gap-1 transition-colors cursor-pointer"
                      title="ভিডিও প্লেয়ারের বর্তমান সময়কে এই সাবটাইটেলের শেষের সময় হিসেবে লক করুন"
                    >
                      <span>কথার শেষ ⏱</span>
                    </button>

                    <span className="text-slate-600 mx-1">|</span>

                    <span className="text-slate-500 mr-1 hidden sm:inline">শুরু:</span>
                    <button
                      onClick={() => adjustSegmentTime(sub.id, -0.5, 0)}
                      className="px-1.5 py-0.5 bg-slate-950 hover:bg-slate-800 rounded border border-slate-800 text-amber-300"
                      title="শুরুর সময় ০.৫ সেকেন্ড এগিয়ে আনুন"
                    >
                      -0.5s
                    </button>
                    <button
                      onClick={() => adjustSegmentTime(sub.id, -0.2, 0)}
                      className="px-1.5 py-0.5 bg-slate-950 hover:bg-slate-800 rounded border border-slate-800 text-slate-300"
                      title="শুরুর সময় ০.২ সেকেন্ড এগিয়ে আনুন"
                    >
                      -0.2s
                    </button>
                    <button
                      onClick={() => adjustSegmentTime(sub.id, 0.2, 0)}
                      className="px-1.5 py-0.5 bg-slate-950 hover:bg-slate-800 rounded border border-slate-800 text-slate-300"
                      title="শুরুর সময় ০.২ সেকেন্ড পিছিয়ে দিন"
                    >
                      +0.2s
                    </button>
                    <button
                      onClick={() => adjustSegmentTime(sub.id, 0.5, 0)}
                      className="px-1.5 py-0.5 bg-slate-950 hover:bg-slate-800 rounded border border-slate-800 text-emerald-300"
                      title="শুরুর সময় ০.৫ সেকেন্ড পিছিয়ে দিন"
                    >
                      +0.5s
                    </button>

                    <span className="text-slate-500 mx-1 hidden sm:inline">শেষ:</span>
                    <button
                      onClick={() => adjustSegmentTime(sub.id, 0, -0.5)}
                      className="px-1.5 py-0.5 bg-slate-950 hover:bg-slate-800 rounded border border-slate-800 text-amber-300"
                      title="শেষের সময় ০.৫ সেকেন্ড কমিয়ে আনুন"
                    >
                      -0.5s
                    </button>
                    <button
                      onClick={() => adjustSegmentTime(sub.id, 0, -0.2)}
                      className="px-1.5 py-0.5 bg-slate-950 hover:bg-slate-800 rounded border border-slate-800 text-slate-300"
                      title="শেষের সময় ০.২ সেকেন্ড কমিয়ে আনুন"
                    >
                      -0.2s
                    </button>
                    <button
                      onClick={() => adjustSegmentTime(sub.id, 0, 0.2)}
                      className="px-1.5 py-0.5 bg-slate-950 hover:bg-slate-800 rounded border border-slate-800 text-slate-300"
                      title="শেষের সময় ০.২ সেকেন্ড বাড়ান"
                    >
                      +0.2s
                    </button>
                    <button
                      onClick={() => adjustSegmentTime(sub.id, 0, 0.5)}
                      className="px-1.5 py-0.5 bg-slate-950 hover:bg-slate-800 rounded border border-slate-800 text-emerald-300"
                      title="শেষের সময় ০.৫ সেকেন্ড বাড়ান"
                    >
                      +0.5s
                    </button>
                  </div>

                  {/* Split, Add, Delete */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => splitSegment(sub)}
                      className="px-2 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white flex items-center gap-1 text-[11px] transition-colors"
                      title="এই সাবটাইটেলকে দুইটি ভাগে ভাগ করুন"
                    >
                      <Split className="w-3 h-3" />
                      <span className="hidden sm:inline">বিভাজন</span>
                    </button>

                    <button
                      onClick={() => addNewSegmentAfter(sub.index)}
                      className="px-2 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-emerald-400 hover:text-emerald-300 flex items-center gap-1 text-[11px] transition-colors"
                      title="এর পরে নতুন একটি ব্লক যোগ করুন"
                    >
                      <Plus className="w-3 h-3" />
                    </button>

                    <button
                      onClick={() => deleteSegment(sub.id)}
                      disabled={subtitles.length <= 1}
                      className="p-1 rounded bg-slate-950 hover:bg-red-950/60 border border-slate-800 hover:border-red-800 text-slate-500 hover:text-red-400 transition-colors disabled:opacity-30"
                      title="এই সাবটাইটেল ব্লকটি মুছে ফেলুন"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

    </div>
  );
};
