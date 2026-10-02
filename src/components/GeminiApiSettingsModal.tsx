import React, { useState, useEffect } from 'react';
import { 
  KeyRound, ShieldCheck, Eye, EyeOff, CheckCircle2, AlertTriangle, 
  X, ExternalLink, RefreshCw, Trash2, Check, Sparkles, HelpCircle,
  Copy, ClipboardCheck
} from 'lucide-react';
import { 
  getStoredApiKey, 
  setStoredApiKey, 
  removeStoredApiKey, 
  validateApiKeyOnServer,
  maskApiKey
} from '../utils/apiHelper';

interface GeminiApiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isFirstRun?: boolean;
}

export const GeminiApiSettingsModal: React.FC<GeminiApiSettingsModalProps> = ({
  isOpen,
  onClose,
  isFirstRun = false,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [showKey, setShowKey] = useState<boolean>(false);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [validationResult, setValidationResult] = useState<{
    status: 'idle' | 'valid' | 'invalid' | 'quota_exhausted';
    message: string;
    verifiedModel?: string;
  }>({ status: 'idle', message: '' });
  const [savedSuccessMessage, setSavedSuccessMessage] = useState<string | null>(null);

  // Load existing key from localStorage
  useEffect(() => {
    if (isOpen) {
      const current = getStoredApiKey();
      setApiKeyInput(current);
      setSavedSuccessMessage(null);
      if (current) {
        setValidationResult({
          status: 'idle',
          message: `Saved locally (${maskApiKey(current)})`,
        });
      } else {
        setValidationResult({
          status: 'idle',
          message: 'Gemini API key is required. Open Settings to add your key.',
        });
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    const key = apiKeyInput.trim();
    if (!key) {
      setValidationResult({
        status: 'invalid',
        message: 'অনুগ্রহ করে প্রথমে একটি Gemini API Key ইনপুট করুন। (Please enter an API key first)',
      });
      return;
    }

    setIsValidating(true);
    setValidationResult({ status: 'idle', message: 'Testing connection with Gemini API...' });
    setSavedSuccessMessage(null);

    try {
      const res = await validateApiKeyOnServer(key);
      if (res.success) {
        setValidationResult({
          status: 'valid',
          message: res.message || 'Connection successful! API key is valid and active.',
        });
      } else {
        const isQuota = res.error?.includes('quota') || res.error?.includes('429');
        setValidationResult({
          status: isQuota ? 'quota_exhausted' : 'invalid',
          message: res.error || 'Invalid or expired API key. Please check your key from Google AI Studio.',
        });
      }
    } catch (err: any) {
      setValidationResult({
        status: 'invalid',
        message: err.message || 'Failed to connect. Please check your internet or API key.',
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleSave = () => {
    const key = apiKeyInput.trim();
    if (!key) {
      setValidationResult({
        status: 'invalid',
        message: 'সংরক্ষণ করার জন্য কোনো API Key দেওয়া হয়নি। (No key entered to save)',
      });
      return;
    }

    setStoredApiKey(key);
    setSavedSuccessMessage('API Key saved locally on your device!');
    setValidationResult({
      status: 'valid',
      message: 'Active and configured locally.',
    });

    setTimeout(() => {
      onClose();
    }, 1200);
  };

  const handleClear = () => {
    removeStoredApiKey();
    setApiKeyInput('');
    setSavedSuccessMessage(null);
    setValidationResult({
      status: 'idle',
      message: 'Gemini API key is required. Open Settings to add your key.',
    });
  };

  const handlePaste = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          setApiKeyInput(text.trim());
        }
      }
    } catch (_) {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2">
                {isFirstRun ? 'Welcome to SubSync AI Studio' : 'Gemini API Settings'}
              </h2>
              <p className="text-xs text-slate-400">
                {isFirstRun
                  ? 'To use AI features, enter your own Gemini API key.'
                  : 'Bring Your Own Key (BYOK) — Keys are stored locally on your device only.'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5">
          {/* Connection Status Indicator */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0">
                {isValidating ? (
                  <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
                ) : validationResult.status === 'valid' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : validationResult.status === 'invalid' || validationResult.status === 'quota_exhausted' ? (
                  <AlertTriangle className="w-5 h-5 text-rose-400" />
                ) : apiKeyInput.trim() ? (
                  <ShieldCheck className="w-5 h-5 text-teal-400" />
                ) : (
                  <KeyRound className="w-5 h-5 text-slate-500" />
                )}
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-200">Connection Status</div>
                <div className="text-[11px] text-slate-400 truncate max-w-xs sm:max-w-md">
                  {validationResult.message || 'Gemini API key is required. Open Settings to add your key.'}
                </div>
              </div>
            </div>

            {/* Status Pill */}
            <div className="shrink-0">
              {validationResult.status === 'valid' ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Connected
                </span>
              ) : validationResult.status === 'invalid' ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-950 text-rose-300 border border-rose-800">
                  Invalid Key
                </span>
              ) : validationResult.status === 'quota_exhausted' ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
                  Quota Limit
                </span>
              ) : apiKeyInput.trim() ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                  Saved Locally
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-950/60 text-amber-400 border border-amber-800/80">
                  Key Required
                </span>
              )}
            </div>
          </div>

          {/* Key Input Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="gemini-key-input" className="text-xs font-bold text-slate-300">
                Gemini API Key
              </label>
              <button
                type="button"
                onClick={handlePaste}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <ClipboardCheck className="w-3.5 h-3.5" />
                <span>Paste from clipboard</span>
              </button>
            </div>

            <div className="relative flex items-center">
              <input
                id="gemini-key-input"
                type={showKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => {
                  setApiKeyInput(e.target.value);
                  setSavedSuccessMessage(null);
                }}
                placeholder="AIzaSy..."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 pr-20 text-xs sm:text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500 font-mono tracking-wide"
              />

              <div className="absolute right-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                  title={showKey ? 'Hide Key' : 'Show Key'}
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              Never shared with our servers. Your key is stored in your device&apos;s browser/application storage.
            </p>
          </div>

          {/* Action Buttons: Test, Save, Clear */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isValidating || !apiKeyInput.trim()}
              className="flex-1 min-w-[140px] px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isValidating ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                  <span>Testing Connection...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Test Connection</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={!apiKeyInput.trim()}
              className="flex-1 min-w-[140px] px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check className="w-4 h-4" />
              <span>Save API Key</span>
            </button>

            {apiKeyInput.trim() && (
              <button
                type="button"
                onClick={handleClear}
                className="px-3 py-2.5 rounded-xl text-xs font-semibold bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
                title="Clear API Key"
              >
                <Trash2 className="w-4 h-4" />
                <span className="hidden sm:inline">Clear Key</span>
              </button>
            )}
          </div>

          {/* Feedback messages */}
          {savedSuccessMessage && (
            <div className="p-3 bg-emerald-950/60 border border-emerald-800/80 rounded-xl text-xs text-emerald-300 flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{savedSuccessMessage}</span>
            </div>
          )}

          {/* Free Tier Help / How to Get Key */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>How to get a Free Gemini API Key</span>
              </span>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
              >
                <span>Google AI Studio</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <ol className="text-[11px] text-slate-400 space-y-1 list-decimal list-inside leading-relaxed">
              <li>Visit <strong className="text-slate-200">Google AI Studio</strong> (aistudio.google.com).</li>
              <li>Sign in with your Google account and click <strong className="text-slate-200">&quot;Get API key&quot;</strong>.</li>
              <li>Create a new key (free of charge) and paste it into the field above.</li>
              <li>SubSync supports Flash Lite, 2.5 Flash, and 3.8 Flash automatically.</li>
            </ol>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-3 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <span className="text-[11px] text-slate-500 font-mono">
            BYOK Architecture • 100% Client-Side Privacy
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {isFirstRun ? 'Skip for now' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};
