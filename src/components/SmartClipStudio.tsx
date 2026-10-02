import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  Scissors,
  Download,
  Play,
  Pause,
  Clock,
  CheckCircle2,
  AlertCircle,
  Film,
  Music,
  FileText,
  Sliders,
  ChevronDown,
  ChevronUp,
  Volume2,
  FolderArchive,
  RefreshCw,
  ExternalLink,
  Flame,
  HelpCircle,
  Layers,
  RotateCcw,
  Check,
  VolumeX,
  Languages,
} from 'lucide-react';
import JSZip from 'jszip';
import { SmartClip, ClipCategory, ClipAnalysisConfig, SubtitleSegment } from '../types';
import { safeFetchJson, getStoredApiKey } from '../utils/apiHelper';
import { GeminiApiSettingsModal } from './GeminiApiSettingsModal';

interface SmartClipStudioProps {
  file: File | null;
  setFile: (file: File | null) => void;
  mediaUrl: string | null;
  setMediaUrl: (url: string | null) => void;
  duration: number;
  setDuration: (d: number) => void;
  onSwitchToFullEditor?: (subtitles: SubtitleSegment[]) => void;
}

export const SmartClipStudio: React.FC<SmartClipStudioProps> = ({
  file,
  setFile,
  mediaUrl,
  setMediaUrl,
  duration,
  setDuration,
  onSwitchToFullEditor,
}) => {
  // Configuration State
  const [focusArea, setFocusArea] = useState<ClipCategory>('mixed');
  const [targetDurationSec, setTargetDurationSec] = useState<number>(300); // Default 5 mins
  const [customDurationInput, setCustomDurationInput] = useState<string>('300');
  const [isCustomDuration, setIsCustomDuration] = useState<boolean>(false);
  const [clipCount, setClipCount] = useState<number>(5);
  const [sourceLang, setSourceLang] = useState<string>('auto');
  const [targetLang, setTargetLang] = useState<string>('bn');
  const [completionFlexibility, setCompletionFlexibility] = useState<'smart' | 'strict' | 'generous'>('smart');

  // Processing & Job State
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [stage, setStage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [demoNotice, setDemoNotice] = useState<string | null>(null);
  const hasAttemptedAutoTranslateRef = useRef<boolean>(false);

  // Clips Output State
  const [clips, setClips] = useState<SmartClip[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [relativeTimecode, setRelativeTimecode] = useState<boolean>(true); // true = 00:00:00 start, false = master timeline
  const [isZipping, setIsZipping] = useState<boolean>(false);
  const [zipProgress, setZipProgress] = useState<string>('');

  // Audio Playback State per Clip
  const [activePlayingClipId, setActivePlayingClipId] = useState<string | null>(null);
  const [audioCurrentTimes, setAudioCurrentTimes] = useState<Record<string, number>>({});
  const [audioDurations, setAudioDurations] = useState<Record<string, number>>({});
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});

  // Recut Drawer State
  const [recutClipId, setRecutClipId] = useState<string | null>(null);
  const [recutStart, setRecutStart] = useState<number>(0);
  const [recutEnd, setRecutEnd] = useState<number>(0);
  const [isRecutting, setIsRecutting] = useState<boolean>(false);

  // Download state per clip
  const [downloadingClipId, setDownloadingClipId] = useState<string | null>(null);

  // Expanded subtitles drawer per clip
  const [expandedSubtitlesClipId, setExpandedSubtitlesClipId] = useState<string | null>(null);

  // Bengali translation state for metadata
  const [isTranslatingClips, setIsTranslatingClips] = useState<boolean>(false);
  const [showApiModal, setShowApiModal] = useState<boolean>(false);

  // Clean Bengali category label helper
  const getCleanBengaliCategoryLabel = (category: string, rawLabel?: string) => {
    if (rawLabel && !/[\u0600-\u06FF\u0750-\u077F\u0900-\u097F]/.test(rawLabel)) {
      return rawLabel;
    }
    const map: Record<string, string> = {
      emotional: 'ইমোশনাল ও হৃদয়স্পর্শী',
      historical: 'ঐতিহাসিক ও তাৎপর্যপূর্ণ',
      informational: 'তথ্যবহুল ও শিক্ষণীয়',
      dramatic: 'রোমাঞ্চকর ও হাইলাইট',
      mixed: 'সেরা মুহূর্ত',
    };
    return map[category] || 'তথ্যবহুল ও শিক্ষণীয়';
  };

  // Explicitly translate clips metadata into fluent Bengali
  const handleTranslateClipsToBengali = async (currentClips: SmartClip[] = clips) => {
    if (!currentClips || currentClips.length === 0 || isTranslatingClips) return;
    setIsTranslatingClips(true);
    try {
      const data = await safeFetchJson<{ success: boolean; translations?: any[]; error?: string }>(
        '/api/clips/translate-bengali',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clips: currentClips }),
        },
        'ক্লিপ অনুবাদ করতে সমস্যা হয়েছে।'
      );
      if (data.success && Array.isArray(data.translations)) {
        const transMap = new Map(data.translations.map((t: any) => [t.id, t]));
        setClips((prev) =>
          prev.map((c) => {
            const t = transMap.get(c.id) as any;
            if (!t) {
              return {
                ...c,
                categoryLabel: getCleanBengaliCategoryLabel(c.category, c.categoryLabel),
              };
            }
            return {
              ...c,
              headline: t.headline || c.headline,
              summary: t.summary || c.summary,
              topicConclusion: t.topicConclusion || c.topicConclusion,
              categoryLabel: t.categoryLabel || getCleanBengaliCategoryLabel(c.category, c.categoryLabel),
            };
          })
        );
      } else if (!data.success && data.error) {
        setErrorMessage(data.error);
      }
    } catch (err: any) {
      console.error('Failed to translate clips to Bengali:', err);
      setErrorMessage(err.message || 'ক্লিপ অনুবাদ করতে সমস্যা হয়েছে।');
    } finally {
      setIsTranslatingClips(false);
    }
  };

  // Auto-detect foreign script (Urdu, Arabic, Hindi) in existing clips and trigger instant translation
  useEffect(() => {
    if (clips.length === 0 || isTranslatingClips || hasAttemptedAutoTranslateRef.current) return;
    const hasForeign = clips.some((c) =>
      /[\u0600-\u06FF\u0750-\u077F\u0900-\u097F]/.test(
        `${c.headline || ''} ${c.summary || ''} ${c.topicConclusion || ''} ${c.categoryLabel || ''}`
      )
    );
    if (hasForeign) {
      hasAttemptedAutoTranslateRef.current = true;
      handleTranslateClipsToBengali(clips);
    }
  }, [clips]);

  // Handle file selection from drag/drop or input
  const handleFileChange = (selectedFile: File) => {
    setFile(selectedFile);
    const url = URL.createObjectURL(selectedFile);
    setMediaUrl(url);

    // Read media duration
    const tempMedia = document.createElement(selectedFile.type.startsWith('video') ? 'video' : 'audio');
    tempMedia.preload = 'metadata';
    tempMedia.src = url;
    tempMedia.onloadedmetadata = () => {
      if (tempMedia.duration && !isNaN(tempMedia.duration)) {
        setDuration(tempMedia.duration);
      }
    };
  };

  // Poll background job
  useEffect(() => {
    if (!jobId || !isProcessing) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/clips/job-status/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.success) {
          setProgress(data.progress || 0);
          setStage(data.stage || '');

          if (data.status === 'completed') {
            setIsProcessing(false);
            setClips(data.clips || []);
            setSessionId(data.sessionId || null);
            if (data.isDemoData || data.demoNotice) {
              setDemoNotice(data.demoNotice || 'Gemini API-এর বর্তমান quota সীমা অতিক্রম করায় ডেমো ডেটা ও টাইমকোড চ্যাপ্টার প্রস্তুত করা হয়েছে।');
            } else {
              setDemoNotice(null);
            }
            clearInterval(interval);
          } else if (data.status === 'failed') {
            setIsProcessing(false);
            setErrorMessage(data.error || 'ক্লিপ প্রসেসিং সম্পন্ন করা যায়নি।');
            clearInterval(interval);
          }
        }
      } catch (err) {
        console.warn('Poll error:', err);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [jobId, isProcessing]);

  // Start Analysis and Audio Cutting
  const handleStartAnalysis = async () => {
    if (!getStoredApiKey()) {
      setErrorMessage('Gemini API key is required. Open Settings to add your key.');
      setShowApiModal(true);
      return;
    }

    if (!file) {
      setErrorMessage('অনুগ্রহ করে প্রথমে একটি অডিও বা ভিডিও ফাইল আপলোড করুন।');
      return;
    }

    setIsProcessing(true);
    setProgress(5);
    setStage('ফাইল আপলোড প্রক্রিয়া শুরু হচ্ছে...');
    setErrorMessage(null);
    setDemoNotice(null);
    hasAttemptedAutoTranslateRef.current = false;
    setClips([]);

    try {
      const CHUNK_SIZE = 3 * 1024 * 1024; // 3MB chunks
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      // Step 1: Init Upload
      const initData = await safeFetchJson<{ success: boolean; uploadId: string }>(
        '/api/upload/init',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || 'audio/mp3',
            totalChunks,
          }),
        },
        'আপলোড সেশন শুরু করা সম্ভব হয়নি।'
      );

      const uploadId = initData.uploadId;
      setSessionId(uploadId);

      // Step 2: Upload chunks
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(file.size, start + CHUNK_SIZE);
        const chunkBlob = file.slice(start, end);

        const chunkBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const res = reader.result as string;
            resolve(res.split(',')[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(chunkBlob);
        });

        await safeFetchJson(
          '/api/upload/chunk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              uploadId,
              chunkIndex: i,
              chunkBase64,
            }),
          },
          `খণ্ড #${i + 1} আপলোড করতে সমস্যা হয়েছে।`
        );

        const uploadPct = Math.round(((i + 1) / totalChunks) * 20);
        setProgress(uploadPct);
        setStage(`ফাইল আপলোড হচ্ছে (${i + 1}/${totalChunks})...`);
      }

      // Step 3: Trigger Clip Analysis & Audio Cutting
      const durationToUse = isCustomDuration ? parseInt(customDurationInput, 10) || 180 : targetDurationSec;

      const analyzeData = await safeFetchJson<{ success: boolean; jobId: string; sessionId: string }>(
        '/api/clips/analyze-and-cut',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uploadId,
            totalChunks,
            fileName: file.name,
            focusArea,
            targetDurationSec: durationToUse,
            clipCount,
            completionFlexibility,
            sourceLang,
            targetLang,
            customApiKey: getStoredApiKey(),
          }),
        },
        'ক্লিপ অ্যানালাইসিস শুরু করা সম্ভব হয়নি।'
      );

      setJobId(analyzeData.jobId);
    } catch (err: any) {
      console.error(err);
      setIsProcessing(false);
      setErrorMessage(err.message || 'একটি ত্রুটি ঘটেছে। পুনরায় চেষ্টা করুন।');
    }
  };

  // Audio Playback Controls
  const togglePlayAudio = (clipId: string) => {
    const audio = audioRefs.current[clipId];
    if (!audio) return;

    if (activePlayingClipId === clipId) {
      audio.pause();
      setActivePlayingClipId(null);
    } else {
      // Pause any other active audio
      if (activePlayingClipId && audioRefs.current[activePlayingClipId]) {
        audioRefs.current[activePlayingClipId]?.pause();
      }
      audio.play();
      setActivePlayingClipId(clipId);
    }
  };

  const handleAudioSeek = (clipId: string, timeSec: number) => {
    const audio = audioRefs.current[clipId];
    if (audio) {
      audio.currentTime = timeSec;
      setAudioCurrentTimes((prev) => ({ ...prev, [clipId]: timeSec }));
    }
  };

  // Download Individual Cut Audio MP3 (Direct binary blob with safe filenames for Windows & media players)
  const handleDownloadAudio = async (clip: SmartClip) => {
    try {
      setDownloadingClipId(clip.id);
      const res = await fetch(clip.audioUrl);
      if (!res.ok) throw new Error('অডিও ফাইল লোড করা সম্ভব হয়নি');
      const rawBlob = await res.blob();
      const mp3Blob = new Blob([rawBlob], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(mp3Blob);
      const a = document.createElement('a');
      a.href = url;
      // Sanitize illegal filesystem characters (< > : " / \ | ? *) to ensure 100% Windows and Mac support
      const safeName = (clip.audioFileName || `clip_${clip.clipIndex}.mp3`).replace(/[<>:"/\\|?*]/g, '_');
      a.download = safeName.endsWith('.mp3') ? safeName : `${safeName}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      console.warn('Blob audio download fallback:', err);
      window.location.href = clip.audioDownloadUrl;
    } finally {
      setDownloadingClipId(null);
    }
  };

  // Download Individual SRT
  const handleDownloadSrt = (clip: SmartClip) => {
    const content = relativeTimecode ? clip.srtRelative : clip.srtMaster;
    const hasBom = content.charCodeAt(0) === 0xFEFF;
    const finalContent = hasBom ? content : '\uFEFF' + content;
    const blob = new Blob([finalContent], { type: 'text/srt;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const baseName = (clip.audioFileName || `clip_${clip.clipIndex}`).replace(/\.mp3$/i, '').replace(/[<>:"/\\|?*]/g, '_');
    a.download = `${baseName}_${relativeTimecode ? 'relative' : 'master'}.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  // Download Individual Text Transcript
  const handleDownloadTxt = (clip: SmartClip) => {
    const hasBom = clip.txtTranscript.charCodeAt(0) === 0xFEFF;
    const finalContent = hasBom ? clip.txtTranscript : '\uFEFF' + clip.txtTranscript;
    const blob = new Blob([finalContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const baseName = (clip.audioFileName || `clip_${clip.clipIndex}`).replace(/\.mp3$/i, '').replace(/[<>:"/\\|?*]/g, '_');
    a.download = `${baseName}_transcript.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  // Batch Export: Download All Clips & SRTs in a clean ZIP Package
  const handleDownloadAllZip = async () => {
    if (clips.length === 0) return;
    setIsZipping(true);
    setZipProgress('প্যাকেজ প্রস্তুত করা হচ্ছে...');

    try {
      const zip = new JSZip();
      const baseFolderName = file?.name ? file.name.replace(/\.[^/.]+$/, '').replace(/[<>:"/\\|?*]/g, '_') : 'Smart_Repurposed_Clips';
      const rootFolder = zip.folder(baseFolderName) || zip;

      // Create folders
      const audioFolder = rootFolder.folder('01_Cut_Audio_MP3');
      const srtRelativeFolder = rootFolder.folder('02_SRT_Subtitles_Zero_Start');
      const srtMasterFolder = rootFolder.folder('03_SRT_Subtitles_Master_Timeline');
      const txtFolder = rootFolder.folder('04_Text_Transcripts');

      // Add README guide for Premiere Pro, DaVinci, and CapCut
      const readmeContent = `=====================================================
SubSync AI Studio - Smart Repurposed Video & Audio Package
=====================================================
মূল ফাইল: ${file?.name || 'media_file'}
মোট এক্সট্রাক্টকৃত ক্লিপ সংখ্যা: ${clips.length}
প্রসঙ্গ সমাপ্তির নিশ্চয়তা: কথার মাঝখানে কোনো কাটা ছাড়াই অর্থবহ বিষয় সমাপ্তি (Zero Mid-Cutoff).

ফোল্ডার পরিচিতি:
- 01_Cut_Audio_MP3: প্রতিটি প্রসঙ্গের নিখুঁত কাট অডিও (Pristine 192kbps MP3)।
- 02_SRT_Subtitles_Zero_Start: প্রতিটি অডিও ক্লিপের জন্য 00:00:00 থেকে শুরু হওয়া সাবটাইটেল (ভিডিও এডিটরে ড্র্যাগ অ্যান্ড ড্রপের জন্য আদর্শ)।
- 03_SRT_Subtitles_Master_Timeline: ফুল ভিডিওর মূল টাইমলাইনের সাথে সিঙ্কড SRT।
- 04_Text_Transcripts: প্রতিটি ক্লিপের সম্পূর্ণ বাংলা টেক্সট ট্রান্সক্রিপ্ট।

ভিডিও এডিটিং সফটওয়্যারে কাজ করার সহজ নিয়ম:
1. Adobe Premiere Pro / DaVinci Resolve / CapCut ওপেন করুন।
2. আপনার মূল ভিডিও ট্র্যাক টাইমলাইনে রাখুন।
3. '01_Cut_Audio_MP3' থেকে ক্লিপটির অডিও এবং '02_SRT_Subtitles_Zero_Start' থেকে SRT ফাইলটি টাইমলাইনে যুক্ত করুন।
4. কাট অডিওর দৈর্ঘ্য অনুযায়ী ভিডিও আগে-পিছে ট্রিম করে নিন।
5. মোশন গ্রাফিক্স বা টেক্সট স্টাইল সিলেক্ট করে রেন্ডার করুন!
=====================================================`;

      rootFolder.file('README_Video_Editor_Import_Guide.txt', readmeContent);

      // Download each audio file and insert into ZIP
      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        setZipProgress(`অডিও ক্লিপ সংগ্রহ করা হচ্ছে (${i + 1}/${clips.length})...`);

        const safeBaseName = (clip.audioFileName || `clip_${clip.clipIndex}.mp3`).replace(/\.mp3$/i, '').replace(/[<>:"/\\|?*]/g, '_');
        const safeAudioName = `${safeBaseName}.mp3`;

        try {
          const audioRes = await fetch(clip.audioUrl);
          if (audioRes.ok) {
            const rawBlob = await audioRes.blob();
            const audioBlob = new Blob([rawBlob], { type: 'audio/mpeg' });
            audioFolder?.file(safeAudioName, audioBlob);
          }
        } catch (fetchErr) {
          console.warn(`Failed to fetch audio for clip ${clip.clipIndex}:`, fetchErr);
        }

        // Add SRTs with UTF-8 BOM for perfect rendering in video editing suites
        const srtRelativeName = `${safeBaseName}_relative_00s.srt`;
        const srtMasterName = `${safeBaseName}_master_time.srt`;
        const txtName = `${safeBaseName}_transcript.txt`;

        const relWithBom = clip.srtRelative.charCodeAt(0) === 0xFEFF ? clip.srtRelative : '\uFEFF' + clip.srtRelative;
        const masterWithBom = clip.srtMaster.charCodeAt(0) === 0xFEFF ? clip.srtMaster : '\uFEFF' + clip.srtMaster;
        const txtWithBom = clip.txtTranscript.charCodeAt(0) === 0xFEFF ? clip.txtTranscript : '\uFEFF' + clip.txtTranscript;

        srtRelativeFolder?.file(srtRelativeName, relWithBom);
        srtMasterFolder?.file(srtMasterName, masterWithBom);
        txtFolder?.file(txtName, txtWithBom);
      }

      setZipProgress('ZIP ফাইল কম্প্রেস করা হচ্ছে...');
      const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        setZipProgress(`কম্প্রেস হচ্ছে: ${Math.round(metadata.percent)}%`);
      });

      const zipUrl = URL.createObjectURL(zipBlob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.href = zipUrl;
      downloadAnchor.download = `${baseFolderName}_Clips_and_SRT_Bundle.zip`;
      downloadAnchor.click();
      URL.revokeObjectURL(zipUrl);
    } catch (zipErr: any) {
      console.error('ZIP generation error:', zipErr);
      alert('ZIP ফাইল তৈরিতে সমস্যা হয়েছে: ' + (zipErr.message || 'Error'));
    } finally {
      setIsZipping(false);
      setZipProgress('');
    }
  };

  // Re-cut fine-tuning handler
  const handleRecutSubmit = async (clip: SmartClip) => {
    if (!sessionId) return;
    setIsRecutting(true);

    try {
      const data = await safeFetchJson<{
        success: boolean;
        clipId: string;
        newStart: number;
        newEnd: number;
        duration: number;
        audioUrl: string;
      }>(
        '/api/clips/recut',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            clipId: clip.id,
            newStart: recutStart,
            newEnd: recutEnd,
            fileName: clip.audioFileName,
          }),
        },
        'অডিও রিকাট করা সম্ভব হয়নি।'
      );

      // Update clip in local state
      setClips((prev) =>
        prev.map((c) => {
          if (c.id === clip.id) {
            return {
              ...c,
              start: data.newStart,
              end: data.newEnd,
              duration: data.duration,
              audioUrl: data.audioUrl,
            };
          }
          return c;
        })
      );

      setRecutClipId(null);
    } catch (err: any) {
      alert(err.message || 'রিকাট ব্যর্থ হয়েছে');
    } finally {
      setIsRecutting(false);
    }
  };

  const formatSeconds = (sec: number) => {
    const s = Math.max(0, Math.floor(sec));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Filter clips
  const filteredClips = clips.filter((c) => {
    if (selectedFilter === 'all') return true;
    return c.category === selectedFilter;
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* Top Banner Ribbon */}
      <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 p-0.5 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Scissors className="w-5 h-5 text-emerald-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                স্মার্ট কন্টেন্ট রিপারপাসিং ও প্রিসিশন অডিও কাটার স্টুডিও
              </h2>
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-2.5 py-0.5 rounded-full font-medium">
                <CheckCircle2 className="w-3 h-3" /> কথার পূর্ণাঙ্গ সমাপ্তি নিশ্চিত (Zero Mid-Cutoff)
              </span>
            </div>
            <p className="text-xs text-slate-400">
              ভিডিও ও অডিও থেকে বিষয়ভিত্তিক স্বয়ংসম্পূর্ণ ক্লিপ ডিটেকশন, নিখুঁত অডিও কাটিং এবং সিঙ্কড SRT জেনারেশন।
            </p>
          </div>
        </div>

        {/* Global Action: ZIP Export */}
        {clips.length > 0 && (
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleDownloadAllZip}
              disabled={isZipping}
              className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-lg shadow-emerald-900/40 flex items-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              <FolderArchive className="w-4 h-4" />
              <span>{isZipping ? zipProgress || 'জিপ তৈরি হচ্ছে...' : 'সব ক্লিপ ও SRT একসাথে ডাউনলোড (ZIP)'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Workspace Layout */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Side: Setup & Configuration Panel */}
        <div className="w-full lg:w-96 xl:w-[420px] border-r border-slate-800/80 bg-slate-900/40 flex flex-col shrink-0 overflow-y-auto p-4 sm:p-5 space-y-5">
          
          {/* Section 1: Media Input */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <Film className="w-4 h-4 text-emerald-400" />
                <span>মিডিয়া ফাইল (অডিও / ভিডিও)</span>
              </label>
              {file && (
                <span className="text-[11px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md font-mono">
                  {(file.size / (1024 * 1024)).toFixed(1)} MB
                </span>
              )}
            </div>

            {file ? (
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                    <Music className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-200 truncate">{file.name}</p>
                    <p className="text-[10px] text-slate-400">
                      দৈর্ঘ্য: {duration > 0 ? `${formatSeconds(duration)} মিনিট` : 'যাচাই করা হচ্ছে...'}
                    </p>
                  </div>
                </div>

                <label className="text-[11px] text-emerald-400 hover:text-emerald-300 font-medium cursor-pointer shrink-0 hover:underline">
                  পরিবর্তন
                  <input
                    type="file"
                    accept="audio/*,video/*"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
                  />
                </label>
              </div>
            ) : (
              <label className="border-2 border-dashed border-slate-700 hover:border-emerald-500/60 rounded-xl p-5 flex flex-col items-center justify-center cursor-pointer transition-colors bg-slate-950/30 text-center group">
                <div className="w-10 h-10 rounded-full bg-slate-800 group-hover:bg-emerald-500/20 text-slate-400 group-hover:text-emerald-400 flex items-center justify-center transition-colors mb-2">
                  <Scissors className="w-5 h-5" />
                </div>
                <p className="text-xs font-semibold text-slate-200">এখানে ভিডিও বা অডিও ফাইল ড্রপ করুন</p>
                <p className="text-[11px] text-slate-400 mt-1">MP4, MKV, MOV, MP3, WAV, M4A ইত্যাদি যে কোনো ফরম্যাট</p>
                <span className="mt-3 px-3 py-1 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-medium">
                  ফাইল নির্বাচন করুন
                </span>
                <input
                  type="file"
                  accept="audio/*,video/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
                />
              </label>
            )}
          </div>

          {/* Section 2: AI Focus & Tone */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span>এআই ফোকাস ও ক্যাটাগরি</span>
              </label>
              <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                স্মার্ট ডিটেকশন
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {[
                {
                  id: 'mixed',
                  title: 'স্মার্ট মিশ্রণ (Balanced Mix)',
                  desc: 'ইমোশনাল, ঐতিহাসিক ও তথ্যবহুল সব বিষয়ের বৈচিত্র্যময় ক্লিপ',
                  color: 'hover:border-purple-500/50',
                  activeColor: 'border-purple-500 bg-purple-500/10 text-purple-200',
                  icon: Layers,
                },
                {
                  id: 'emotional',
                  title: 'ইমোশনাল ও হৃদয়স্পর্শী (Emotional)',
                  desc: 'মন ছুঁয়ে যাওয়া গল্প, জীবনের লড়াই ও আবেগঘন টার্নিং পয়েন্ট',
                  color: 'hover:border-pink-500/50',
                  activeColor: 'border-pink-500 bg-pink-500/10 text-pink-200',
                  icon: Sparkles,
                },
                {
                  id: 'historical',
                  title: 'ঐতিহাসিক ও টার্নিং পয়েন্ট (Historical)',
                  desc: 'পটভূমি, ইতিহাসের মোড় ঘোরানো মুহূর্ত ও গুরুত্বপূর্ণ প্রেক্ষাপট',
                  color: 'hover:border-amber-500/50',
                  activeColor: 'border-amber-500 bg-amber-500/10 text-amber-200',
                  icon: Clock,
                },
                {
                  id: 'informational',
                  title: 'তথ্যবহুল ও মূল বক্তব্য (Informational)',
                  desc: 'আলোচনার প্রধান যুক্তি, মূল শিক্ষা ও তথ্যবহুল বিবরণ',
                  color: 'hover:border-emerald-500/50',
                  activeColor: 'border-emerald-500 bg-emerald-500/10 text-emerald-200',
                  icon: FileText,
                },
                {
                  id: 'dramatic',
                  title: 'নাটকীয় ক্লাইম্যাক্স ও ভাইরাল হুক (Dramatic)',
                  desc: 'তীব্র উত্তেজনাপূর্ণ মুহূর্ত, বিতর্ক ও আকর্ষণীয় শীর্ষ কথা',
                  color: 'hover:border-rose-500/50',
                  activeColor: 'border-rose-500 bg-rose-500/10 text-rose-200',
                  icon: Flame,
                },
              ].map((item) => {
                const Icon = item.icon;
                const isSelected = focusArea === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFocusArea(item.id as ClipCategory)}
                    className={`text-left p-2.5 rounded-xl border transition-all flex items-start gap-2.5 ${
                      isSelected
                        ? item.activeColor
                        : 'border-slate-800 bg-slate-950/40 text-slate-300 hover:bg-slate-900'
                    }`}
                  >
                    <Icon className="w-4 h-4 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">{item.title}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{item.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 3: Target Duration & Number of Clips */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-sm space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-emerald-400" />
                  <span>টার্গেট ক্লিপের সময়কাল</span>
                </label>
                <span className="text-[11px] font-mono text-emerald-400 font-bold bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  {isCustomDuration
                    ? `${customDurationInput} সেকেন্ড`
                    : `${targetDurationSec / 60} মিনিট (${targetDurationSec}s)`}
                </span>
              </div>

              {/* Preset Buttons */}
              <div className="grid grid-cols-5 gap-1.5">
                {[
                  { label: '২ মি (120s)', sec: 120 },
                  { label: '৩ মি (180s)', sec: 180 },
                  { label: '৪ মি (240s)', sec: 240 },
                  { label: '৫ মি (300s)', sec: 300 },
                  { label: '৭ মি (420s)', sec: 420 },
                ].map((preset) => (
                  <button
                    key={preset.sec}
                    type="button"
                    onClick={() => {
                      setIsCustomDuration(false);
                      setTargetDurationSec(preset.sec);
                    }}
                    className={`py-1.5 px-1 rounded-lg text-[11px] font-medium border transition-all text-center ${
                      !isCustomDuration && targetDurationSec === preset.sec
                        ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300 font-bold'
                        : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Custom Duration Input Option */}
              <div className="mt-2.5 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="custom-dur-checkbox"
                  checked={isCustomDuration}
                  onChange={(e) => setIsCustomDuration(e.target.checked)}
                  className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500 bg-slate-950"
                />
                <label htmlFor="custom-dur-checkbox" className="text-xs text-slate-300 cursor-pointer">
                  কাস্টম সেকেন্ড দিন:
                </label>
                {isCustomDuration && (
                  <input
                    type="number"
                    min="30"
                    max="1800"
                    step="10"
                    value={customDurationInput}
                    onChange={(e) => setCustomDurationInput(e.target.value)}
                    className="w-24 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-xs text-emerald-400 font-mono text-center focus:border-emerald-500 outline-none"
                    placeholder="300"
                  />
                )}
              </div>
            </div>

            {/* Extended Duration & Full Thought Completion Guarantee */}
            <div className="bg-emerald-950/30 border border-emerald-800/50 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>পর্যাপ্ত দৈর্ঘ্য ও পূর্ণাঙ্গ বাক্য সমাপ্তির নিশ্চয়তা</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                ৫ মিনিটের সেটিংসে প্রতিটি ক্লিপ ৩ থেকে ৫ মিনিট পর্যন্ত গভীর ও সম্পূর্ণ আলোচনা কভার করবে। কোনো ১০-১৮ সেকেন্ডের অসম্পূর্ণ বা বিচ্ছিন্ন টুকরো তৈরি হবে না।
              </p>
            </div>

            {/* Universal Audio to Bengali Subtitle Translation Guarantee */}
            <div className="bg-blue-950/30 border border-blue-800/40 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold text-blue-300">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  <span>ভাষান্তর ও সাবটাইটেল ইঞ্জিন</span>
                </span>
                <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full border border-blue-500/30">
                  বাংলা আউটপুট
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                আপনার ভিডিও যেকোনো ভাষায় হতে পারে (উর্দু, হিন্দি, আরবি, ইংরেজি ইত্যাদি)। বক্তব্যের কথা হুবহু সময়ে টাইমিং বজায় রেখে <strong className="text-white">বাংলা ভাষায় রূপান্তর</strong> করে SRT ও স্ক্রিন সাবটাইটেল দেওয়া হবে।
              </p>
            </div>

            {/* Number of Clips Slider */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Scissors className="w-4 h-4 text-emerald-400" />
                  <span>ক্লিপ সংখ্যা</span>
                </label>
                <span className="text-xs font-bold text-emerald-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  {clipCount} টি ক্লিপ
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="12"
                value={clipCount}
                onChange={(e) => setClipCount(parseInt(e.target.value, 10))}
                className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                <span>১টি</span>
                <span>৩টি</span>
                <span>৫টি (স্ট্যান্ডার্ড)</span>
                <span>৮টি</span>
                <span>১২টি</span>
              </div>
            </div>
          </div>

          {/* Section 4: Trigger Button */}
          <div className="space-y-2">
            <button
              onClick={handleStartAnalysis}
              disabled={isProcessing || !file}
              className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-sm font-bold shadow-xl shadow-emerald-950/60 flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-white" />
                  <span>প্রসেসিং ও কাটিং চলছে... ({progress}%)</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-emerald-200" />
                  <span>এআই ক্লিপ ডিটেকশন ও অডিও কাটিং শুরু করুন</span>
                </>
              )}
            </button>

            {errorMessage && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-xs text-red-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>

          {/* Processing Progress Bar */}
          {isProcessing && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2.5 animate-pulse">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Scissors className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{stage || 'বিশ্লেষণ চলছে...'}</span>
                </span>
                <span className="text-emerald-400 font-mono">{progress}%</span>
              </div>
              <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                <div
                  className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-400 italic">
                কথার বিষয়বস্তু বিশ্লেষণ করা হচ্ছে এবং FFmpeg দিয়ে নিখুঁত অডিও কাটা হচ্ছে...
              </p>
            </div>
          )}
        </div>

        {/* Right Side: Generated Clips Dashboard */}
        <div className="flex-1 flex flex-col overflow-y-auto bg-slate-950 p-4 sm:p-6 space-y-5">
          {/* Quick Video Editor Sync Banner */}
          <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-900/60 border border-slate-800/80 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded text-[11px] font-bold">
                  ভিডিও এডিটর ড্র্যাগ অ্যান্ড ড্রপ গাইড
                </span>
                <span className="text-xs text-slate-400 hidden sm:inline">Premiere Pro • DaVinci • CapCut</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed max-w-2xl">
                প্রতিটি ক্লিপের জন্য আলাদা কাট অডিও (.mp3) এবং শূন্য সেকেন্ড থেকে শুরু হওয়া সিঙ্কড সাবটাইটেল (.srt) তৈরি হয়েছে।
                এডিটিং সফটওয়্যারে কেবল অডিও ও SRT ড্র্যাগ করলেই ভিডিও তৈরির কাজ ৮০% কমে যাবে!
              </p>
            </div>

            {/* Timecode format switch */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-1 flex items-center gap-1 shrink-0 text-xs">
              <button
                type="button"
                onClick={() => setRelativeTimecode(true)}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                  relativeTimecode
                    ? 'bg-emerald-600 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                00:00:00 আপেক্ষিক SRT
              </button>
              <button
                type="button"
                onClick={() => setRelativeTimecode(false)}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                  !relativeTimecode
                    ? 'bg-emerald-600 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                মূল টাইমলাইন SRT
              </button>
            </div>
          </div>

          {/* Demo Notice Banner if Quota Fallback Active */}
          {demoNotice && clips.length > 0 && (
            <div className="bg-amber-950/40 border border-amber-500/40 rounded-xl p-3.5 text-xs text-amber-200 flex items-start gap-2.5 shadow-sm">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-bold text-amber-300">ডেমো মোড সক্রিয় (Demo Fallback Mode)</div>
                <p className="text-amber-200/90 leading-relaxed">{demoNotice}</p>
              </div>
            </div>
          )}

          {/* Results Summary Bar */}
          {clips.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">মোট {clips.length}টি প্রস্তুতকৃত ক্লিপ</span>
                <span className="text-xs text-slate-400">
                  (মোট দৈর্ঘ্য:{' '}
                  {formatSeconds(clips.reduce((acc, c) => acc + c.duration, 0))} মিনিট)
                </span>
              </div>

              {/* Category Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
                {[
                  { id: 'all', label: 'সবগুলো' },
                  { id: 'emotional', label: 'ইমোশনাল' },
                  { id: 'historical', label: 'ঐতিহাসিক' },
                  { id: 'informational', label: 'তথ্যবহুল' },
                  { id: 'dramatic', label: 'নাটকীয়' },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSelectedFilter(f.id)}
                    className={`px-3 py-1 rounded-lg border transition-all ${
                      selectedFilter === f.id
                        ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300 font-semibold'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Bengali Language Status & Instant Translation Banner */}
          {clips.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2.5 bg-slate-900/80 border border-slate-800/80 rounded-xl px-4 py-2.5 shadow-sm">
              <div className="flex items-center gap-2">
                <Languages className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-xs text-slate-300">
                  ভাষার নিশ্চয়তা: <strong className="text-emerald-300">১০০% বাংলা</strong> (উর্দু/আরবি/অন্যান্য ভাষা থেকে অনুবাদকৃত শিরোনাম ও বিবরণ)
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleTranslateClipsToBengali(clips)}
                disabled={isTranslatingClips}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-50"
                title="কোনো শিরোনাম বা বিবরণে বিদেশি লেখা থাকলে তাৎক্ষণিক বাংলায় রূপান্তর করুন"
              >
                <Languages className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isTranslatingClips ? 'বাংলা অনুবাদ হচ্ছে...' : 'বাংলায় রূপান্তর নিশ্চিত করুন'}</span>
              </button>
            </div>
          )}

          {/* Empty State / Standby */}
          {clips.length === 0 && !isProcessing && (
            <div className="border border-dashed border-slate-800 rounded-2xl p-12 text-center flex flex-col items-center justify-center my-auto space-y-4 max-w-lg mx-auto">
              <div className="w-16 h-16 rounded-2xl bg-slate-900 flex items-center justify-center text-emerald-400 border border-slate-800">
                <Scissors className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-200">ক্লিপ কাটিং অপেক্ষা করছে</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  বামের প্যানেল থেকে যেকোনো ভিডিও বা অডিও ফাইল সিলেক্ট করুন, ক্যাটাগরি এবং কাঙ্ক্ষিত সময় নির্ধারণ করে
                  'এআই ক্লিপ ডিটেকশন ও অডিও কাটিং শুরু করুন' বাটনে ক্লিক করুন।
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-left text-xs text-slate-400 pt-2 w-full">
                <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/80">
                  <p className="font-semibold text-slate-200">✓ কোনো মধ্যবর্তী কাটা নয়</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">বক্তার বক্তব্য শেষ হওয়া নিশ্চিত করা হয়</p>
                </div>
                <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/80">
                  <p className="font-semibold text-slate-200">✓ রেডিমেড অডিও ও SRT</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">কাট MP3 এবং সাথে সিঙ্কড সাবটাইটেল</p>
                </div>
              </div>
            </div>
          )}

          {/* Clips List */}
          <div className="space-y-4">
            {filteredClips.map((clip) => {
              const isPlayingThis = activePlayingClipId === clip.id;
              const currentTime = audioCurrentTimes[clip.id] || 0;
              const duration = audioDurations[clip.id] || clip.duration;
              const isRecutOpen = recutClipId === clip.id;
              const isSubsOpen = expandedSubtitlesClipId === clip.id;

              // Find active subtitle in this clip with smooth continuous display
              const activeClipSub =
                clip.subtitles.find((s) => currentTime >= s.start && currentTime <= s.end) ||
                (currentTime > 0 ? clip.subtitles.filter((s) => s.start <= currentTime).slice(-1)[0] : clip.subtitles[0]);

              return (
                <div
                  key={clip.id}
                  id={`clip-card-${clip.id}`}
                  className="bg-slate-900/90 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-4 sm:p-5 transition-all shadow-md space-y-4"
                >
                  {/* Card Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800/60 pb-3">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="w-6 h-6 rounded-lg bg-slate-800 text-white font-bold text-xs flex items-center justify-center">
                        #{clip.clipIndex}
                      </span>
                      <span
                        className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold ${clip.categoryBadgeColor}`}
                      >
                        {getCleanBengaliCategoryLabel(clip.category, clip.categoryLabel)}
                      </span>
                      <div className="flex items-center gap-1.5 text-xs font-mono text-slate-300 bg-slate-950 px-2.5 py-0.5 rounded-lg border border-slate-800">
                        <Clock className="w-3.5 h-3.5 text-emerald-400" />
                        <span>
                          {formatSeconds(clip.start)} ➔ {formatSeconds(clip.end)}
                        </span>
                        <span className="text-slate-500">|</span>
                        <span className="text-emerald-400 font-bold">{Math.round(clip.duration)} সেকেন্ড</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> কথার পূর্ণ সমাপ্তি নিশ্চিত
                      </span>
                    </div>
                  </div>

                  {/* Headline & Description */}
                  <div className="space-y-1.5">
                    <h3 className="text-sm sm:text-base font-bold text-white hover:text-emerald-300 transition-colors">
                      {clip.headline}
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed">{clip.summary}</p>
                    
                    {/* Topic Conclusion Rationale */}
                    <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 text-xs text-slate-400 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-slate-300">কেন এই বাউন্ডারি: </span>
                        <span>{clip.topicConclusion}</span>
                      </div>
                    </div>
                  </div>

                  {/* Embedded Custom Audio Player */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 sm:p-4 space-y-2.5">
                    {/* Hidden Native Audio Element */}
                    <audio
                      ref={(el) => (audioRefs.current[clip.id] = el)}
                      src={clip.audioUrl}
                      preload="metadata"
                      onTimeUpdate={(e) => {
                        const t = e.currentTarget.currentTime;
                        setAudioCurrentTimes((prev) => ({ ...prev, [clip.id]: t }));
                      }}
                      onLoadedMetadata={(e) => {
                        const d = e.currentTarget.duration;
                        if (d && !isNaN(d)) {
                          setAudioDurations((prev) => ({ ...prev, [clip.id]: d }));
                        }
                      }}
                      onEnded={() => setActivePlayingClipId(null)}
                    />

                    {/* Controls Row */}
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => togglePlayAudio(clip.id)}
                        className={`w-10 h-10 rounded-xl flex items-center justify-center text-white transition-all shadow-md shrink-0 ${
                          isPlayingThis
                            ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/40'
                        }`}
                      >
                        {isPlayingThis ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 ml-0.5 fill-current" />}
                      </button>

                      {/* Scrubber & Timers */}
                      <div className="flex-1 space-y-1 min-w-0">
                        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                          <span className="text-emerald-400 font-bold">{formatSeconds(currentTime)}</span>
                          <span>{formatSeconds(duration)}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max={duration || 100}
                          step="0.1"
                          value={currentTime}
                          onChange={(e) => handleAudioSeek(clip.id, parseFloat(e.target.value))}
                          className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded cursor-pointer"
                        />
                      </div>

                      {/* Speed & Volume */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            const speeds = [1, 1.25, 1.5, 1.75];
                            const nextIdx = (speeds.indexOf(playbackRate) + 1) % speeds.length;
                            const nextSpeed = speeds[nextIdx];
                            setPlaybackRate(nextSpeed);
                            if (audioRefs.current[clip.id]) {
                              audioRefs.current[clip.id]!.playbackRate = nextSpeed;
                            }
                          }}
                          className="px-2 py-1 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg text-[10px] font-mono font-bold text-slate-300"
                        >
                          {playbackRate}x
                        </button>
                      </div>
                    </div>

                    {/* Synchronized Real-time Subtitle Banner during Playback */}
                    <div className="min-h-[44px] bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 flex items-center justify-center text-center">
                      {activeClipSub ? (
                        <div className="flex items-center gap-2 max-w-full overflow-hidden">
                          <span className="text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/30 shrink-0">
                            {formatSeconds(activeClipSub.start)}
                          </span>
                          <p className="text-xs sm:text-sm font-semibold text-emerald-300 transition-all truncate sm:whitespace-normal animate-fade-in">
                            "{activeClipSub.text}"
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 italic">
                          (অডিও প্লে করলে সংশ্লিষ্ট বাংলা সাবটাইটেল কথা অনুযায়ী এখানে ফুটে উঠবে)
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Actions & Export Buttons */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* 1. Download Cut Audio MP3 */}
                      <button
                        type="button"
                        onClick={() => handleDownloadAudio(clip)}
                        disabled={downloadingClipId === clip.id}
                        className="px-3.5 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 hover:text-emerald-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-50"
                        title="কম্পিউটারে প্লেযোগ্য স্ট্যান্ডার্ড MP3 অডিও ডাউনলোড করুন"
                      >
                        {downloadingClipId === clip.id ? (
                          <RefreshCw className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
                        ) : (
                          <Music className="w-3.5 h-3.5 text-emerald-400" />
                        )}
                        <span>ডাউনলোড কাট অডিও (.mp3)</span>
                      </button>

                      {/* 2. Download SRT Subtitles */}
                      <button
                        type="button"
                        onClick={() => handleDownloadSrt(clip)}
                        className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
                        title="টাইমকোডেড বাংলা সাবটাইটেল ফাইল ডাউনলোড করুন"
                      >
                        <FileText className="w-3.5 h-3.5 text-teal-400" />
                        <span>ডাউনলোড বাংলা SRT</span>
                      </button>

                      {/* 3. Download TXT Transcript */}
                      <button
                        type="button"
                        onClick={() => handleDownloadTxt(clip)}
                        className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-slate-100 rounded-xl text-xs font-medium flex items-center gap-1 transition-all"
                        title="সম্পূর্ণ বাংলা স্ক্রিপ্ট টেক্সট ফাইল ডাউনলোড করুন"
                      >
                        <FileText className="w-3.5 h-3.5 text-blue-400" />
                        <span>বাংলা .txt</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Toggle Subtitles List */}
                      <button
                        type="button"
                        onClick={() => setExpandedSubtitlesClipId(isSubsOpen ? null : clip.id)}
                        className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-slate-800/60"
                      >
                        <span>বাংলা সাবটাইটেল ({clip.subtitles.length})</span>
                        {isSubsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {/* Fine-Tune Timecode Drawer Toggle */}
                      <button
                        type="button"
                        onClick={() => {
                          if (isRecutOpen) {
                            setRecutClipId(null);
                          } else {
                            setRecutClipId(clip.id);
                            setRecutStart(clip.start);
                            setRecutEnd(clip.end);
                          }
                        }}
                        className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-slate-800/60"
                      >
                        <Scissors className="w-3.5 h-3.5 text-amber-400" />
                        <span>টাইমিং রিকাট</span>
                      </button>
                    </div>
                  </div>

                  {/* Expandable Subtitles List Drawer */}
                  {isSubsOpen && (
                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2 max-h-56 overflow-y-auto">
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 border-b border-slate-800 pb-1.5">
                        <span>টাইমকোড ({relativeTimecode ? '00:00:00 আপেক্ষিক' : 'মাস্টার টাইমলাইন'})</span>
                        <span>সাবটাইটেল টেক্সট</span>
                      </div>
                      {clip.subtitles.map((sub, idx) => (
                        <div
                          key={sub.id || idx}
                          onClick={() => handleAudioSeek(clip.id, sub.start)}
                          className="flex items-start gap-3 p-1.5 rounded-lg hover:bg-slate-900 cursor-pointer text-xs group"
                        >
                          <span className="font-mono text-emerald-400 text-[11px] shrink-0 pt-0.5">
                            {formatSeconds(sub.start)} ➔ {formatSeconds(sub.end)}
                          </span>
                          <span className="text-slate-200 group-hover:text-emerald-300 leading-snug">
                            {sub.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Expandable Re-cut Fine Tuning Drawer */}
                  {isRecutOpen && (
                    <div className="bg-slate-950 border border-amber-500/30 rounded-xl p-4 space-y-3 animate-fade-in">
                      <div className="flex items-center justify-between text-xs font-bold text-amber-400">
                        <span className="flex items-center gap-1.5">
                          <Scissors className="w-4 h-4" />
                          <span>ক্লিপের শুরু ও শেষের সময় ফাইন-টিউন ও রি-কাটিং</span>
                        </span>
                        <span className="text-slate-400 font-normal">
                          বর্তমান দৈর্ঘ্য: {Math.max(0, Math.round(recutEnd - recutStart))}s
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div className="space-y-1">
                          <label className="text-slate-400">শুরুর সময় (সেকেন্ড):</label>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setRecutStart((s) => Math.max(0, s - 2))}
                              className="px-2 py-1 bg-slate-800 rounded font-mono"
                            >
                              -2s
                            </button>
                            <input
                              type="number"
                              step="0.5"
                              value={recutStart}
                              onChange={(e) => setRecutStart(parseFloat(e.target.value) || 0)}
                              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-emerald-400 font-mono text-center"
                            />
                            <button
                              type="button"
                              onClick={() => setRecutStart((s) => s + 2)}
                              className="px-2 py-1 bg-slate-800 rounded font-mono"
                            >
                              +2s
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-slate-400">শেষের সময় (সেকেন্ড):</label>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setRecutEnd((s) => Math.max(recutStart + 1, s - 2))}
                              className="px-2 py-1 bg-slate-800 rounded font-mono"
                            >
                              -2s
                            </button>
                            <input
                              type="number"
                              step="0.5"
                              value={recutEnd}
                              onChange={(e) => setRecutEnd(parseFloat(e.target.value) || 0)}
                              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-emerald-400 font-mono text-center"
                            />
                            <button
                              type="button"
                              onClick={() => setRecutEnd((s) => s + 2)}
                              className="px-2 py-1 bg-slate-800 rounded font-mono"
                            >
                              +2s
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setRecutClipId(null)}
                          className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                        >
                          বাতিল
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRecutSubmit(clip)}
                          disabled={isRecutting}
                          className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-1.5 transition-all disabled:opacity-50"
                        >
                          {isRecutting ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>কাটা হচ্ছে...</span>
                            </>
                          ) : (
                            <>
                              <Scissors className="w-3.5 h-3.5" />
                              <span>নতুন করে কাটুন</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <GeminiApiSettingsModal
        isOpen={showApiModal}
        onClose={() => setShowApiModal(false)}
      />
    </div>
  );
};
