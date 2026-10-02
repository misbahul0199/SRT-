import { SubtitleSegment } from '../types';

export const DEMO_SUBTITLES_SAMPLE: SubtitleSegment[] = [
  {
    id: 1,
    index: 1,
    start: 0.5,
    end: 3.8,
    detectedLanguage: 'Urdu',
    originalText: 'خوش آمدید، آج ہم مصنوعی ذہانت کی نئی دنیا میں قدم رکھ رہے ہیں۔',
    text: 'স্বাগতম, আজ আমরা কৃত্রিম বুদ্ধিমত্তার নতুন যুগে প্রবেশ করছি।',
    speaker: 'Speaker 1 (পুরুষ)',
    speakerGender: 'male',
    speakerRole: 'পুরুষ উপস্থাপক',
  },
  {
    id: 2,
    index: 2,
    start: 4.0,
    end: 7.5,
    detectedLanguage: 'English',
    originalText: 'Welcome everyone! This smart engine detects multiple languages in a single track automatically.',
    text: 'সবাইকে স্বাগতম! এই বুদ্ধিমান ইঞ্জিন একই ট্র্যাকে একাধিক ভাষা স্বয়ংক্রিয়ভাবে শনাক্ত করতে পারে।',
    speaker: 'Speaker 2 (মহিলা)',
    speakerGender: 'female',
    speakerRole: 'মহিলা বক্তা',
  },
  {
    id: 3,
    index: 3,
    start: 7.8,
    end: 11.2,
    detectedLanguage: 'Hindi',
    originalText: 'नमस्ते दोस्तों! क्या हर संवाद की सही टाइमिंग के साथ सबটাইটेल बनेगा?',
    text: 'নমস্কার বন্ধুরা! প্রতিটি কথার সঠিক টাইমিং বজায় রেখে সাবটাইটেল তৈরি হবে তো?',
    speaker: 'Speaker 3 (বাচ্চা)',
    speakerGender: 'child',
    speakerRole: 'ছোট শিশু',
  },
  {
    id: 4,
    index: 4,
    start: 11.5,
    end: 15.0,
    detectedLanguage: 'Urdu / Hindi',
    originalText: 'بالکل! اب ہر فقرہ بولنے کے وقت کے ساتھ ہی سکرین پر دکھائی دے گا۔',
    text: 'অবশ্যই! এখন প্রতিটি কথা বলার নিখুঁত সময়ে স্ক্রিনে সাবটাইটেল ফুটে উঠবে।',
    speaker: 'Speaker 1 (পুরুষ)',
    speakerGender: 'male',
    speakerRole: 'পুরুষ উপস্থাপক',
  },
];

// Creates a short friendly speech-like synthesized audio tone beep sequence as a fallback demo audio blob
export function createSyntheticDemoAudioBlob(): Blob {
  const sampleRate = 22050;
  const duration = 15.5; // seconds
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  // RIFF header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  // Generate a melodious speech-cadence sound
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;
    
    // Four distinct speech phrases corresponding to the 4 demo subtitles
    if ((t >= 0.5 && t <= 3.8) || (t >= 4.0 && t <= 7.5) || (t >= 7.8 && t <= 11.2) || (t >= 11.5 && t <= 15.0)) {
      const f1 = 260 + Math.sin(t * 8) * 40;
      const f2 = 520 + Math.cos(t * 5) * 60;
      const envelope = Math.min(1, Math.sin((t % 3.5) / 3.5 * Math.PI));
      sample = (Math.sin(2 * Math.PI * f1 * t) * 0.4 + Math.sin(2 * Math.PI * f2 * t) * 0.2) * envelope;
    }
    
    const intSample = Math.max(-1, Math.min(1, sample)) * 0x7fff;
    view.setInt16(44 + i * 2, intSample, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
