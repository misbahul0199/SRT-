import React, { useState, useEffect } from 'react';
import { 
  Sliders, Type, Clock, Eye, EyeOff, RotateCcw, Check, Sparkles, AlertCircle, 
  KeyRound, ShieldCheck, ExternalLink, RefreshCw, Clipboard, Trash2, CheckCircle2, X
} from 'lucide-react';
import { AppSettings, SubtitleSegment } from '../types';
import { enforceSubtitleConstraints } from '../utils/subtitleUtils';
import { 
  getStoredApiKey, 
  setStoredApiKey, 
  removeStoredApiKey, 
  maskApiKey, 
  validateApiKeyOnServer 
} from '../utils/apiHelper';

interface SettingsTabProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  onSaveAndReturn: () => void;
  onResetDefaults: () => void;
  subtitles?: SubtitleSegment[];
  setSubtitles?: React.Dispatch<React.SetStateAction<SubtitleSegment[]>>;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settings,
  setSettings,
  onSaveAndReturn,
  onResetDefaults,
  subtitles = [],
  setSubtitles,
}) => {
  const [appliedNotification, setAppliedNotification] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string>(getStoredApiKey());
  const [apiKeyInput, setApiKeyInput] = useState<string>(getStoredApiKey());
  const [showKey, setShowKey] = useState<boolean>(false);
  const [isValidatingKey, setIsValidatingKey] = useState<boolean>(false);
  const [keyFeedback, setKeyFeedback] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    const updateSavedKey = () => {
      const key = getStoredApiKey();
      setSavedKey(key);
      setApiKeyInput(key);
    };
    updateSavedKey();
    window.addEventListener('subsync_api_key_changed', updateSavedKey);
    return () => window.removeEventListener('subsync_api_key_changed', updateSavedKey);
  }, []);

  const handleValidateKey = async () => {
    const key = apiKeyInput.trim();
    if (!key) {
      setKeyFeedback({ success: false, message: 'অনুগ্রহ করে প্রথমে একটি API Key পেস্ট বা টাইপ করুন।' });
      return;
    }
    setIsValidatingKey(true);
    setKeyFeedback(null);
    try {
      const res = await validateApiKeyOnServer(key);
      if (res.success) {
        setKeyFeedback({ success: true, message: res.message || 'API Key সফলভাবে যাচাই হয়েছে ও সক্রিয় আছে!' });
      } else {
        setKeyFeedback({ success: false, message: res.error || 'API Key টি সঠিক নয়।' });
      }
    } catch (err: any) {
      setKeyFeedback({ success: false, message: err.message || 'যাচাইয়ের সময় সংযোগ ব্যর্থ হয়েছে।' });
    } finally {
      setIsValidatingKey(false);
    }
  };

  const handleSaveApiKey = () => {
    const key = apiKeyInput.trim();
    if (!key) {
      setKeyFeedback({ success: false, message: 'সংরক্ষণ করার জন্য কোনো API Key পাওয়া যায়নি।' });
      return;
    }
    setStoredApiKey(key);
    setKeyFeedback({
      success: true,
      message: 'API Key সফলভাবে সংরক্ষিত হয়েছে! সমস্ত সাবটাইটেল ও কাটিং প্রসেসিং এখন আপনার নিজস্ব কোটায় চলবে।',
    });
    setTimeout(() => {
      setKeyFeedback(null);
    }, 4000);
  };

  const handleRemoveApiKey = () => {
    removeStoredApiKey();
    setApiKeyInput('');
    setKeyFeedback({
      success: true,
      message: 'Gemini API Key মুছে ফেলা হয়েছে। এআই ফিচার ব্যবহারের জন্য নিজস্ব কী আবশ্যক।',
    });
    setTimeout(() => {
      setKeyFeedback(null);
    }, 3000);
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setApiKeyInput(text.trim());
        setKeyFeedback(null);
      }
    } catch {
      // Fallback
    }
  };

  const sampleDemoText = "আন্তর্জাতিক মানদণ্ড অনুযায়ী প্রতিটি সাবটাইটেল লাইনে সীমিত সংখ্যক অক্ষর থাকা জরুরি যাতে দর্শক দ্রুত পড়তে পারেন।";

  // Count subtitles that currently exceed the character limit
  const oversizedCount = subtitles.filter((sub) => {
    const lines = sub.text.split('\n');
    return lines.some((l) => l.length > settings.maxCharsPerLine) || lines.length > settings.maxLines;
  }).length;

  const handleApplyToAllSubtitles = () => {
    if (!setSubtitles || subtitles.length === 0) return;
    const formatted = enforceSubtitleConstraints(subtitles, settings.maxCharsPerLine, settings.maxLines);
    setSubtitles(formatted);
    setAppliedNotification(
      `সফলভাবে ${subtitles.length}টি সাবটাইটেলকে সর্বোচ্চ ${settings.maxCharsPerLine} বর্ণে পুনর্গঠন করা হয়েছে (মোট ${formatted.length}টি সুনির্দিষ্ট ব্লকে প্রস্তুত)!`
    );
    setTimeout(() => setAppliedNotification(null), 4000);
  };

  const handleSave = () => {
    if (setSubtitles && subtitles.length > 0) {
      const formatted = enforceSubtitleConstraints(subtitles, settings.maxCharsPerLine, settings.maxLines);
      setSubtitles(formatted);
    }
    onSaveAndReturn();
  };

  return (
    <div className="flex-1 w-full p-4 sm:p-8 overflow-y-auto bg-slate-950 text-slate-100 pb-28">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        
        <div className="text-center space-y-1 mb-2">
          <div className="inline-flex items-center gap-1.5 bg-emerald-950/70 border border-emerald-800/80 text-emerald-300 px-3 py-1 rounded-full text-xs font-semibold">
            <Sliders className="w-3.5 h-3.5 text-emerald-400" />
            <span>কনফিগারেশন ও আউটপুট পছন্দসমূহ</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white">
            সাবটাইটেল ও এআই প্রসেসিং সেটিংস
          </h2>
          <p className="text-xs text-slate-400">
            নিজস্ব API Key কনফিগারেশন ও প্রতিটি লাইনের অক্ষর সংখ্যা (Character Limit) নিয়ন্ত্রণ করুন।
          </p>
        </div>

        {appliedNotification && (
          <div className="bg-emerald-950/90 border border-emerald-500/80 text-emerald-200 px-4 py-3 rounded-xl text-xs flex items-center gap-2.5 shadow-lg shadow-emerald-950/50">
            <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{appliedNotification}</span>
          </div>
        )}

        {/* --- DEDICATED COMPLETE API KEY MANAGEMENT (SINGLE UNIFIED LOCATION) --- */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl shrink-0 ${savedKey ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}`}>
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-white">
                    Gemini API Settings (Bring Your Own Key)
                  </h3>
                  <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-semibold border ${
                    savedKey 
                      ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300' 
                      : 'bg-amber-950/80 border-amber-700 text-amber-300'
                  }`}>
                    {savedKey ? 'কী সক্রিয় (Active)' : 'Key Required'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {savedKey 
                    ? `সক্রিয় কী: ${maskApiKey(savedKey)} (ডিভাইসে সংরক্ষিত)` 
                    : 'Gemini API key is required. Open Settings to add your key.'}
                </p>
              </div>
            </div>

            {savedKey && (
              <button
                type="button"
                onClick={handleRemoveApiKey}
                className="self-start sm:self-center text-xs text-rose-400 hover:text-rose-300 bg-rose-950/40 hover:bg-rose-950/80 border border-rose-900/60 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer font-medium"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>কী মুছে ফেলুন</span>
              </button>
            )}
          </div>

          {/* Key Input Field */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <span>Gemini API Key পেস্ট বা টাইপ করুন</span>
              </label>
              <button
                type="button"
                onClick={handlePasteFromClipboard}
                className="text-[11px] text-teal-400 hover:text-teal-300 flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Clipboard className="w-3 h-3" />
                <span>ক্লিপবোর্ড থেকে পেস্ট</span>
              </button>
            </div>

            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => {
                  setApiKeyInput(e.target.value);
                  setKeyFeedback(null);
                }}
                placeholder="AIzaSy..."
                className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 pr-20 text-xs sm:text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {apiKeyInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setApiKeyInput('');
                      setKeyFeedback(null);
                    }}
                    className="p-1 text-slate-400 hover:text-white rounded cursor-pointer"
                    title="মুছুন"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="p-1.5 text-slate-400 hover:text-white rounded transition-colors cursor-pointer"
                  title={showKey ? 'লুকান' : 'দেখান'}
                >
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {/* Feedback alert if any */}
          {keyFeedback && (
            <div className={`p-3 rounded-xl text-xs flex items-start gap-2.5 ${
              keyFeedback.success
                ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-300'
                : 'bg-rose-950/80 border border-rose-800 text-rose-300'
            }`}>
              {keyFeedback.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <span>{keyFeedback.message}</span>
            </div>
          )}

          {/* Test and Save Buttons */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleValidateKey}
              disabled={isValidatingKey || !apiKeyInput.trim()}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border border-slate-700"
            >
              {isValidatingKey ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-teal-400" />
                  <span>যাচাই হচ্ছে...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
                  <span>কী টেস্ট করুন</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleSaveApiKey}
              disabled={!apiKeyInput.trim() || apiKeyInput.trim() === savedKey}
              className="px-5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-950/50"
            >
              <Check className="w-3.5 h-3.5" />
              <span>কী সংরক্ষণ করুন</span>
            </button>

            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-xs text-teal-400 hover:text-teal-300 flex items-center gap-1 font-medium hover:underline cursor-pointer"
            >
              <span>ফ্রি কী পাওয়ার লিংক (Google AI Studio)</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Step-by-Step Help Box */}
          <div className="mt-3 bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5 text-xs space-y-2">
            <div className="font-bold text-slate-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>১ মিনিটে সম্পূর্ণ বিনামূল্যে Gemini API Key পাওয়ার উপায়:</span>
            </div>
            <ol className="list-decimal list-inside text-slate-400 space-y-1 pl-1 leading-relaxed text-[11px]">
              <li><strong className="text-slate-200">aistudio.google.com/apikey</strong> লিংকে যান।</li>
              <li>আপনার যেকোনো গুগল অ্যাকাউন্ট দিয়ে সাইন ইন করুন।</li>
              <li>নীল রঙের <strong className="text-emerald-400">'Create API key'</strong> বাটনে ক্লিক করে কী কপি করুন।</li>
              <li>এখানে পেস্ট করে <strong className="text-emerald-400">'কী সংরক্ষণ করুন'</strong> বাটনে চাপুন।</li>
            </ol>
            <p className="text-[10px] text-slate-500 pt-1 border-t border-slate-800/60">
              * এটি ১০০% ফ্রি এবং গুগলের সাধারণ অ্যাকাউন্টে কোনো ক্রেডিট কার্ড বা পেমেন্ট তথ্যের প্রয়োজন হয় না।
            </p>
          </div>
        </div>

        {/* --- SUBTITLE FORMAT SETTINGS --- */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
          
          {/* Max Chars Per Line */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <Type className="w-4 h-4 text-emerald-400" />
                <span>প্রতি লাইনে সর্বোচ্চ অক্ষর (Max Characters Per Line)</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="15"
                  max="90"
                  value={settings.maxCharsPerLine}
                  onChange={(e) => {
                    const val = Math.max(15, Math.min(90, Number(e.target.value) || 42));
                    setSettings((prev) => ({ ...prev, maxCharsPerLine: val }));
                  }}
                  className="w-16 bg-slate-950 border border-slate-700 text-emerald-400 font-mono text-center text-xs font-bold py-1 px-1 rounded-lg focus:outline-none focus:border-emerald-500"
                />
                <span className="text-xs text-slate-400">বর্ণ</span>
              </div>
            </div>

            {/* Quick Presets */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-slate-400 mr-1">জনপ্রিয় মানদণ্ড:</span>
              {[
                { val: 30, label: '৩০ (রিলস/শর্টস)' },
                { val: 37, label: '৩৭ (টিভি সম্প্রচার)' },
                { val: 40, label: '৪০ (আদর্শ)' },
                { val: 42, label: '৪২ (নেটফ্লিক্স/বিবিসি)' },
                { val: 50, label: '৫০ (প্রশস্ত স্ক্রিন)' },
              ].map((preset) => (
                <button
                  key={preset.val}
                  type="button"
                  onClick={() => setSettings((prev) => ({ ...prev, maxCharsPerLine: preset.val }))}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                    settings.maxCharsPerLine === preset.val
                      ? 'bg-emerald-600 text-white border-emerald-500 font-bold shadow-sm'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <input
              type="range"
              min="15"
              max="90"
              step="1"
              value={settings.maxCharsPerLine}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, maxCharsPerLine: Number(e.target.value) }))
              }
              className="w-full accent-emerald-500 h-2 bg-slate-950 rounded cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-slate-500">
              <span>১৫ (সংক্ষিপ্ত)</span>
              <span>৪২ (আন্তর্জাতিক ব্রডকাস্ট মান)</span>
              <span>৯০ (সর্বোচ্চ)</span>
            </div>

            {/* Live Preview Box */}
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-semibold text-slate-300">লাইভ প্রিভিউ (বর্তমান সীমা: {settings.maxCharsPerLine} বর্ণ/লাইন):</span>
                <span className="font-mono text-emerald-400 text-[10px]">অটোমেটিক লাইন-র‍্যাপিং</span>
              </div>
              <div className="p-2.5 bg-slate-900/90 rounded-lg text-xs font-medium text-emerald-200 font-mono leading-relaxed border border-slate-800">
                {sampleDemoText.match(new RegExp(`.{1,${settings.maxCharsPerLine}}(\\s|$)`, 'g'))?.map((line, idx) => (
                  <div key={idx} className="flex items-center justify-between py-0.5 border-b border-slate-800/40 last:border-0">
                    <span>{line.trim()}</span>
                    <span className="text-[10px] text-slate-500 ml-2 font-mono shrink-0">({line.trim().length} বর্ণ)</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Existing Subtitles Enforce Action */}
            {subtitles.length > 0 && (
              <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    {oversizedCount > 0 ? (
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    ) : (
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    )}
                    <span>বিদ্যমান {subtitles.length}টি সাবটাইটেল সেগমেন্ট</span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {oversizedCount > 0
                      ? `${oversizedCount}টি সেগমেন্ট নির্ধারিত ${settings.maxCharsPerLine} অক্ষরের চেয়ে বড়। এই বাটনে ক্লিক করলে সেগুলো স্বয়ংক্রিয়ভাবে ছোট ব্লকে ভাগ হয়ে যাবে।`
                      : `বর্তমানে সবকটি সাবটাইটেল নির্ধারিত সীমার মধ্যে রয়েছে।`}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleApplyToAllSubtitles}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-950 flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>এখনই বিন্যস্ত করুন</span>
                </button>
              </div>
            )}
          </div>

          {/* Max Lines Per Subtitle Block */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-400" />
                <span>প্রতি ব্লকে সর্বোচ্চ লাইন সংখ্যা (Max Lines Per Block)</span>
              </label>
              <span className="font-mono text-xs font-bold text-emerald-400 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                {settings.maxLines} লাইন
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1">
              {[1, 2, 3].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setSettings((prev) => ({ ...prev, maxLines: num }))}
                  className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                    settings.maxLines === num
                      ? 'bg-emerald-600 text-white border-emerald-500 shadow-md'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {num} লাইন {num === 2 ? '(স্ট্যান্ডার্ড)' : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Global Time Offset (ms) */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-400" />
                <span>গ্লোবাল টাইম অফসেট (Global Delay / Lead Offset)</span>
              </label>
              <span className="font-mono text-xs font-bold text-teal-400 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                {settings.globalOffsetMs > 0 ? `+${settings.globalOffsetMs}` : settings.globalOffsetMs} ms
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setSettings((prev) => ({ ...prev, globalOffsetMs: prev.globalOffsetMs - 100 }))
                }
                className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono hover:bg-slate-800 text-slate-300"
              >
                -100ms
              </button>
              <input
                type="range"
                min="-1500"
                max="1500"
                step="50"
                value={settings.globalOffsetMs}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, globalOffsetMs: Number(e.target.value) }))
                }
                className="flex-1 accent-teal-500 h-2 bg-slate-950 rounded cursor-pointer"
              />
              <button
                type="button"
                onClick={() =>
                  setSettings((prev) => ({ ...prev, globalOffsetMs: prev.globalOffsetMs + 100 }))
                }
                className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono hover:bg-slate-800 text-slate-300"
              >
                +100ms
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              ভিডিওর অডিওর সাথে সাবটাইটেল আরও আগে বা পরে দেখাতে এই অফসেট ব্যবহার করুন।
            </p>
          </div>

          {/* Subtitle Display Font Size on Player */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <Eye className="w-4 h-4 text-emerald-400" />
                <span>প্লেয়ারে সাবটাইটেলের ফন্ট সাইজ (Player Font Size)</span>
              </label>
              <span className="font-mono text-xs font-bold text-slate-300 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                {settings.subtitleFontSize}px
              </span>
            </div>
            <input
              type="range"
              min="14"
              max="28"
              step="1"
              value={settings.subtitleFontSize}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, subtitleFontSize: Number(e.target.value) }))
              }
              className="w-full accent-emerald-500 h-2 bg-slate-950 rounded cursor-pointer"
            />
          </div>

          {/* Buttons Footer */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onResetDefaults}
              className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>ডিফল্টে ফিরিয়ে নিন</span>
            </button>

            <button
              type="button"
              onClick={handleSave}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-lg shadow-emerald-900/30 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>সেভ করে স্টুডিওতে যান</span>
            </button>
          </div>

        </div>

      </div>
    </div>
  );
};
