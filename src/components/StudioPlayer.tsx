import React, { useRef, useEffect, useState } from 'react';
import { 
  Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, 
  Layers, Clock, Music, Gauge, FastForward, Sliders,
  Film, Upload
} from 'lucide-react';
import { SubtitleSegment, AppSettings } from '../types';
import { formatDisplayTime } from '../utils/subtitleUtils';

interface StudioPlayerProps {
  mediaUrl: string | null;
  file: File | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onTimeUpdate: (time: number) => void;
  onLoadedMetadata: (dur: number) => void;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  activeSubtitle: SubtitleSegment | undefined;
  settings: AppSettings;
  setSettings?: React.Dispatch<React.SetStateAction<AppSettings>>;
  originalVolume: number;
  setOriginalVolume: (vol: number) => void;
  subtitles?: SubtitleSegment[];
  setSubtitles?: React.Dispatch<React.SetStateAction<SubtitleSegment[]>>;
  setMediaUrl?: (url: string | null) => void;
  setFile?: (file: File | null) => void;
  setDuration?: (dur: number) => void;
}

export const StudioPlayer: React.FC<StudioPlayerProps> = ({
  mediaUrl,
  file,
  currentTime,
  duration,
  isPlaying,
  onTimeUpdate,
  onLoadedMetadata,
  onPlayPause,
  onSeek,
  activeSubtitle,
  settings,
  setSettings,
  originalVolume,
  setOriginalVolume,
  subtitles,
  setSubtitles,
  setMediaUrl,
  setFile,
  setDuration,
}) => {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [customOffsetInput, setCustomOffsetInput] = useState<string>('');
  const [isMobileCompact, setIsMobileCompact] = useState<boolean>(false);
  const [permanentSuccessMsg, setPermanentSuccessMsg] = useState<boolean>(false);

  const isVideo = Boolean(file?.type.startsWith('video'));

  const handleMediaAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    const newUrl = URL.createObjectURL(selectedFile);
    if (setMediaUrl) setMediaUrl(newUrl);
    if (setFile) setFile(selectedFile);

    const isVid = selectedFile.type.startsWith('video');
    const elem = document.createElement(isVid ? 'video' : 'audio');
    elem.src = newUrl;
    elem.onloadedmetadata = () => {
      if (elem.duration && isFinite(elem.duration) && elem.duration > 0) {
        onLoadedMetadata(elem.duration);
        if (setDuration) setDuration(elem.duration);
      }
    };
    if (e.target) e.target.value = '';
  };

  // Sync mediaRef play/pause with parent isPlaying state
  useEffect(() => {
    if (mediaRef.current) {
      if (isPlaying) {
        mediaRef.current.play().catch(() => {});
      } else {
        mediaRef.current.pause();
      }
    }
  }, [isPlaying]);

  // High-frequency 60fps timecode update loop during playback for sub-frame subtitle sync
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const tick = (now: number) => {
      if (isPlaying) {
        if (mediaRef.current && !mediaRef.current.paused) {
          onTimeUpdate(mediaRef.current.currentTime);
        } else if (!mediaUrl) {
          // Virtual timer playback mode for standalone SRT files
          const dt = (now - lastTime) / 1000;
          const nextTime = currentTime + dt * playbackRate;
          if (duration > 0 && nextTime >= duration) {
            onSeek(0);
            onPlayPause();
            return;
          } else {
            onTimeUpdate(nextTime);
          }
        }
        lastTime = now;
        animId = requestAnimationFrame(tick);
      }
    };

    if (isPlaying) {
      lastTime = performance.now();
      animId = requestAnimationFrame(tick);
    }
    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isPlaying, mediaUrl, currentTime, duration, playbackRate, onTimeUpdate, onSeek, onPlayPause]);

  // Sync volume of primary media
  useEffect(() => {
    if (mediaRef.current) {
      mediaRef.current.volume = isMuted ? 0 : originalVolume;
    }
  }, [originalVolume, isMuted]);

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = Number(e.target.value);
    onSeek(newTime);
    if (mediaRef.current) {
      mediaRef.current.currentTime = newTime;
    }
  };

  const handleSkip = (delta: number) => {
    const target = Math.max(0, Math.min(duration, currentTime + delta));
    onSeek(target);
    if (mediaRef.current) {
      mediaRef.current.currentTime = target;
    }
  };

  const cyclePlaybackRate = () => {
    const rates = [0.75, 1, 1.25, 1.5];
    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
    const nextRate = rates[nextIdx];
    setPlaybackRate(nextRate);
    if (mediaRef.current) mediaRef.current.playbackRate = nextRate;
  };

  // Adjust global offset
  const handleNudgeOffset = (deltaMs: number) => {
    if (setSettings) {
      setSettings((prev) => ({
        ...prev,
        globalOffsetMs: prev.globalOffsetMs + deltaMs,
      }));
    }
  };

  const handleSetCustomOffset = () => {
    const val = parseInt(customOffsetInput, 10);
    if (!isNaN(val) && setSettings) {
      setSettings((prev) => ({
        ...prev,
        globalOffsetMs: val,
      }));
      setCustomOffsetInput('');
    }
  };

  const handleResetOffset = () => {
    if (setSettings) {
      setSettings((prev) => ({
        ...prev,
        globalOffsetMs: 0,
      }));
    }
  };

  // Commit current global offset permanently to all subtitle timestamps
  const handleApplyPermanently = () => {
    if (!setSubtitles || !subtitles || subtitles.length === 0 || settings.globalOffsetMs === 0) return;
    const deltaSec = settings.globalOffsetMs / 1000;
    setSubtitles((prev) =>
      prev.map((sub) => {
        const newStart = Math.max(0, Math.round((sub.start + deltaSec) * 100) / 100);
        const newEnd = Math.max(newStart + 0.3, Math.round((sub.end + deltaSec) * 100) / 100);
        return { ...sub, start: newStart, end: newEnd };
      })
    );
    if (setSettings) {
      setSettings((prev) => ({ ...prev, globalOffsetMs: 0 }));
    }
    setPermanentSuccessMsg(true);
    setTimeout(() => setPermanentSuccessMsg(false), 3500);
  };

  // Millisecond precision timecode formatter: 00:01:23.450
  const formatPreciseTime = (sec: number) => {
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60);
    const remainderSec = s % 60;
    const wholeSec = Math.floor(remainderSec);
    const ms = Math.floor((remainderSec - wholeSec) * 1000);
    return `${String(m).padStart(2, '0')}:${String(wholeSec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };

  // Reading speed in characters per second
  const cueDuration = activeSubtitle ? Math.max(0.1, activeSubtitle.end - activeSubtitle.start) : 0;
  const charsPerSecond = activeSubtitle ? Math.round((activeSubtitle.text.length / cueDuration) * 10) / 10 : 0;

  return (
    <div className="flex flex-col bg-slate-900 border-b lg:border-b-0 lg:border-r border-slate-800 p-4 sm:p-5 overflow-y-auto w-full lg:w-5/12 shrink-0">
      
      {/* Header Info */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-4 h-4" /> মিডিয়া প্লেয়ার
          </span>
          <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
            {isVideo ? 'ভিডিও' : 'অডিও'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Attach / Change Media File */}
          <label
            className="text-[11px] font-medium px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1 cursor-pointer transition-colors"
            title="কম্পিউটার থেকে অডিও বা ভিডিও ফাইল যুক্ত বা পরিবর্তন করুন"
          >
            <Film className="w-3.5 h-3.5 text-teal-400" />
            <span className="hidden sm:inline">{mediaUrl ? 'মিডিয়া পরিবর্তন' : 'ভিডিও/অডিও যোগ'}</span>
            <input
              type="file"
              accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.mp4,.webm,.mkv"
              onChange={handleMediaAttach}
              className="hidden"
            />
          </label>

          {/* Mobile screen toggle for convenient editing */}
          <button
            onClick={() => setIsMobileCompact(!isMobileCompact)}
            className="lg:hidden text-[11px] font-medium px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1 cursor-pointer transition-colors"
            title="মোবাইলে এডিটর দেখার সুবিধার্থে প্লেয়ারের আকার ছোট বা বড় করুন"
          >
            <span>{isMobileCompact ? '🖥 ফুল স্ক্রিন' : '📱 কমপ্যাক্ট'}</span>
          </button>

          <div className="text-[11px] font-mono text-emerald-400 bg-emerald-950/70 border border-emerald-800 px-2 py-0.5 rounded flex items-center gap-1">
            <Clock className="w-3 h-3 text-emerald-400" />
            <span>{formatPreciseTime(currentTime)}</span>
          </div>
        </div>
      </div>

      {/* Screen Container */}
      <div
        className={`relative bg-black rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center group mb-4 shadow-xl transition-all ${
          isMobileCompact ? 'h-16 aspect-auto' : 'aspect-video'
        }`}
      >
        {isMobileCompact && (
          <div className="flex items-center justify-between px-3 w-full h-full bg-slate-950/90 z-20">
            <div className="flex items-center gap-2 truncate pr-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <p className="text-xs text-slate-200 truncate font-semibold">
                {activeSubtitle ? activeSubtitle.text : 'কমপ্যাক্ট প্লেয়ার মোড সক্রিয়'}
              </p>
            </div>
            <span className="text-[10px] text-emerald-400 font-mono shrink-0 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800">
              {formatPreciseTime(currentTime)}
            </span>
          </div>
        )}

        {mediaUrl ? (
          isVideo ? (
            <video
              ref={mediaRef as React.RefObject<HTMLVideoElement>}
              src={mediaUrl}
              className={`w-full h-full object-contain ${isMobileCompact ? 'hidden' : 'block'}`}
              onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => {
                if (e.currentTarget.duration && isFinite(e.currentTarget.duration)) {
                  onLoadedMetadata(e.currentTarget.duration);
                }
              }}
              onClick={onPlayPause}
            />
          ) : (
            <div className={`flex flex-col items-center justify-center p-6 text-center w-full ${isMobileCompact ? 'hidden' : 'flex'}`}>
              <audio
                ref={mediaRef as React.RefObject<HTMLAudioElement>}
                src={mediaUrl}
                onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => {
                  if (e.currentTarget.duration && isFinite(e.currentTarget.duration)) {
                    onLoadedMetadata(e.currentTarget.duration);
                  }
                }}
              />
              <div className="w-16 h-16 rounded-full bg-emerald-950/80 border border-emerald-800/80 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-950 mb-3">
                <Music className={`w-8 h-8 ${isPlaying ? 'animate-bounce' : ''}`} />
              </div>
              <p className="text-xs font-semibold text-slate-300 truncate max-w-xs">{file?.name || 'অডিও ফাইল'}</p>
              <p className="text-[11px] text-emerald-400 font-mono mt-1">
                লাইভ স্পিচ সিনক্রোনাইজেশন সক্রিয়
              </p>
            </div>
          )
        ) : (
          <div className={`flex flex-col items-center justify-center p-6 text-center w-full h-full bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 relative overflow-hidden ${isMobileCompact ? 'hidden' : 'flex'}`}>
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-xl mb-3">
              <Film className="w-6 h-6" />
            </div>
            {activeSubtitle ? (
              <div className="max-w-md px-4 py-2 bg-black/70 border border-white/10 rounded-xl mb-3 shadow-xl">
                <span className="text-[10px] text-emerald-400 font-mono block mb-1">
                  {activeSubtitle.speaker || 'Speaker 1'} • [{formatPreciseTime(activeSubtitle.start)} - {formatPreciseTime(activeSubtitle.end)}]
                </span>
                <p className="text-base font-bold text-white whitespace-pre-line leading-relaxed">
                  {activeSubtitle.text}
                </p>
              </div>
            ) : (
              <div className="space-y-1 mb-4">
                <h4 className="text-sm font-bold text-white">
                  SRT সাবটাইটেল প্লেয়ার সক্রিয়
                </h4>
                <p className="text-xs text-slate-400 max-w-xs">
                  নিচের প্লে বাটনে ক্লিক করে টাইমলাইন প্রিভিউ দেখুন অথবা ভিডিও ফাইলটি যুক্ত করুন।
                </p>
              </div>
            )}
            <label className="cursor-pointer inline-flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-950/60">
              <Upload className="w-3.5 h-3.5" />
              <span>ভিডিও বা অডিও ফাইল যুক্ত করুন</span>
              <input
                type="file"
                accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.mp4,.webm,.mkv"
                onChange={handleMediaAttach}
                className="hidden"
              />
            </label>
          </div>
        )}

        {/* Live Subtitle Overlay on Media Screen (visible when not compact) */}
        {!isMobileCompact && (
          <div className="absolute inset-x-3 bottom-3 sm:bottom-4 pointer-events-none flex justify-center text-center z-10">
            {activeSubtitle ? (
              <div
                className="bg-black/85 backdrop-blur-sm text-white px-3 sm:px-4 py-1.5 rounded-lg border border-white/10 shadow-2xl max-w-[92%] transition-all duration-150 animate-in fade-in zoom-in-95"
                style={{ fontSize: `${settings.subtitleFontSize}px` }}
              >
                <p className="font-bold leading-relaxed whitespace-pre-line drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
                  {activeSubtitle.text}
                </p>
              </div>
            ) : (
              <div className="opacity-0 group-hover:opacity-60 transition-opacity text-[10px] text-slate-400 bg-slate-900/60 px-2 py-0.5 rounded">
                স্ক্রিনে সাবটাইটেল প্রিভিউ সক্রিয়
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scrub Bar & Player Controls */}
      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 mb-4 space-y-3">
        {/* Progress Range Slider */}
        <div className="space-y-1">
          <input
            type="range"
            min="0"
            max={duration || 1}
            step="0.05"
            value={currentTime}
            onChange={handleSeekChange}
            className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer transition-all"
          />
          <div className="flex justify-between text-[10px] font-mono text-slate-500">
            <span>{formatDisplayTime(currentTime)}</span>
            <span>{formatDisplayTime(duration)}</span>
          </div>
        </div>

        {/* Control Buttons Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1 sm:space-x-2">
            <button
              onClick={() => handleSkip(-5)}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              title="৫ সেকেন্ড পেছনে যান"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              onClick={onPlayPause}
              className="bg-emerald-600 hover:bg-emerald-500 text-white p-2.5 rounded-xl shadow-md shadow-emerald-900/40 transition-transform active:scale-95 cursor-pointer"
              title={isPlaying ? 'পজ করুন' : 'প্লে করুন'}
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
            </button>

            <button
              onClick={() => handleSkip(5)}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              title="৫ সেকেন্ড সামনে যান"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            <button
              onClick={cyclePlaybackRate}
              className="text-[11px] font-mono px-2 py-1 bg-slate-900 text-slate-300 rounded border border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
              title="প্লেব্যাক স্পিড পরিবর্তন করুন (ধীর গতিতে কথার সাথে টাইমিং চেক করতে ০.৭৫x ব্যবহার করুন)"
            >
              {playbackRate}x
            </button>
          </div>

          {/* Volume Control */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className={`p-1.5 rounded-lg border transition-colors ${
                isMuted
                  ? 'bg-red-950/80 border-red-800 text-red-400'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
              }`}
              title={isMuted ? 'আনমিউট করুন' : 'মিউট করুন'}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : originalVolume}
              onChange={(e) => {
                setOriginalVolume(Number(e.target.value));
                if (isMuted) setIsMuted(false);
              }}
              className="w-16 accent-emerald-500 h-1 bg-slate-800 rounded cursor-pointer hidden sm:inline-block"
              title="ভলিউম"
            />
          </div>
        </div>
      </div>

      {/* Global Timecode Sync & Offset Panel */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs font-bold text-slate-200">কথার সাথে নিখুঁত টাইমকোড সিঙ্ক (Global Sync Offset)</span>
          </div>
          <span className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
            settings.globalOffsetMs === 0 
              ? 'bg-slate-900 border-slate-800 text-slate-400' 
              : settings.globalOffsetMs > 0 
              ? 'bg-emerald-950 border-emerald-800 text-emerald-400 font-bold'
              : 'bg-amber-950 border-amber-800 text-amber-400 font-bold'
          }`}>
            {settings.globalOffsetMs > 0 ? `+${settings.globalOffsetMs}ms` : `${settings.globalOffsetMs}ms`}
          </span>
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          ভিডিওর কথার সাথে সাবটাইটেল ১/২ সেকেন্ড বা কয়েকশো মিলি-সেকেন্ডের পার্থক্য থাকলে এক ক্লিকেই সম্পূর্ণ ফাইলের টাইমকোড নিখুঁতভাবে এগিয়ে বা পিছিয়ে মিলান:
        </p>

        {/* Instant Offset Nudge Buttons - Row 1 (100ms, 200ms, 500ms, 1000ms) */}
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => handleNudgeOffset(-1000)}
            className="px-2 py-1.5 rounded-lg text-[10px] font-mono font-bold bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-amber-700 text-amber-300 transition-colors"
            title="সব সাবটাইটেল ১ সেকেন্ড আগে আনুন"
          >
            -1.0s
          </button>
          <button
            onClick={() => handleNudgeOffset(-500)}
            className="px-2 py-1.5 rounded-lg text-[10px] font-mono font-bold bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-amber-700 text-amber-300 transition-colors"
            title="সব সাবটাইটেল ০.৫ সেকেন্ড আগে আনুন"
          >
            -0.5s
          </button>
          <button
            onClick={() => handleNudgeOffset(-200)}
            className="px-1.5 py-1.5 rounded-lg text-[10px] font-mono font-bold bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 transition-colors"
            title="সব সাবটাইটেল ২০০ms আগে আনুন"
          >
            -200ms
          </button>
          <button
            onClick={() => handleNudgeOffset(-100)}
            className="px-1.5 py-1.5 rounded-lg text-[10px] font-mono font-bold bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 transition-colors"
            title="সব সাবটাইটেল ১০০ms আগে আনুন"
          >
            -100ms
          </button>
          <button
            onClick={handleResetOffset}
            className="px-2 py-1.5 rounded-lg text-[10px] font-mono font-bold bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white transition-colors"
            title="অফসেট রিসেট করুন (0ms)"
          >
            ০ms
          </button>
          <button
            onClick={() => handleNudgeOffset(100)}
            className="px-1.5 py-1.5 rounded-lg text-[10px] font-mono font-bold bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-emerald-800 text-emerald-300 transition-colors"
            title="সব সাবটাইটেল ১০০ms পিছিয়ে দিন"
          >
            +100ms
          </button>
          <button
            onClick={() => handleNudgeOffset(200)}
            className="px-1.5 py-1.5 rounded-lg text-[10px] font-mono font-bold bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-emerald-800 text-emerald-300 transition-colors"
            title="সব সাবটাইটেল ২০০ms পিছিয়ে দিন"
          >
            +200ms
          </button>
          <button
            onClick={() => handleNudgeOffset(500)}
            className="px-2 py-1.5 rounded-lg text-[10px] font-mono font-bold bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-emerald-800 text-emerald-300 transition-colors"
            title="সব সাবটাইটেল ০.৫ সেকেন্ড পিছিয়ে দিন"
          >
            +0.5s
          </button>
          <button
            onClick={() => handleNudgeOffset(1000)}
            className="px-2 py-1.5 rounded-lg text-[10px] font-mono font-bold bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-emerald-800 text-emerald-300 transition-colors"
            title="সব সাবটাইটেল ১ সেকেন্ড পিছিয়ে দিন"
          >
            +1.0s
          </button>
        </div>

        {/* Custom Input and Apply Permanently Action */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/60">
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              placeholder="উদা: -1200 বা 800"
              value={customOffsetInput}
              onChange={(e) => setCustomOffsetInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSetCustomOffset()}
              className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-200 font-mono w-28 focus:outline-none focus:border-emerald-500"
            />
            <button
              onClick={handleSetCustomOffset}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-medium transition-colors"
            >
              সেট ms
            </button>
          </div>

          {settings.globalOffsetMs !== 0 && setSubtitles && (
            <button
              onClick={handleApplyPermanently}
              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition-all flex items-center gap-1 shadow-md shadow-emerald-900/40 cursor-pointer active:scale-95"
              title="বর্তমান অফসেটটি মূল সাবটাইটেল ফাইলের টাইমকোডে স্থায়ীভাবে সেভ করুন যাতে ডাউনলোড করা SRT-তে এই টাইমিং থাকে"
            >
              <span>✅ ফাইলের টাইমে স্থায়ী করুন</span>
            </button>
          )}
        </div>

        {permanentSuccessMsg && (
          <div className="p-2.5 rounded-lg bg-emerald-950/90 border border-emerald-600 text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
            <span className="text-emerald-400">✓</span>
            <span>সমস্ত সাবটাইটেলের টাইমকোডে অফসেট স্থায়ীভাবে প্রয়োগ করা হয়েছে! এক্সপোর্ট করা SRT ফাইলে নিখুঁত টাইমিং সেভ থাকবে।</span>
          </div>
        )}
      </div>

      {/* Active Subtitle Detailed Card */}
      <div className="mt-4 bg-slate-950 border border-emerald-900/40 rounded-xl p-3 shadow-md">
        <div className="flex justify-between items-center text-[10px] text-emerald-400 font-mono mb-1.5">
          <span className="flex items-center gap-1">
            <Gauge className="w-3 h-3 text-emerald-400" />
            চলমান সাবটাইটেল ও পড়ার গতি
          </span>
          <span>
            {activeSubtitle ? (
              `#${activeSubtitle.index} (${cueDuration.toFixed(1)}s • ${charsPerSecond} অক্ষর/সে.)`
            ) : (
              'নিস্তব্ধ বিরতি'
            )}
          </span>
        </div>
        <div className="min-h-[48px] flex items-center justify-center text-center p-2.5 rounded bg-slate-900/80 border border-slate-800/80">
          <p className="text-xs sm:text-sm font-semibold text-slate-100 whitespace-pre-line leading-relaxed">
            {activeSubtitle ? (
              activeSubtitle.text
            ) : (
              <span className="text-slate-600 font-normal italic">[বর্তমানে কোনো কথা বলা হচ্ছে না]</span>
            )}
          </p>
        </div>
      </div>

    </div>
  );
};
