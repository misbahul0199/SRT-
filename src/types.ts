export type SpeakerGender = 'male' | 'female' | 'child' | 'elderly';

export interface DetectedCharacter {
  speakerId: string;
  characterName: string;
  gender: SpeakerGender;
  ageGroup: 'child' | 'young' | 'adult' | 'elderly';
  roleDescription: string;
  lineCount?: number;
}

export interface SubtitleSegment {
  id: string | number;
  index: number;
  start: number; // in seconds
  end: number;   // in seconds
  originalText?: string;
  text: string;  // translated / formatted subtitle text
  speaker?: string;
  speakerGender?: SpeakerGender;
  speakerRole?: string;
  detectedLanguage?: string; // mixed language per segment (e.g. Urdu, Hindi, English, Bengali)
  isCustomEdited?: boolean;
}

export interface SpeakerProfile {
  id: string; // e.g. "Speaker 1"
  name: string;
  gender: SpeakerGender;
  color: string;
}

export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
  direction?: 'ltr' | 'rtl';
}

export interface AppSettings {
  maxCharsPerLine: number;
  maxLines: number;
  globalOffsetMs: number;
  subtitleFontSize: number; // in px, e.g. 18
  autoScrollToActive: boolean;
  originalVolume: number; // 0 to 1
}

export type ClipCategory = 'emotional' | 'historical' | 'informational' | 'dramatic' | 'mixed';

export interface SmartClip {
  id: string;
  clipIndex: number;
  category: ClipCategory;
  categoryLabel: string;
  categoryBadgeColor: string;
  headline: string;
  summary: string;
  topicConclusion: string; // Explanation of why this topic/sentence is fully completed without abrupt cut
  start: number; // in seconds
  end: number;   // in seconds
  duration: number; // in seconds
  audioUrl: string; // audio playback stream URL
  audioDownloadUrl: string; // audio download URL
  audioFileName: string;
  subtitles: SubtitleSegment[]; // relative subtitles (00:00:00 start)
  masterSubtitles?: SubtitleSegment[]; // master timeline subtitles
  srtRelative: string;
  srtMaster: string;
  vttRelative: string;
  txtTranscript: string;
  viralScore?: number;
}

export interface ClipAnalysisConfig {
  focusArea: ClipCategory;
  targetDurationSec: number; // e.g. 60, 120, 180, 300, 600
  clipCount: number; // 1 to 20
  completionFlexibility: 'smart' | 'strict' | 'generous'; // ±15s to ±45s tolerance
  sourceLang: string;
  targetLang: string;
}

