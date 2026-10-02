import React, { useState, useEffect } from 'react';
import { 
  Upload, Sparkles, RefreshCw, ArrowRight, CheckCircle2, 
  FileAudio, Languages, HelpCircle, Layers, PlayCircle, Zap,
  FileText, AlertTriangle, X, ExternalLink, KeyRound
} from 'lucide-react';
import { SOURCE_LANGUAGES, TARGET_LANGUAGES } from '../utils/languages';
import { AppSettings, SubtitleSegment } from '../types';
import { DEMO_SUBTITLES_SAMPLE, createSyntheticDemoAudioBlob } from '../utils/sampleData';
import { safeFetchJson, getStoredApiKey, setStoredApiKey } from '../utils/apiHelper';
import { enforceSubtitleConstraints, parseSrtContent } from '../utils/subtitleUtils';
import { GeminiApiSettingsModal } from './GeminiApiSettingsModal';

interface UploadWorkflowProps {
  file: File | null;
  setFile: (file: File | null) => void;
  mediaUrl: string | null;
  setMediaUrl: (url: string | null) => void;
  duration: number;
  setDuration: (dur: number) => void;
  sourceLang: string;
  setSourceLang: (lang: string) => void;
  targetLang: string;
  setTargetLang: (lang: string) => void;
  settings: AppSettings;
  setSubtitles: (subs: SubtitleSegment[]) => void;
  setActiveTab: (tab: 'workflow' | 'editor' | 'settings') => void;
}

export const UploadWorkflow: React.FC<UploadWorkflowProps> = ({
  file,
  setFile,
  mediaUrl,
  setMediaUrl,
  duration,
  setDuration,
  sourceLang,
  setSourceLang,
  targetLang,
  setTargetLang,
  settings,
  setSubtitles,
  setActiveTab,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeAction, setActiveAction] = useState<'srt' | null>(null);
  const [progressStage, setProgressStage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [processingError, setProcessingError] = useState('');
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [detectedCharacters, setDetectedCharacters] = useState<string[]>([]);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);

  const applyGeneratedSubtitles = (data: { detectedLanguage?: string; segments: any[] }) => {
    if (data.detectedLanguage) {
      setDetectedLanguage(data.detectedLanguage);
    }

    const generatedSegments: SubtitleSegment[] = data.segments.map((seg: any, idx: number) => ({
      id: seg.index || idx + 1,
      index: seg.index || idx + 1,
      start: Number(seg.start || 0),
      end: Number(seg.end || seg.start + 2),
      originalText: seg.originalText || '',
      text: String(seg.text || '').trim(),
      speaker: seg.speaker || `Speaker 1`,
      speakerGender: seg.speakerGender || 'male',
      speakerRole: seg.speakerRole || '',
      detectedLanguage: seg.detectedLanguage || data.detectedLanguage || 'Auto',
      assignedVoice: seg.assignedVoice || (seg.speakerGender === 'female' ? 'Aoede' : seg.speakerGender === 'child' ? 'Zephyr' : 'Charon'),
    }));

    // Strictly enforce broadcast character and line limits on all generated segments
    const constrainedSegments = enforceSubtitleConstraints(
      generatedSegments,
      settings.maxCharsPerLine,
      settings.maxLines
    );

    const uniqueCharacters = Array.from(new Set(constrainedSegments.map((s) => s.speaker || 'Speaker 1')));
    setDetectedCharacters(uniqueCharacters);
    setSubtitles(constrainedSegments);

    setProgressPercent(100);
    setProgressStage('সম্পূর্ণ হয়েছে — আপনার নিখুঁত টাইমকোড SRT সাবটাইটেল প্রস্তুত!');
    setTimeout(() => {
      setActiveTab('editor');
    }, 600);
  };

  // Resume a background job if user previously left the app
  const resumeBackgroundJob = async (jobId: string, savedFileName: string) => {
    setIsProcessing(true);
    setActiveAction('srt');
    setProgressPercent(60);
    setProgressStage(`পূর্ববর্তী ব্যাকগ্রাউন্ড প্রসেসিং পুনরুদ্ধার করা হচ্ছে (${savedFileName})...`);

    try {
      let jobCompleted = false;
      let finalResultData: any = null;
      const pollStartTime = Date.now();

      while (!jobCompleted) {
        if (Date.now() - pollStartTime > 15 * 60 * 1000) {
          throw new Error('প্রসেসিং সেশনের সময় উত্তীর্ণ হয়েছে।');
        }

        const pollRes = await safeFetchJson<{
          success: boolean;
          jobId: string;
          status: 'processing' | 'completed' | 'failed';
          progress: number;
          stage: string;
          result?: { detectedLanguage: string; segments: any[] };
          error?: string;
        }>(`/api/upload/job-status/${jobId}`);

        if (pollRes.status === 'failed') {
          throw new Error(pollRes.error || 'প্রসেসিং সম্পন্ন করা যায়নি।');
        }

        if (pollRes.status === 'processing') {
          if (typeof pollRes.progress === 'number' && pollRes.progress > 0) {
            setProgressPercent(pollRes.progress);
          }
          if (pollRes.stage) setProgressStage(pollRes.stage);
        }

        if (pollRes.status === 'completed' && pollRes.result) {
          jobCompleted = true;
          finalResultData = pollRes.result;
          setProgressPercent(100);
          setProgressStage('সাবটাইটেল সফলভাবে তৈরি হয়েছে!');
        }

        if (!jobCompleted) {
          await new Promise((r) => setTimeout(r, 1400));
        }
      }

      if (finalResultData && Array.isArray(finalResultData.segments)) {
        applyGeneratedSubtitles(finalResultData);
        localStorage.removeItem('subsync_active_job');
      }
    } catch (err: any) {
      console.error(err);
      setProcessingError(err.message || 'পূর্ববর্তী প্রসেসিং পুনরুদ্ধার ব্যর্থ হয়েছে।');
      localStorage.removeItem('subsync_active_job');
    } finally {
      setIsProcessing(false);
      setActiveAction(null);
    }
  };

  // Check for active background job on component mount
  useEffect(() => {
    const savedJobJson = localStorage.getItem('subsync_active_job');
    if (!savedJobJson) return;

    try {
      const savedJob = JSON.parse(savedJobJson);
      if (savedJob && savedJob.jobId && Date.now() - savedJob.time < 30 * 60 * 1000) {
        resumeBackgroundJob(savedJob.jobId, savedJob.fileName || 'ফাইল');
      } else {
        localStorage.removeItem('subsync_active_job');
      }
    } catch {
      localStorage.removeItem('subsync_active_job');
    }
  }, []);

  const handleFileUpload = (uploadedFile: File) => {
    setFile(uploadedFile);
    setProcessingError('');
    setDetectedLanguage(null);
    setDetectedCharacters([]);

    // Direct SRT / VTT subtitle file upload support
    if (uploadedFile.name.toLowerCase().endsWith('.srt') || uploadedFile.name.toLowerCase().endsWith('.vtt')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text) {
          const parsed = parseSrtContent(text);
          if (parsed.length > 0) {
            setSubtitles(parsed);
            const maxTime = Math.max(...parsed.map((p) => p.end), 10);
            setDuration(maxTime);
            setProgressPercent(100);
            setProgressStage(`সফলভাবে ${parsed.length}টি সাবটাইটেল সেগমেন্ট লোড হয়েছে!`);
            setTimeout(() => {
              setActiveTab('editor');
            }, 600);
          } else {
            setProcessingError('SRT/VTT ফাইলটি সঠিকভাবে পড়তে পারা যায়নি। অনুগ্রহ করে ফাইল ফরম্যাট যাচাই করুন।');
          }
        }
      };
      reader.readAsText(uploadedFile, 'UTF-8');
      return;
    }

    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    const url = URL.createObjectURL(uploadedFile);
    setMediaUrl(url);

    // Read media duration accurately
    const isVideo = uploadedFile.type.startsWith('video');
    const mediaElem = document.createElement(isVideo ? 'video' : 'audio');
    mediaElem.src = url;
    mediaElem.onloadedmetadata = () => {
      if (isFinite(mediaElem.duration) && mediaElem.duration > 0) {
        setDuration(mediaElem.duration);
      }
    };
  };

  const fileToBase64 = (f: Blob | File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(f);
      reader.onload = () => {
        const result = reader.result as string;
        const base64String = result.split(',')[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleLoadDemo = () => {
    const demoBlob = createSyntheticDemoAudioBlob();
    const demoFile = new File([demoBlob], 'Multilingual_Characters_Demo.wav', { type: 'audio/wav' });
    handleFileUpload(demoFile);
    setSourceLang('auto');
    setTargetLang('bn');
    setDuration(15.5);
    setSubtitles(DEMO_SUBTITLES_SAMPLE);
    setDetectedLanguage('Multilingual (Urdu / English / Hindi)');
    setDetectedCharacters(['Speaker 1 (পুরুষ)', 'Speaker 2 (মহিলা)', 'Speaker 3 (বাচ্চা)']);
    setProgressPercent(100);
    setProgressStage('মিশ্র ভাষা ও ৩টি ক্যারেক্টার (পুরুষ, মহিলা, বাচ্চা) সফলভাবে লোড হয়েছে!');
    setTimeout(() => {
      setActiveTab('editor');
    }, 600);
  };

  const runPipeline = async (actionType: 'srt' | 'dubbing') => {
    setProcessingError('');

    if (!getStoredApiKey()) {
      setProcessingError('Gemini API key is required. Open Settings to add your key.');
      setShowApiKeyModal(true);
      return;
    }

    if (!file) {
      setProcessingError('অনুগ্রহ করে প্রথমে যেকোনো অডিও বা ভিডিও ফাইল আপলোড করুন।');
      return;
    }

    setIsProcessing(true);
    setActiveAction(actionType);
    setProgressPercent(5);
    setProgressStage('মিডিয়া ফাইল প্রস্তুত ও যাচাই করা হচ্ছে...');

    try {
      // 2.5MB per chunk with automatic retry for rock-solid mobile transfers
      const CHUNK_SIZE = 2.5 * 1024 * 1024;
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

      // 1. Initialize Chunked Upload Session
      setProgressStage('আপলোড সেশন প্রস্তুত হচ্ছে...');
      const initData = await safeFetchJson<{ uploadId: string }>(
        '/api/upload/init',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            totalSize: file.size,
            totalChunks,
            mimeType: file.type || 'video/mp4',
          }),
        },
        'আপলোড সেশন তৈরি করতে ব্যর্থ হয়েছে।'
      );

      const uploadId = initData.uploadId;

      // 2. Upload Chunks Concurrently with Live Progress and automatic retry
      let uploadedChunks = 0;
      let nextChunkIdx = 0;
      const UPLOAD_CONCURRENCY = Math.min(2, totalChunks);

      async function uploadWorker() {
        while (nextChunkIdx < totalChunks) {
          const i = nextChunkIdx++;
          const start = i * CHUNK_SIZE;
          const end = Math.min(file.size, start + CHUNK_SIZE);
          const chunkBlob = file.slice(start, end);
          const chunkBase64 = await fileToBase64(chunkBlob);

          let attempts = 0;
          let success = false;
          while (!success && attempts < 3) {
            attempts++;
            try {
              const chunkRes = await fetch('/api/upload/chunk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  uploadId,
                  chunkIndex: i,
                  chunkBase64,
                }),
              });

              if (!chunkRes.ok) {
                throw new Error(`HTTP ${chunkRes.status}`);
              }
              success = true;
            } catch (chunkErr) {
              if (attempts >= 3) {
                throw new Error(`খণ্ড ${i + 1}/${totalChunks} আপলোডে সমস্যা হয়েছে (${chunkErr})। ইন্টারনেট সংযোগ পরীক্ষা করুন।`);
              }
              await new Promise((r) => setTimeout(r, 1000 * attempts));
            }
          }

          uploadedChunks++;
          const currentUploadProgress = Math.round((uploadedChunks / totalChunks) * 50);
          const currentProgress = 5 + currentUploadProgress;
          const stageText = `ফাইল দ্রুত আপলোড হচ্ছে: ${Math.round((uploadedChunks / totalChunks) * 100)}% (${uploadedChunks}/${totalChunks})...`;
          setProgressPercent(currentProgress);
          setProgressStage(stageText);
        }
      }

      const uploadWorkers = Array.from({ length: UPLOAD_CONCURRENCY }, () => uploadWorker());
      await Promise.all(uploadWorkers);

      // 3. Initiate Asynchronous Subtitle Generation Job
      setProgressPercent(55);
      setProgressStage('সার্ভারে সাবটাইটেল প্রসেসিং শুরু হচ্ছে...');

      const initJobData = await safeFetchJson<{
        success: boolean;
        jobId: string;
      }>(
        '/api/upload/complete-and-generate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uploadId,
            totalChunks,
            sourceLang,
            targetLang,
            duration,
            maxCharsPerLine: settings.maxCharsPerLine,
            maxLines: settings.maxLines,
            customApiKey: getStoredApiKey(),
          }),
        },
        'সাবটাইটেল প্রসেসিং সেশন শুরু করা যায়নি।'
      );

      const jobId = initJobData.jobId;

      // Persist active job for background recovery if user leaves the tab/app
      localStorage.setItem('subsync_active_job', JSON.stringify({
        jobId,
        fileName: file.name,
        time: Date.now(),
      }));

      // 4. Poll background job status with live percentage and notification feedback
      let jobCompleted = false;
      let finalResultData: { detectedLanguage?: string; segments: any[] } | null = null;
      const pollStartTime = Date.now();
      const MAX_POLL_TIME = 15 * 60 * 1000; // 15 minutes limit

      while (!jobCompleted) {
        if (Date.now() - pollStartTime > MAX_POLL_TIME) {
          throw new Error('ফাইল প্রসেসিং সম্পন্ন হতে অতিরিক্ত সময় লাগছে। অনুগ্রহ করে পুনরায় চেষ্টা করুন।');
        }

        await new Promise((resolve) => setTimeout(resolve, 1400));

        let pollRes: any;
        try {
          pollRes = await safeFetchJson<{
            success: boolean;
            jobId: string;
            status: 'processing' | 'completed' | 'failed';
            progress: number;
            stage: string;
            result?: { detectedLanguage: string; segments: any[] };
            error?: string;
          }>(`/api/upload/job-status/${jobId}`);
        } catch (pollErr: any) {
          console.warn('Transient poll notice, retrying in background...', pollErr);
          continue;
        }

        if (pollRes.status === 'failed') {
          throw new Error(pollRes.error || 'সাবটাইটেল তৈরি করতে সমস্যা হয়েছে।');
        }

        if (pollRes.status === 'processing') {
          if (typeof pollRes.progress === 'number' && pollRes.progress > 0) {
            setProgressPercent(pollRes.progress);
          }
          if (pollRes.stage) {
            setProgressStage(pollRes.stage);
          }
        }

        if (pollRes.status === 'completed' && pollRes.result) {
          jobCompleted = true;
          finalResultData = pollRes.result;
          setProgressPercent(100);
          setProgressStage('সাবটাইটেল সফলভাবে তৈরি হয়েছে!');
        }
      }

      if (!finalResultData || !Array.isArray(finalResultData.segments)) {
        throw new Error('সার্ভার থেকে কোনো সাবটাইটেল পাওয়া যায়নি।');
      }

      applyGeneratedSubtitles(finalResultData);
      localStorage.removeItem('subsync_active_job');
    } catch (err: any) {
      console.error(err);
      setProcessingError(err.message || 'প্রসেসিংয়ের সময় সমস্যা হয়েছে।');
    } finally {
      setIsProcessing(false);
      setActiveAction(null);
    }
  };

  return (
    <div className="flex-1 w-full overflow-y-auto bg-slate-950 text-slate-100 p-4 sm:p-8 pb-32">
      <div className="w-full max-w-3xl mx-auto flex flex-col space-y-6">
        
        {/* Intro Badge */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 bg-emerald-950/70 border border-emerald-800/80 text-emerald-300 px-3.5 py-1 rounded-full text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>বহুভাষিক সাবটাইটেল জেনারেটর ও এআই ভয়েস ডাবিং স্টুডিও</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            যেকোনো ভাষার অডিও/ভিডিও থেকে নির্ভুল SRT ও ডাবিং তৈরি করুন
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 max-w-xl mx-auto leading-relaxed">
            উর্দু, ইংরেজি, কোরিয়ান, চাইনিজ, হিন্দি ইত্যাদি যেকোনো ভাষার কথা শনাক্ত করে প্রতিটি ডায়ালগের সুনির্দিষ্ট টাইমকোডসহ পেশাদার সাবটাইটেল ও সিনক্রোনাইজড এআই ভয়েস ডাবিং তৈরি করুন।
          </p>
        </div>


        {/* Upload Box */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-2xl relative overflow-hidden">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xs sm:text-sm font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-emerald-950 border border-emerald-800 flex items-center justify-center text-[11px] text-emerald-400 font-mono">1</span>
              অডিও বা ভিডিও ফাইল নির্বাচন করুন
            </h3>

            <button
              onClick={handleLoadDemo}
              type="button"
              className="text-xs text-teal-400 hover:text-teal-300 bg-teal-950/60 hover:bg-teal-900/60 border border-teal-800 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all font-medium cursor-pointer"
            >
              <PlayCircle className="w-3.5 h-3.5 text-teal-400" />
              <span>নমুনা অডিও দিয়ে ডেমো দেখুন</span>
            </button>
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) handleFileUpload(dropped);
            }}
            className="border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-xl p-6 sm:p-8 text-center cursor-pointer bg-slate-950/60 hover:bg-slate-950/90 transition-all group relative"
          >
            <input
              type="file"
              accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.mp4,.webm,.mkv,.srt,.vtt"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) handleFileUpload(picked);
              }}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
            <div className="bg-slate-900 w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-slate-800 group-hover:scale-105 group-hover:border-emerald-500/50 transition-all shadow-inner">
              <Upload className="w-6 h-6 text-emerald-400 group-hover:text-emerald-300" />
            </div>
            <p className="text-sm font-semibold text-slate-200">
              এখানে অডিও, ভিডিও বা SRT ফাইল ড্র্যাগ করুন অথবা <span className="text-emerald-400 underline decoration-emerald-500/50">ব্রাউজ করুন</span>
            </p>
            <p className="text-xs text-slate-500 mt-1.5">
              অডিও/ভিডিও (MP3, WAV, MP4, ইত্যাদি) অথবা সাবটাইটেল (.SRT, .VTT) সমর্থিত
            </p>

            {file && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 bg-emerald-950/90 border border-emerald-700/80 text-emerald-300 p-3 rounded-xl text-xs shadow">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="truncate max-w-xs font-mono font-semibold">{file.name}</span>
                  <span className="text-slate-400">({(file.size / (1024 * 1024)).toFixed(1)} MB{duration > 0 ? ` • ${duration.toFixed(1)}s` : ''})</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    runPipeline('srt');
                  }}
                  disabled={isProcessing}
                  className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-lg text-xs shadow flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isProcessing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  <span>{isProcessing ? 'তৈরি হচ্ছে...' : 'সাবটাইটেল তৈরি করুন'}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Language Selection Grid */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl">
          <h3 className="text-xs sm:text-sm font-bold text-emerald-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-emerald-950 border border-emerald-800 flex items-center justify-center text-[11px] text-emerald-400 font-mono">2</span>
            উৎস ও লক্ষ্য ভাষা নির্ধারণ (Multi-Language Settings)
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Source Language */}
            <div className="bg-slate-950/80 border border-slate-800 p-3.5 rounded-xl">
              <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center justify-between">
                <span>মূল অডিওর ভাষা (Source Language)</span>
                <span className="text-[10px] text-emerald-400 font-normal">স্পিচ ডিটেকশন</span>
              </label>
              <select
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs sm:text-sm text-slate-100 focus:outline-none focus:border-emerald-500 cursor-pointer font-sans"
              >
                {SOURCE_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.flag} {lang.name}
                  </option>
                ))}
              </select>

              {/* Quick source pills */}
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {[
                  { code: 'ur', label: 'উর্দু' },
                  { code: 'en', label: 'English' },
                  { code: 'ko', label: 'কোরিয়ান' },
                  { code: 'zh', label: 'চাইনিজ' },
                  { code: 'hi', label: 'হিন্দি' },
                  { code: 'auto', label: 'অটো' },
                ].map((pill) => (
                  <button
                    key={pill.code}
                    type="button"
                    onClick={() => setSourceLang(pill.code)}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                      sourceLang === pill.code
                        ? 'bg-emerald-600 text-white shadow'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Target Language */}
            <div className="bg-slate-950/80 border border-slate-800 p-3.5 rounded-xl">
              <label className="block text-xs font-bold text-slate-300 mb-1.5 flex items-center justify-between">
                <span>সাবটাইটেল ও ডাবিং ভাষা (Target Language)</span>
                <span className="text-[10px] text-teal-400 font-normal">অনুবাদ ও কণ্ঠস্বর</span>
              </label>
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs sm:text-sm text-slate-100 focus:outline-none focus:border-teal-500 cursor-pointer font-sans"
              >
                {TARGET_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.flag} {lang.name}
                  </option>
                ))}
              </select>

              {/* Quick target pills */}
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {[
                  { code: 'bn', label: 'বাংলা' },
                  { code: 'en', label: 'English' },
                  { code: 'ur', label: 'উর্দু' },
                  { code: 'hi', label: 'হিন্দি' },
                  { code: 'ko', label: 'কোরিয়ান' },
                  { code: 'zh', label: 'চাইনিজ' },
                ].map((pill) => (
                  <button
                    key={pill.code}
                    type="button"
                    onClick={() => setTargetLang(pill.code)}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                      targetLang === pill.code
                        ? 'bg-teal-600 text-white shadow'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Subtitle Rule Snapshot */}
          <div className="mt-4 p-3 bg-slate-950/60 rounded-xl border border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>
                ফরমেট নিয়ম: প্রতি লাইনে সর্বোচ্চ <strong className="text-emerald-400 font-mono">{settings.maxCharsPerLine}</strong> অক্ষর • সর্বোচ্চ <strong className="text-emerald-400 font-mono">{settings.maxLines}</strong> লাইন
              </span>
            </div>
            <span className="text-[11px] text-slate-500 hidden sm:inline">সেটিংস ট্যাব থেকে কাস্টমাইজযোগ্য</span>
          </div>
        </div>

        {/* Action Buttons & Processing Status */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
            <div>
              <div className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                সাবটাইটেল তৈরি শুরু করুন (Generate Subtitles)
              </div>
              <div className="text-[11px] text-slate-400 font-normal">
                কথার নিখুঁত টাইমিং অনুযায়ী SRT সাবটাইটেল তৈরি হবে
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-1.5 bg-amber-950/60 border border-amber-600/60 text-amber-300 px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide w-fit">
                <Zap className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span>টার্বো ইঞ্জিন</span>
              </div>
              <button
                id="generate-srt-btn"
                type="button"
                onClick={() => runPipeline('srt')}
                disabled={isProcessing || !file}
                className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs shadow-md shadow-emerald-900/30 flex items-center gap-2 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isProcessing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-emerald-200" />}
                <span>{isProcessing ? 'তৈরি হচ্ছে...' : 'সাবটাইটেল তৈরি করুন'}</span>
              </button>
            </div>
          </div>

          {processingError && (
            <div className="rounded-xl border border-red-800/80 bg-red-950/80 p-4 sm:p-5 text-xs text-red-200 font-medium leading-relaxed space-y-3.5 shadow-xl animate-in fade-in">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-red-900/60 border border-red-700/60 rounded-xl shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                </div>
                <div className="space-y-1.5 flex-1">
                  <h4 className="font-bold text-red-100 text-sm">
                    এআই প্রসেসিং সাময়িক বিঘ্নিত হয়েছে
                  </h4>
                  <p className="text-red-300 text-xs leading-relaxed">
                    {processingError}
                  </p>
                  <div className="bg-red-900/30 border border-red-800/50 rounded-lg p-2.5 text-[11px] text-red-200 space-y-1 mt-2">
                    <p className="font-semibold text-amber-300">💡 এটি কেন হয়েছে এবং স্থায়ী সমাধান:</p>
                    <p>• <strong>ফ্রি সার্ভার রেট লিমিট:</strong> শেয়ার্ড সার্ভারে অতিরিক্ত ট্রাফিকের কারণে Google Gemini সাময়িক কোটা বা হাই-ডিমান্ড (503/429) দেখায়।</p>
                    <p>• <strong>১০০% স্থায়ী সমাধান:</strong> Google AI Studio থেকে আপনার নিজস্ব ফ্রি API Key যুক্ত করলে কোনো সীমাবদ্ধতা ছাড়াই আনলিমিটেড কাজ করবে।</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-red-900/60">
                <button
                  onClick={() => runPipeline(activeAction || 'srt')}
                  className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer text-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>🔄 পুনরায় চেষ্টা করুন</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowApiKeyModal(true)}
                  className="px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 font-bold flex items-center gap-1.5 transition-all cursor-pointer text-xs shadow-md"
                >
                  <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                  <span>Gemini API Settings</span>
                </button>

                <button
                  onClick={handleLoadDemo}
                  className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 flex items-center gap-1.5 transition-all cursor-pointer text-xs"
                >
                  <PlayCircle className="w-3.5 h-3.5 text-teal-400" />
                  <span>🎬 ডেমো অডিও টেস্ট</span>
                </button>
              </div>
            </div>
          )}

          {isProcessing && (
            <div className="space-y-2 pt-2">
              <div className="flex justify-between text-xs text-slate-400 font-mono">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full animate-ping bg-emerald-400"></span>
                  {progressStage}
                </span>
                <span className="font-bold text-emerald-400">{progressPercent}%</span>
              </div>
              <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden border border-slate-800">
                <div
                  className="h-full transition-all duration-500 ease-out bg-gradient-to-r from-emerald-500 to-teal-400"
                  style={{ width: `${progressPercent}%` }}
                ></div>
              </div>
            </div>
          )}

          {detectedLanguage && (
            <div className="text-xs text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 p-2.5 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>শনাক্তকৃত প্রধান ভাষা: <strong>{detectedLanguage}</strong></span>
              </div>
              {detectedCharacters.length > 0 && (
                <span className="text-[11px] text-slate-300 font-mono bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                  {detectedCharacters.length}টি ক্যারেক্টার চিহ্নিত
                </span>
              )}
            </div>
          )}
        </div>

      </div>

      {/* Gemini API Settings Modal */}
      <GeminiApiSettingsModal
        isOpen={showApiKeyModal}
        onClose={() => setShowApiKeyModal(false)}
      />
    </div>
  );
};
