import { LanguageOption } from '../types';

export const SOURCE_LANGUAGES: LanguageOption[] = [
  { code: 'auto', name: 'Auto Detect (স্বয়ংক্রিয় শনাক্ত)', nativeName: 'Auto Detect', flag: '🌐' },
  { code: 'ur', name: 'Urdu (উর্দু)', nativeName: 'اردو', flag: '🇵🇰', direction: 'rtl' },
  { code: 'en', name: 'English (ইংরেজি)', nativeName: 'English', flag: '🇺🇸' },
  { code: 'hi', name: 'Hindi (হিন্দি)', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { code: 'ko', name: 'Korean (কোরিয়ান)', nativeName: '한국어', flag: '🇰🇷' },
  { code: 'zh', name: 'Chinese (চাইনিজ - Mandarin)', nativeName: '中文 (普通话)', flag: '🇨🇳' },
  { code: 'bn', name: 'Bengali (বাংলা)', nativeName: 'বাংলা', flag: '🇧🇩' },
  { code: 'ar', name: 'Arabic (আরবি)', nativeName: 'العربية', flag: '🇸🇦', direction: 'rtl' },
  { code: 'ja', name: 'Japanese (জাপানি)', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'es', name: 'Spanish (স্প্যানিশ)', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French (ফরাসি)', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'German (জার্মান)', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'ru', name: 'Russian (রুশ)', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'pt', name: 'Portuguese (পর্তুগিজ)', nativeName: 'Português', flag: '🇧🇷' },
  { code: 'tr', name: 'Turkish (তুর্কি)', nativeName: 'Türkçe', flag: '🇹🇷' },
];

export const TARGET_LANGUAGES: LanguageOption[] = [
  { code: 'bn', name: 'Bengali (বাংলা)', nativeName: 'বাংলা', flag: '🇧🇩' },
  { code: 'en', name: 'English (ইংরেজি)', nativeName: 'English', flag: '🇺🇸' },
  { code: 'ur', name: 'Urdu (উর্দু)', nativeName: 'اردو', flag: '🇵🇰', direction: 'rtl' },
  { code: 'hi', name: 'Hindi (হিন্দি)', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { code: 'ko', name: 'Korean (কোরিয়ান)', nativeName: '한국어', flag: '🇰🇷' },
  { code: 'zh', name: 'Chinese (চাইনিজ)', nativeName: '中文', flag: '🇨🇳' },
  { code: 'ar', name: 'Arabic (আরবি)', nativeName: 'العربية', flag: '🇸🇦', direction: 'rtl' },
  { code: 'ja', name: 'Japanese (জাপানি)', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'es', name: 'Spanish (স্প্যানিশ)', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French (ফরাসি)', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'German (জার্মান)', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'ru', name: 'Russian (রুশ)', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'pt', name: 'Portuguese (পর্তুগিজ)', nativeName: 'Português', flag: '🇧🇷' },
  { code: 'tr', name: 'Turkish (তুর্কি)', nativeName: 'Türkçe', flag: '🇹🇷' },
];

export const AI_VOICES = [
  { id: 'Kore', name: 'Kore (স্বাভাবিক ও সুরেলা নারী কণ্ঠ)', gender: 'Female', description: 'Warm, clear, and professional tone' },
  { id: 'Puck', name: 'Puck (সাবলীল ও উদ্যমী কণ্ঠ)', gender: 'Male/Neutral', description: 'Upbeat, energetic and crisp' },
  { id: 'Charon', name: 'Charon (গম্ভীর ও প্রামাণ্য পুরুষ কণ্ঠ)', gender: 'Male', description: 'Deep, authoritative and cinematic' },
  { id: 'Fenrir', name: 'Fenrir (দৃঢ় ও স্পষ্ট পুরুষ কণ্ঠ)', gender: 'Male', description: 'Strong, resolute and articulate' },
  { id: 'Zephyr', name: 'Zephyr (শান্ত ও স্নিগ্ধ নারী কণ্ঠ)', gender: 'Female', description: 'Calm, gentle, soothing narration' },
];
