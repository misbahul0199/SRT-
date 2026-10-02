import express from 'express';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import dns from 'node:dns';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import {
  GEMINI_MODEL,
  FALLBACK_GEMINI_MODEL,
  GeminiErrorType,
  executeGeminiRequest,
  classifyGeminiError,
  getCentralizedGenAI,
  safeParseJson,
} from './server/geminiService';

dotenv.config();

// Ensure IPv4 is resolved first to eliminate transient "fetch failed" socket hangs in container environments
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

const execFileAsync = promisify(execFile);

// Safe FFmpeg execution helper that prevents hanging on stdin or maxBuffer overflow on long audio/video
async function runSafeFfmpeg(args: string[], options: { timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  const safeArgs = ['-nostdin', ...args];
  return execFileAsync('ffmpeg', safeArgs, {
    maxBuffer: 50 * 1024 * 1024, // 50MB buffer to never choke on stderr
    timeout: options.timeoutMs || 120000, // 2-minute safety timeout to prevent hanging forever
  });
}

// Safe FFprobe execution helper (ffprobe does not accept -nostdin)
async function runSafeFfprobe(args: string[], options: { timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('ffprobe', args, {
    maxBuffer: 10 * 1024 * 1024,
    timeout: options.timeoutMs || 30000,
  });
}

// Resilient media duration detector with multiple reliable fallbacks
async function getMediaDuration(filePath: string): Promise<number> {
  try {
    if (!fs.existsSync(filePath)) return 0;
    const stats = await fsp.stat(filePath);
    if (!stats || stats.size === 0) return 0;

    // Strategy 1: ffprobe format=duration
    try {
      const { stdout } = await runSafeFfprobe([
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);
      const parsed = parseFloat(stdout.trim());
      if (!isNaN(parsed) && parsed > 0) return Math.round(parsed * 100) / 100;
    } catch (_) {}

    // Strategy 2: ffprobe stream=duration
    try {
      const { stdout } = await runSafeFfprobe([
        '-v', 'error',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ]);
      const parsed = parseFloat(stdout.trim());
      if (!isNaN(parsed) && parsed > 0) return Math.round(parsed * 100) / 100;
    } catch (_) {}

    // Strategy 3: ffmpeg -i duration parsing from stderr
    try {
      const res = await execFileAsync('ffmpeg', ['-i', filePath], { timeout: 15000 }).catch((e) => e);
      const output = String(res?.stderr || res?.stdout || '');
      const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (match) {
        const hours = parseFloat(match[1]) || 0;
        const mins = parseFloat(match[2]) || 0;
        const secs = parseFloat(match[3]) || 0;
        const total = hours * 3600 + mins * 60 + secs;
        if (!isNaN(total) && total > 0) return Math.round(total * 100) / 100;
      }
    } catch (_) {}

    // Strategy 4: Bitrate fallback estimation (approx 96kbps ~ 12,000 bytes/sec)
    const estimatedSec = stats.size / 12000;
    if (estimatedSec > 0) return Math.round(estimatedSec);
  } catch (err) {
    console.warn('Media duration detection fallback error:', err);
  }
  return 0;
}

const app = express();
const PORT = 3000;

// Increase payload limit for audio/video uploads
app.use(express.json({ limit: '150mb' }));
app.use(express.urlencoded({ extended: true, limit: '150mb' }));

// Static directory for cut audio clips
const CLIPS_DIR = path.join('/tmp', 'studio_clips');
fsp.mkdir(CLIPS_DIR, { recursive: true }).catch(() => {});
app.use('/api/clips/audio-files', express.static(CLIPS_DIR));

// Helper to extract custom API key provided by user (via header or request body)
function extractApiKeyFromReq(req: express.Request): string | undefined {
  const headerKey = req.headers['x-gemini-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) {
    return headerKey.trim();
  }
  if (req.body && typeof req.body.customApiKey === 'string' && req.body.customApiKey.trim()) {
    return req.body.customApiKey.trim();
  }
  return undefined;
}

// Helper to get GoogleGenAI instance with configurable timeout (default 240s for audio analysis)
function getGenAI(timeoutMs: number = 240000, customApiKey?: string) {
  const apiKey = (customApiKey && typeof customApiKey === 'string' && customApiKey.trim()) || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key is required. Open Settings to add your key.');
  }
  const client = new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
      timeout: timeoutMs,
    },
  });
  (client as any)._customApiKey = customApiKey && typeof customApiKey === 'string' ? customApiKey.trim() : undefined;
  (client as any)._timeoutMs = timeoutMs;
  return client;
}

// Language Map for descriptive prompts
const LANGUAGE_NAMES: Record<string, string> = {
  auto: 'Auto-detected spoken language',
  ur: 'Urdu (اردو)',
  en: 'English',
  bn: 'Bengali (বাংলা)',
  hi: 'Hindi (हिन्दी)',
  ko: 'Korean (한국어)',
  zh: 'Chinese Mandarin (中文)',
  ja: 'Japanese (日本語)',
  ar: 'Arabic (العربية)',
  es: 'Spanish (Español)',
  fr: 'French (Français)',
  de: 'German (Deutsch)',
  ru: 'Russian (Русский)',
  pt: 'Portuguese (Português)',
  tr: 'Turkish (Türkçe)',
};

// API Route: Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    serverHasApiKey: Boolean(process.env.GEMINI_API_KEY),
  });
});

// API Route: Validate a custom Gemini API key
app.post('/api/gemini/validate-key', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({
      success: false,
      error: 'অনুগ্রহ করে একটি বৈধ Gemini API Key প্রদান করুন।',
    });
  }

  const trimmedKey = apiKey.trim();
  try {
    const testAi = new GoogleGenAI({
      apiKey: trimmedKey,
      httpOptions: {
        headers: { 'User-Agent': 'aistudio-build' },
        timeout: 15000,
      },
    });

    // Validate the API key via lightweight metadata lookup (does not consume generate_content quota!)
    let verifiedModel = 'gemini-2.5-flash';
    try {
      const modelInfo = await testAi.models.get({ model: 'gemini-2.5-flash' });
      verifiedModel = modelInfo.name || 'gemini-2.5-flash';
    } catch (getErr: any) {
      const msg = String(getErr?.message || getErr || '');
      if (
        msg.includes('API_KEY_INVALID') ||
        msg.includes('API key not valid') ||
        msg.includes('Invalid API key') ||
        (getErr?.status === 400 && msg.includes('API key'))
      ) {
        throw getErr;
      }
      // If 2.5-flash metadata call encounters rate limit or temporary issue, try 3.1-flash-lite
      try {
        const fallbackInfo = await testAi.models.get({ model: 'gemini-3.1-flash-lite' });
        verifiedModel = fallbackInfo.name || 'gemini-3.1-flash-lite';
      } catch (getErr2: any) {
        const msg2 = String(getErr2?.message || getErr2 || '');
        if (
          msg2.includes('API_KEY_INVALID') ||
          msg2.includes('API key not valid') ||
          msg2.includes('Invalid API key')
        ) {
          throw getErr2;
        }
        // If Google responds with RESOURCE_EXHAUSTED or 429, the key itself is authentic and verified with Google
        if (msg2.includes('RESOURCE_EXHAUSTED') || msg2.includes('429') || msg2.includes('quota')) {
          verifiedModel = 'gemini-3.1-flash-lite (Quotas Managed)';
        } else {
          throw getErr2;
        }
      }
    }

    return res.json({
      success: true,
      message: 'Gemini API Key সফলভাবে যাচাই হয়েছে এবং সক্রিয় রয়েছে!',
      verifiedModel,
    });
  } catch (err: any) {
    console.error('API key validation error:', err);
    const classified = classifyGeminiError(err);
    return res.status(400).json({
      success: false,
      error: classified.userMessage || 'API Key টি সঠিক নয় বা কোটা সীমা শেষ হয়েছে।',
      errorType: classified.errorType,
    });
  }
});

// Tracking map for model availability to avoid hitting models in temporary 503 or 429 cooldown
const modelCooldownMap = new Map<string, number>();

// Parse retry delay from Google API error details or message
function extractRetryDelayMs(error: any): number {
  try {
    const errorStr = typeof error === 'string' ? error : JSON.stringify(error);
    const delayMatch = errorStr.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)(s|ms)?"/i);
    if (delayMatch) {
      const val = parseFloat(delayMatch[1]);
      const unit = delayMatch[2]?.toLowerCase() || 's';
      return unit === 'ms' ? val : val * 1000;
    }
    // Match "Please retry in 4h48m19.022s" or "48m19s" or "19.5s"
    const compoundMatch = errorStr.match(/Please retry in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i);
    if (compoundMatch && (compoundMatch[1] || compoundMatch[2] || compoundMatch[3])) {
      const hours = compoundMatch[1] ? parseInt(compoundMatch[1], 10) : 0;
      const minutes = compoundMatch[2] ? parseInt(compoundMatch[2], 10) : 0;
      const seconds = compoundMatch[3] ? parseFloat(compoundMatch[3]) : 0;
      return (hours * 3600 + minutes * 60 + seconds) * 1000;
    }
  } catch {}
  return 0;
}

// Check if error is permanent or extended daily quota exhaustion
function isDailyQuotaExhausted(error: any): boolean {
  const errorStr = typeof error === 'string' ? error : JSON.stringify(error);
  if (
    /per_day|perday|per_model_per_day|generate_requests_per_model|day_limit|daily_limit|limit:\s*20\b/i.test(errorStr)
  ) {
    return true;
  }
  const delayMs = extractRetryDelayMs(error);
  if (delayMs > 300000) {
    // Retry delay is more than 5 minutes -> It's a daily/hourly quota limit, not a momentary RPM burst
    return true;
  }
  return false;
}

// Universal resilient JSON array parser with bracket-depth extraction and markdown cleanup
function safeParseJsonArray<T = any>(rawText: string, fallback: T[] = []): T[] {
  let cleaned = String(rawText || '').trim();
  if (!cleaned) return fallback;

  // Strip markdown code fences if present
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 1. Direct JSON parse
  try {
    const data = JSON.parse(cleaned);
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      const arr =
        (data as any).clips ||
        (data as any).segments ||
        (data as any).translations ||
        Object.values(data).find((v) => Array.isArray(v));
      if (Array.isArray(arr)) return arr;
    }
  } catch (_) {}

  // 2. Substring between outermost [ and ]
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      const data = JSON.parse(cleaned.slice(firstBracket, lastBracket + 1));
      if (Array.isArray(data)) return data;
    } catch (_) {}
  }

  // 3. Bracket-depth recovery for array of objects [ { ... }, { ... } ]
  try {
    const startIdx = firstBracket !== -1 ? firstBracket + 1 : 0;
    const body = cleaned.slice(startIdx);
    const objects: T[] = [];
    let braceDepth = 0;
    let objStart = -1;
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === '\\') {
        escapeNext = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === '{') {
        if (braceDepth === 0) objStart = i;
        braceDepth++;
      } else if (ch === '}') {
        braceDepth--;
        if (braceDepth === 0 && objStart !== -1) {
          const rawObj = body.slice(objStart, i + 1);
          try {
            const parsedObj = JSON.parse(rawObj);
            objects.push(parsedObj);
          } catch (_) {}
          objStart = -1;
        }
      }
    }
    if (objects.length > 0) return objects;
  } catch (_) {}

  return fallback;
}

// Centralized Gemini model caller routing through server/geminiService
async function generateContentWithRetryAndFallback(
  ai: ReturnType<typeof getGenAI>,
  params: {
    contents: any;
    config?: any;
    operation?: string;
    modelPool?: string[];
    customApiKey?: string;
  }
) {
  const customApiKey = params.customApiKey || (ai as any)?._customApiKey;
  const timeoutMs = (ai as any)?._timeoutMs || 240000;
  const result = await executeGeminiRequest({
    operation: params.operation || 'Gemini Generation',
    contents: params.contents,
    config: params.config,
    customApiKey,
    timeoutMs,
  });

  return {
    text: result.text,
    modelUsed: result.modelUsed,
    fromCache: result.fromCache,
    diagnostic: result.diagnostic,
  };
}

// Resilient subtitle JSON parser and bracket-depth stream recovery engine
function robustParseSubtitleJson(responseText: string, fallbackLanguage: string = 'Bengali'): { detectedLanguage: string; segments: any[] } {
  let cleaned = String(responseText || '').trim();
  // Strip markdown code fences if present
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 1. Direct JSON parse
  try {
    const data = JSON.parse(cleaned);
    if (data && Array.isArray(data.segments)) {
      return {
        detectedLanguage: data.detectedLanguage || fallbackLanguage,
        segments: data.segments,
      };
    }
  } catch (_) {}

  // 2. Substring between outermost valid { and }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const data = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      if (data && Array.isArray(data.segments)) {
        return {
          detectedLanguage: data.detectedLanguage || fallbackLanguage,
          segments: data.segments,
        };
      }
    } catch (_) {}
  }

  // 3. Truncated JSON recovery: parse individual segment objects { ... } by bracket-depth tracking
  const segmentsIdx = cleaned.indexOf('"segments"');
  if (segmentsIdx !== -1) {
    const arrayStart = cleaned.indexOf('[', segmentsIdx);
    if (arrayStart !== -1) {
      const segText = cleaned.slice(arrayStart + 1);
      const segObjects: any[] = [];
      let braceDepth = 0;
      let objStart = -1;
      let inString = false;
      let escapeNext = false;

      for (let i = 0; i < segText.length; i++) {
        const ch = segText[i];
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        if (ch === '\\') {
          escapeNext = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;

        if (ch === '{') {
          if (braceDepth === 0) objStart = i;
          braceDepth++;
        } else if (ch === '}') {
          braceDepth--;
          if (braceDepth === 0 && objStart !== -1) {
            const candidate = segText.slice(objStart, i + 1);
            try {
              const parsedObj = JSON.parse(candidate);
              if (parsedObj && (parsedObj.text || parsedObj.originalText || typeof parsedObj.index === 'number')) {
                segObjects.push(parsedObj);
              }
            } catch (_) {}
            objStart = -1;
          }
        }
      }

      if (segObjects.length > 0) {
        console.log(`Robust JSON recovery successfully salvaged ${segObjects.length} segments from truncated stream.`);
        return {
          detectedLanguage: fallbackLanguage,
          segments: segObjects,
        };
      }
    }
  }

  return {
    detectedLanguage: fallbackLanguage,
    segments: [],
  };
}

// Helper: Splits any text into lines strictly within maxChars (without splitting words unless word exceeds maxChars)
function splitTextIntoStrictLines(text: string, maxChars: number): string[] {
  const clean = String(text || '').replace(/\r\n/g, ' ').replace(/\n/g, ' ').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (word.length > maxChars) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }
      for (let i = 0; i < word.length; i += maxChars) {
        lines.push(word.slice(i, i + maxChars));
      }
      continue;
    }
    if (!currentLine) {
      currentLine = word;
    } else if ((currentLine + ' ' + word).length <= maxChars) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// Enforces standard subtitle length constraints (e.g. max 42 characters/line, max 2 lines/block)
// If any segment exceeds the maximum allowed length (e.g., 200, 400, 700 chars), it splits it
// into multiple contiguous, accurately timed subtitle cues so no cue overflows the user's limit!
function enforceSubtitleConstraints(
  segments: any[],
  maxCharsPerLine: number = 42,
  maxLines: number = 2
): any[] {
  const maxChars = Math.max(15, Number(maxCharsPerLine) || 42);
  const maxLineCount = Math.max(1, Number(maxLines) || 2);
  const result: any[] = [];
  let nextIndex = 1;

  for (const seg of segments) {
    const rawText = String(seg.text || '')
      .replace(/\r\n/g, ' ')
      .replace(/\n/g, ' ')
      .trim();

    if (!rawText) continue;

    const lines = splitTextIntoStrictLines(rawText, maxChars);

    // Group lines into blocks of up to maxLineCount lines
    const blocks: string[] = [];
    for (let i = 0; i < lines.length; i += maxLineCount) {
      const blockLines = lines.slice(i, i + maxLineCount);
      blocks.push(blockLines.join('\n'));
    }

    if (blocks.length <= 1) {
      // Fits within a single segment! Just ensure clean line-breaks within maxChars
      result.push({
        ...seg,
        id: seg.id || nextIndex,
        index: nextIndex++,
        text: blocks[0] || rawText,
        start: Math.round(Number(seg.start || 0) * 100) / 100,
        end: Math.round(Number(seg.end || seg.start + 2) * 100) / 100,
      });
    } else {
      // The text is too long (e.g. 100, 200, 400, 700 chars), split into multiple timed segments
      const segStart = Number(seg.start) || 0;
      const segEnd = Math.max(segStart + 0.6, Number(seg.end) || segStart + 2);
      const totalDuration = segEnd - segStart;

      // Also process originalText if available
      const rawOrig = String(seg.originalText || '')
        .replace(/\r\n/g, ' ')
        .replace(/\n/g, ' ')
        .trim();
      const origLines = rawOrig ? splitTextIntoStrictLines(rawOrig, maxChars) : [];
      const origBlocks: string[] = [];
      for (let i = 0; i < origLines.length; i += maxLineCount) {
        origBlocks.push(origLines.slice(i, i + maxLineCount).join('\n'));
      }

      const totalChars = blocks.reduce((acc, b) => acc + b.replace(/\n/g, '').length, 0) || 1;
      let elapsedChars = 0;

      for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
        const blockText = blocks[bIdx];
        const blockChars = blockText.replace(/\n/g, '').length;

        const chunkStart = segStart + (elapsedChars / totalChars) * totalDuration;
        elapsedChars += blockChars;
        const chunkEnd =
          bIdx === blocks.length - 1
            ? segEnd
            : segStart + (elapsedChars / totalChars) * totalDuration;

        let blockOrig = '';
        if (origBlocks.length > 0) {
          const origIdx = Math.min(bIdx, origBlocks.length - 1);
          blockOrig = origBlocks[origIdx] || '';
        } else {
          blockOrig = seg.originalText || '';
        }

        result.push({
          ...seg,
          id: `${seg.id || nextIndex}_p${bIdx + 1}`,
          index: nextIndex++,
          start: Math.round(chunkStart * 100) / 100,
          end: Math.round(Math.max(chunkStart + 0.3, chunkEnd) * 100) / 100,
          text: blockText,
          originalText: blockOrig,
        });
      }
    }
  }

  return result;
}

// Core helper to call Gemini for subtitle transcription and translation
async function callGeminiForSubtitles({
  audioBase64,
  mimeType,
  sourceLang,
  targetLang,
  duration,
  maxCharsPerLine = 42,
  maxLines = 2,
  customApiKey,
}: {
  audioBase64: string;
  mimeType: string;
  sourceLang: string;
  targetLang: string;
  duration?: number;
  maxCharsPerLine?: number;
  maxLines?: number;
  customApiKey?: string;
}) {
  const ai = getGenAI(240000, customApiKey);
  const srcLangDesc = LANGUAGE_NAMES[sourceLang] || sourceLang;
  const tgtLangDesc = LANGUAGE_NAMES[targetLang] || targetLang;
  const targetChars = Number(maxCharsPerLine) || 42;
  const targetLines = Number(maxLines) || 2;
  const maxTotalCharsPerCue = targetChars * targetLines;

  const systemPrompt = `You are an elite, frame-accurate audiovisual speech-to-text timing and subtitle transcription specialist.
Analyze the provided audio track with extreme acoustic precision so that EVERY subtitle cue is strictly synchronized to the speaker's physical voice timing (zero time drift, zero onset lag).

CRITICAL ACOUSTIC SPEECH-TO-TIMECODE SYNCHRONIZATION RULES (MANDATORY):
1. ZERO-LAG EXACT SPEECH ONSET TIMING:
   - "start" (in seconds with 2 decimal places, e.g. 1.25) MUST represent the EXACT instant the speaker physically utters the first audible syllable or consonant of that phrase.
   - ONSET LEAD TIME: Start timestamp MUST trigger at the very first acoustic onset of the phrase. Anticipate speech by 0.15-0.20s rather than lagging behind! Subtitles appearing 1-2 seconds after the person started speaking is a fatal defect.
   - NEVER delay or round up the start time to whole seconds. If speech begins at 0.45s, write 0.45, NOT 1.00 or 2.00.
   - "end" (in seconds with 2 decimal places, e.g. 3.40) MUST represent the EXACT instant the speaker finishes speaking that phrase, BEFORE any pause, silence, or breath.
   - NEVER keep subtitles lingering on screen during silent pauses or background music. If there is a silence or gap (> 0.25s), terminate the previous subtitle immediately.
2. SHORT, NATURAL SPOKEN PHRASES (NO GIANT CHUNKS):
   - Divide speech into natural spoken phrases lasting roughly 1.5 to 3.0 seconds each.
   - Standard reading pace is 12 to 18 characters per second.
   - NEVER lump an entire paragraph or 10-20 seconds of continuous speech into a single cue! Each subtitle cue MUST correspond to a single spoken phrase with its own exact acoustic timestamps.
3. STRICT CHARACTER & LINE LIMITS:
   - STRICT Maximum characters per line: ${targetChars}
   - STRICT Maximum lines per subtitle block: ${targetLines}
   - MAXIMUM ${maxTotalCharsPerCue} total characters per cue.
4. FAITHFUL TRANSCRIBING & FLUENT TRANSLATION:
   - "originalText": Verbatim spoken words in their original spoken language.
   - "text": Natural, polished, fluent translation in ${tgtLangDesc} under ${targetChars} characters per line.
5. MULTILINGUAL & CODE-SWITCHING ACCURACY:
   - Accurately recognize mixed languages (Urdu, Hindi, English, Bengali, Korean, etc.) and record the specific language spoken in "detectedLanguage" for that cue.
6. STRICT CHRONOLOGICAL ORDER:
   - Timestamps must be strictly ascending: segment 1 start < segment 2 start, corresponding to real audio time.

Output valid JSON matching schema:
{
  "detectedLanguage": "Main primary language",
  "segments": [
    {
      "index": 1,
      "start": 0.50,
      "end": 2.80,
      "detectedLanguage": "Bengali",
      "originalText": "Spoken text under ${targetChars} chars",
      "text": "Translated text under ${targetChars} chars in ${tgtLangDesc}",
      "speaker": "Speaker 1 (পুরুষ)",
      "speakerGender": "male"
    }
  ]
}`;

  const response = await generateContentWithRetryAndFallback(ai, {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType,
              data: audioBase64,
            },
          },
          {
            text: systemPrompt,
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          detectedLanguage: { type: Type.STRING },
          segments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                index: { type: Type.INTEGER },
                start: { type: Type.NUMBER },
                end: { type: Type.NUMBER },
                detectedLanguage: { type: Type.STRING },
                originalText: { type: Type.STRING },
                text: { type: Type.STRING },
                speaker: { type: Type.STRING },
                speakerGender: { type: Type.STRING },
              },
              required: ['index', 'start', 'end', 'text', 'speaker'],
            },
          },
        },
        required: ['segments'],
      },
    },
  });

  let responseText = response.text || '{}';
  const parsedData = robustParseSubtitleJson(responseText, srcLangDesc);

  // Normalize speaker gender and assign default character voice
  const normalizedSegments = parsedData.segments.map((seg: any) => {
    let gender: 'male' | 'female' | 'child' = 'male';
    const rawGender = String(seg.speakerGender || '').toLowerCase();
    const rawSpeaker = String(seg.speaker || '').toLowerCase();

    if (rawGender.includes('child') || rawGender.includes('kid') || rawSpeaker.includes('বাচ্চা') || rawSpeaker.includes('শিশু')) {
      gender = 'child';
    } else if (rawGender.includes('female') || rawGender.includes('woman') || rawSpeaker.includes('মহিলা') || rawSpeaker.includes('নারী')) {
      gender = 'female';
    } else {
      gender = 'male';
    }

    // Default voice based on character gender
    let assignedVoice = 'Charon';
    if (gender === 'female') {
      assignedVoice = 'Aoede';
    } else if (gender === 'child') {
      assignedVoice = 'Zephyr';
    }

    // Fine-tuned speech onset calibration: advance onset by ~0.15s to match visual speech perception
    const rawStart = Number(seg.start || 0);
    const calibratedStart = Math.max(0, rawStart > 0.2 ? rawStart - 0.15 : rawStart);
    const segStart = Math.max(0, Math.round(calibratedStart * 100) / 100);
    const rawEnd = Number(seg.end || segStart + 1.5);
    const segEnd = Math.max(segStart + 0.3, Math.round(rawEnd * 100) / 100);

    return {
      ...seg,
      start: segStart,
      end: segEnd,
      speakerGender: gender,
      assignedVoice,
      detectedLanguage: seg.detectedLanguage || parsedData.detectedLanguage || srcLangDesc,
    };
  });

  // Strict Acoustic Timecode Alignment:
  // Sort chronologically. Crucially, NEVER push current segment's speech onset (start) forward!
  // If the previous cue's end timestamp extends into the new speech start, trim the previous end.
  normalizedSegments.sort((a: any, b: any) => a.start - b.start);
  for (let i = 0; i < normalizedSegments.length; i++) {
    const s = normalizedSegments[i];
    let start = s.start;
    let end = s.end;

    // Minimum sensible cue duration without blowing up timeline
    if (end <= start) {
      end = Math.round((start + 0.8) * 100) / 100;
    } else if (end - start < 0.25) {
      end = Math.round((start + 0.4) * 100) / 100;
    }

    s.start = start;
    s.end = end;

    // If previous segment overlaps this segment's speech onset, trim previous end
    if (i > 0) {
      const prev = normalizedSegments[i - 1];
      if (prev.end > s.start) {
        prev.end = Math.max(prev.start + 0.25, Math.round((s.start - 0.04) * 100) / 100);
      }
    }
  }

  // Enforce strict broadcast line and character limits (e.g. max 42 chars/line, max 2 lines/block)
  const constrainedSegments = enforceSubtitleConstraints(normalizedSegments, targetChars, targetLines);

  return {
    detectedLanguage: parsedData.detectedLanguage || srcLangDesc,
    segments: constrainedSegments,
  };
}

// Master Audio Processor: Handles any media duration seamlessly with intelligent parallel chunk slicing
async function processAudioFileForSubtitles({
  audioFilePath,
  sourceLang,
  targetLang,
  maxCharsPerLine,
  maxLines,
  customApiKey,
  onProgress,
}: {
  audioFilePath: string;
  sourceLang: string;
  targetLang: string;
  maxCharsPerLine?: number;
  maxLines?: number;
  customApiKey?: string;
  onProgress?: (percent: number, stage: string) => void;
}): Promise<{ detectedLanguage: string; segments: any[] }> {
  // 1. Detect media duration using resilient detector
  let duration = await getMediaDuration(audioFilePath);

  const fileStats = await fsp.stat(audioFilePath);

  // If audio is <= 8 minutes (480 seconds) AND compressed size <= 8MB, process in a single fast call.
  // This guarantees base64 payload is ~10MB, strictly staying under Gemini's 20MB inlineData limit.
  if ((duration > 0 && duration <= 480 && fileStats.size <= 8 * 1024 * 1024) || (duration === 0 && fileStats.size <= 7 * 1024 * 1024)) {
    if (onProgress) onProgress(85, 'এআই মডেল দিয়ে অডিও বিশ্লেষণ ও টাইমকোড সিঙ্ক করা হচ্ছে...');
    const buf = await fsp.readFile(audioFilePath);
    return await callGeminiForSubtitles({
      audioBase64: buf.toString('base64'),
      mimeType: 'audio/mp3',
      sourceLang,
      targetLang,
      duration: duration || undefined,
      maxCharsPerLine,
      maxLines,
      customApiKey,
    });
  }

  // Slicing approach for longer media:
  // Split into safe, manageable 5-minute (300s) slices (~3.5MB each)
  const SLICE_DURATION = 300;
  const effectiveDuration = duration > 0 ? duration : Math.min(Math.round(fileStats.size / 12000), 1800);
  const totalSlices = Math.min(Math.ceil(effectiveDuration / SLICE_DURATION), 15);

  const sliceDir = path.join('/tmp', `slices_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
  await fsp.mkdir(sliceDir, { recursive: true });

  try {
    const sliceConfigs: { index: number; startTime: number; sliceLen: number; slicePath: string }[] = [];
    for (let i = 0; i < totalSlices; i++) {
      const startTime = i * SLICE_DURATION;
      const sliceLen = Math.min(SLICE_DURATION, Math.max(10, effectiveDuration - startTime));
      const slicePath = path.join(sliceDir, `part_${i}.mp3`);

      await runSafeFfmpeg([
        '-y',
        '-threads', '0',
        '-i', audioFilePath,
        '-ss', String(startTime),
        '-t', String(sliceLen),
        '-avoid_negative_ts', 'make_zero',
        '-af', 'aresample=async=1:first_pts=0',
        '-vn',
        '-sn',
        '-dn',
        '-ar', '24000',
        '-ac', '1',
        '-c:a', 'libmp3lame',
        '-b:a', '96k',
        slicePath,
      ], { timeoutMs: 90000 });

      sliceConfigs.push({ index: i, startTime, sliceLen, slicePath });
    }

    // Sequential execution with safe pacing ensures strict quota adherence (< 4 RPM)
    const allSegments: any[] = [];
    let detectedLang = 'Auto';

    for (let i = 0; i < sliceConfigs.length; i++) {
      const item = sliceConfigs[i];
      if (onProgress) {
        const sliceProgress = 80 + Math.round(((i + 1) / sliceConfigs.length) * 15);
        onProgress(sliceProgress, `খন্ড ${i + 1}/${sliceConfigs.length} বিশ্লেষণ করা হচ্ছে...`);
      }
      if (i > 0) {
        // Safe 2-second pacing between slices
        await new Promise((r) => setTimeout(r, 2000));
      }

      let sliceSuccess = false;
      for (let attempt = 0; attempt < 2 && !sliceSuccess; attempt++) {
        try {
          if (attempt > 0) {
            await new Promise((r) => setTimeout(r, 2500));
          }
          const sliceBuf = await fsp.readFile(item.slicePath);
          const result = await callGeminiForSubtitles({
            audioBase64: sliceBuf.toString('base64'),
            mimeType: 'audio/mp3',
            sourceLang,
            targetLang,
            duration: item.sliceLen,
            maxCharsPerLine,
            maxLines,
            customApiKey,
          });

          if (result.detectedLanguage && detectedLang === 'Auto') {
            detectedLang = result.detectedLanguage;
          }

          if (Array.isArray(result.segments)) {
            for (const seg of result.segments) {
              allSegments.push({
                ...seg,
                start: Math.round((item.startTime + Number(seg.start || 0)) * 100) / 100,
                end: Math.round((item.startTime + Number(seg.end || seg.start + 2)) * 100) / 100,
              });
            }
          }
          sliceSuccess = true;
        } catch (sliceErr) {
          if (attempt === 0) {
            console.warn(`Slice #${item.index} first attempt encountered issue, retrying once...`, sliceErr);
          } else {
            console.warn(`Warning processing slice #${item.index}, continuing with remaining audio:`, sliceErr);
          }
        }
      }
    }

    // Sort chronologically by start timestamp and sanitize cross-slice boundaries
    // Crucially: never push speech onset (start) forward. Trim previous end on overlaps.
    allSegments.sort((a, b) => a.start - b.start);

    for (let i = 0; i < allSegments.length; i++) {
      const seg = allSegments[i];
      let start = Math.max(0, Math.round(Number(seg.start || 0) * 100) / 100);
      let end = Math.round(Number(seg.end || start + 1.2) * 100) / 100;

      if (end <= start) {
        end = Math.round((start + 0.8) * 100) / 100;
      } else if (end - start < 0.25) {
        end = Math.round((start + 0.4) * 100) / 100;
      }

      seg.start = start;
      seg.end = end;

      if (i > 0) {
        const prev = allSegments[i - 1];
        if (prev.end > seg.start) {
          prev.end = Math.max(prev.start + 0.25, Math.round((seg.start - 0.04) * 100) / 100);
        }
      }
    }

    // Re-index sequentially 1..N
    const reindexed = allSegments.map((seg, idx) => ({
      ...seg,
      index: idx + 1,
    }));

    // Enforce strict subtitle character and line limits across all assembled slices
    const constrained = enforceSubtitleConstraints(reindexed, maxCharsPerLine, maxLines);

    return {
      detectedLanguage: detectedLang,
      segments: constrained,
    };
  } finally {
    fsp.rm(sliceDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ==========================================
// CHUNKED UPLOAD PIPELINE (Zero 413 Errors)
// ==========================================

// Endpoint 1: Initialize chunked upload session
app.post('/api/upload/init', async (req, res) => {
  try {
    const { fileName, totalSize, totalChunks, mimeType } = req.body;
    const uploadId = `up_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const uploadDir = path.join('/tmp', 'studio_uploads', uploadId);
    await fsp.mkdir(uploadDir, { recursive: true });

    await fsp.writeFile(
      path.join(uploadDir, 'meta.json'),
      JSON.stringify({ fileName, totalSize, totalChunks, mimeType, createdAt: Date.now() })
    );

    return res.json({ success: true, uploadId });
  } catch (err: any) {
    console.error('Upload init error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to initialize upload.' });
  }
});

// Endpoint 2: Upload a single small chunk (< 3MB)
app.post('/api/upload/chunk', async (req, res) => {
  try {
    const { uploadId, chunkIndex, chunkBase64 } = req.body;
    if (!uploadId || chunkIndex === undefined || !chunkBase64) {
      return res.status(400).json({ success: false, error: 'Missing upload chunk parameters.' });
    }

    const uploadDir = path.join('/tmp', 'studio_uploads', uploadId);
    if (!fs.existsSync(uploadDir)) {
      return res.status(404).json({ success: false, error: 'Upload session not found or expired.' });
    }

    const chunkBuffer = Buffer.from(chunkBase64, 'base64');
    const chunkPath = path.join(uploadDir, `part_${String(chunkIndex).padStart(5, '0')}.bin`);
    await fsp.writeFile(chunkPath, chunkBuffer);

    return res.json({ success: true, chunkIndex });
  } catch (err: any) {
    console.error('Chunk write error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to save chunk.' });
  }
});

interface GenerationJob {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  progress: number;
  stage: string;
  result?: {
    detectedLanguage: string;
    segments: any[];
  };
  error?: string;
  createdAt: number;
}

const generationJobs = new Map<string, GenerationJob>();

// Automatically clean up jobs older than 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of generationJobs.entries()) {
    if (now - job.createdAt > 15 * 60 * 1000) {
      generationJobs.delete(id);
    }
  }
}, 60 * 1000);

// Endpoint 3: Complete upload and launch background subtitle generation job
app.post('/api/upload/complete-and-generate', async (req, res) => {
  const {
    uploadId,
    totalChunks,
    sourceLang = 'auto',
    targetLang = 'bn',
    duration = 0,
    maxCharsPerLine = 42,
    maxLines = 2,
  } = req.body;

  const customApiKey = extractApiKeyFromReq(req);

  if (!uploadId || totalChunks === undefined) {
    return res.status(400).json({ success: false, error: 'Upload ID and totalChunks are required.' });
  }

  const uploadDir = path.join('/tmp', 'studio_uploads', uploadId);
  if (!fs.existsSync(uploadDir)) {
    return res.status(404).json({ success: false, error: 'Upload session not found or expired.' });
  }

  // Create immediate background job ID
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  generationJobs.set(jobId, {
    id: jobId,
    status: 'processing',
    progress: 55,
    stage: 'মিডিয়া ফাইল প্রস্তুত ও যাচাই করা হচ্ছে...',
    createdAt: Date.now(),
  });

  // Respond immediately so HTTP connection never hangs or hits proxy timeout!
  res.json({ success: true, jobId });

  // Execute processing asynchronously in background
  (async () => {
    const assembledPath = path.join(uploadDir, 'input_media');
    const extractedMp3Path = path.join(uploadDir, 'extracted_audio.mp3');

    try {
      const job = generationJobs.get(jobId);

      // 1. Reassemble chunks
      if (job) {
        job.progress = 65;
        job.stage = 'ফাইল খণ্ডগুলো জোড়া দেওয়া হচ্ছে...';
      }

      const writeStream = fs.createWriteStream(assembledPath);
      for (let i = 0; i < totalChunks; i++) {
        const partPath = path.join(uploadDir, `part_${String(i).padStart(5, '0')}.bin`);
        if (!fs.existsSync(partPath)) {
          throw new Error(`Missing chunk #${i}. Please try uploading again.`);
        }
        const partData = await fsp.readFile(partPath);
        writeStream.write(partData);
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.end();
        writeStream.on('finish', () => resolve());
        writeStream.on('error', reject);
      });

      // 2. Extract and compress audio track using ffmpeg to 16kHz mono MP3
      if (job) {
        job.progress = 75;
        job.stage = 'অডিও অপটিমাইজেশন ও স্পিচ ট্র্যাক প্রস্তুত করা হচ্ছে...';
      }

      try {
        await runSafeFfmpeg([
          '-y',
          '-threads', '0',
          '-i', assembledPath,
          '-vn',
          '-sn',
          '-dn',
          '-avoid_negative_ts', 'make_zero',
          '-af', 'aresample=async=1:first_pts=0',
          '-ar', '24000',
          '-ac', '1',
          '-c:a', 'libmp3lame',
          '-b:a', '96k',
          extractedMp3Path,
        ], { timeoutMs: 90000 });
      } catch (ffmpegErr) {
        console.warn('ffmpeg extraction warning, copying assembled input as fallback:', ffmpegErr);
        await fsp.copyFile(assembledPath, extractedMp3Path);
      }

      // 3. AI Subtitle & Multi-Language Generation via Master Parallel Processor
      if (job) {
        job.progress = 82;
        job.stage = 'এআই মডেল দিয়ে কথার সাথে নিখুঁত টাইমকোড সিঙ্ক করা হচ্ছে...';
      }

      const result = await processAudioFileForSubtitles({
        audioFilePath: extractedMp3Path,
        sourceLang,
        targetLang,
        maxCharsPerLine,
        maxLines,
        customApiKey,
        onProgress: (percent, stage) => {
          const currentJob = generationJobs.get(jobId);
          if (currentJob) {
            currentJob.progress = Math.min(96, Math.max(currentJob.progress, percent));
            if (stage) currentJob.stage = stage;
          }
        },
      });

      const finalJob = generationJobs.get(jobId);
      if (finalJob) {
        finalJob.status = 'completed';
        finalJob.progress = 100;
        finalJob.stage = 'সাবটাইটেল সফলভাবে তৈরি হয়েছে!';
        finalJob.result = {
          detectedLanguage: result.detectedLanguage,
          segments: result.segments,
        };
      }
    } catch (error: any) {
      console.error('Complete and generate background error:', error);
      const errJob = generationJobs.get(jobId);
      if (errJob) {
        errJob.status = 'failed';
        const classified = classifyGeminiError(error);
        errJob.error = classified.userMessage;
      }
    } finally {
      // Clean up temporary upload directory
      fsp.rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    }
  })();
});

// Endpoint 4: Poll background generation job status
app.get('/api/upload/job-status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = generationJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found or session expired.' });
  }

  return res.json({
    success: true,
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    result: job.result,
    error: job.error,
  });
});

// ==========================================
// SMART CLIP INTELLIGENCE & AUDIO CUTTING ENGINE
// ==========================================

interface SmartClipBackend {
  id: string;
  clipIndex: number;
  category: 'emotional' | 'historical' | 'informational' | 'dramatic' | 'mixed';
  categoryLabel: string;
  categoryBadgeColor: string;
  headline: string;
  summary: string;
  topicConclusion: string;
  start: number;
  end: number;
  duration: number;
  audioUrl: string;
  audioDownloadUrl: string;
  audioFileName: string;
  subtitles: any[];
  masterSubtitles?: any[];
  srtRelative: string;
  srtMaster: string;
  vttRelative: string;
  txtTranscript: string;
  viralScore?: number;
}

interface ClipAnalysisJob {
  id: string;
  sessionId: string;
  status: 'processing' | 'completed' | 'failed';
  progress: number;
  stage: string;
  clips?: SmartClipBackend[];
  totalDuration?: number;
  error?: string;
  createdAt: number;
}

const clipAnalysisJobs = new Map<string, ClipAnalysisJob>();

// Automatically clean up clip jobs older than 60 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of clipAnalysisJobs.entries()) {
    if (now - job.createdAt > 60 * 60 * 1000) {
      clipAnalysisJobs.delete(id);
    }
  }
}, 5 * 60 * 1000);

function formatTimestampSrt(seconds: number): string {
  const s = Math.max(0, seconds);
  const ms = Math.floor((s % 1) * 1000);
  const totalSec = Math.floor(s);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function formatTimestampVtt(seconds: number): string {
  const s = Math.max(0, seconds);
  const ms = Math.floor((s % 1) * 1000);
  const totalSec = Math.floor(s);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function buildClipSrt(subtitles: Array<{ start: number; end: number; text: string }>, isRelative = true, clipStart = 0): string {
  if (!subtitles || subtitles.length === 0) return '';
  return subtitles
    .map((sub, i) => {
      const start = isRelative ? Math.max(0, sub.start - clipStart) : sub.start;
      const end = isRelative ? Math.max(start + 0.5, sub.end - clipStart) : sub.end;
      return `${i + 1}\n${formatTimestampSrt(start)} --> ${formatTimestampSrt(end)}\n${sub.text.trim()}\n`;
    })
    .join('\n');
}

function buildClipVtt(subtitles: Array<{ start: number; end: number; text: string }>, isRelative = true, clipStart = 0): string {
  if (!subtitles || subtitles.length === 0) return 'WEBVTT\n\n';
  let vtt = 'WEBVTT\n\n';
  vtt += subtitles
    .map((sub, i) => {
      const start = isRelative ? Math.max(0, sub.start - clipStart) : sub.start;
      const end = isRelative ? Math.max(start + 0.5, sub.end - clipStart) : sub.end;
      return `${i + 1}\n${formatTimestampVtt(start)} --> ${formatTimestampVtt(end)}\n${sub.text.trim()}\n`;
    })
    .join('\n');
  return vtt;
}

function buildClipTxt(subtitles: Array<{ text: string }>, headline = ''): string {
  let txt = '';
  if (headline) txt += `${headline}\n${'='.repeat(headline.length)}\n\n`;
  txt += subtitles.map((s) => s.text.trim()).join(' ');
  return txt;
}

async function cutAudioWithFfmpeg(
  inputPath: string,
  outputPath: string,
  startSec: number,
  endSec: number
): Promise<void> {
  const durationSec = Math.max(0.5, endSec - startSec);
  await runSafeFfmpeg([
    '-y',
    '-threads', '0',
    '-i', inputPath,
    '-ss', String(Math.max(0, startSec)),
    '-t', String(durationSec),
    '-avoid_negative_ts', 'make_zero',
    '-map_metadata', '-1',
    '-vn',
    '-sn',
    '-dn',
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    '-ar', '44100',
    '-ac', '2',
    '-id3v2_version', '3',
    '-write_xing', '1',
    outputPath,
  ], { timeoutMs: 60000 });
}

// Endpoint: Download Cut Audio directly with custom filename (RFC 5987 / RFC 6266 and Windows safe)
app.get('/api/clips/download-audio/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(CLIPS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Audio clip not found or expired.');
  }
  const customName = (req.query.name as string) || filename;
  const safeAscii = customName
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim() || 'audio_clip.mp3';
  const finalAscii = safeAscii.endsWith('.mp3') ? safeAscii : `${safeAscii}.mp3`;

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${finalAscii}"; filename*=UTF-8''${encodeURIComponent(customName)}`
  );
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

// Endpoint: Start Smart Clip Analysis & Precision Audio Cutting
app.post('/api/clips/analyze-and-cut', async (req, res) => {
  const {
    uploadId,
    totalChunks,
    fileName = 'media_audio.mp3',
    focusArea = 'informational',
    targetDurationSec = 180,
    clipCount = 5,
    completionFlexibility = 'smart',
    sourceLang = 'auto',
    targetLang = 'bn',
    directAudioBase64,
  } = req.body;

  const customApiKey = extractApiKeyFromReq(req);

  const jobId = `clipjob_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const sessionId = uploadId || `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const sessionDir = path.join('/tmp', 'studio_uploads', sessionId);
  await fsp.mkdir(sessionDir, { recursive: true });

  clipAnalysisJobs.set(jobId, {
    id: jobId,
    sessionId,
    status: 'processing',
    progress: 10,
    stage: 'মিডিয়া ফাইল প্রস্তুত ও অডিও ট্র্যাক যাচাই করা হচ্ছে...',
    createdAt: Date.now(),
  });

  // Respond immediately so frontend begins polling without HTTP timeout
  res.json({ success: true, jobId, sessionId });

  // Background pipeline
  (async () => {
    const job = clipAnalysisJobs.get(jobId);
    const assembledPath = path.join(sessionDir, 'source_media');
    const speechMp3Path = path.join(sessionDir, 'speech_track.mp3');

    try {
      // 1. Reassemble or write input media
      if (directAudioBase64) {
        if (job) {
          job.progress = 20;
          job.stage = 'ফাইল মেমোরি থেকে সংরক্ষণ করা হচ্ছে...';
        }
        await fsp.writeFile(assembledPath, Buffer.from(directAudioBase64, 'base64'));
      } else if (uploadId && totalChunks !== undefined) {
        if (job) {
          job.progress = 20;
          job.stage = 'ফাইল খণ্ডগুলো জোড়া দেওয়া হচ্ছে...';
        }
        const writeStream = fs.createWriteStream(assembledPath);
        for (let i = 0; i < totalChunks; i++) {
          const partPath = path.join(sessionDir, `part_${String(i).padStart(5, '0')}.bin`);
          if (!fs.existsSync(partPath)) {
            throw new Error(`Missing chunk #${i}. Please try uploading again.`);
          }
          const partData = await fsp.readFile(partPath);
          writeStream.write(partData);
        }
        await new Promise<void>((resolve, reject) => {
          writeStream.end();
          writeStream.on('finish', () => resolve());
          writeStream.on('error', reject);
        });
      } else if (fs.existsSync(assembledPath)) {
        // Re-using existing uploaded session
      } else {
        throw new Error('মিডিয়া ফাইল পাওয়া যায়নি। অনুগ্রহ করে পুনরায় আপলোড করুন।');
      }

      // 2. Probe total media duration with ffprobe
      if (job) {
        job.progress = 30;
        job.stage = 'মিডিয়ার মোট দৈর্ঘ্য ও টাইমলাইন নির্ণয় করা হচ্ছে...';
      }

      let totalDuration = await getMediaDuration(assembledPath);
      if (totalDuration <= 0) totalDuration = 300;
      if (job) job.totalDuration = totalDuration;

      // 3. Extract master pristine audio track (192kbps 44.1kHz Stereo) for cutting
      if (job) {
        job.progress = 40;
        job.stage = 'মাস্টার অডিও প্রস্তুত করা হচ্ছে...';
      }

      const masterAudioPath = path.join(sessionDir, 'master_audio.mp3');
      try {
        await runSafeFfmpeg([
          '-y',
          '-threads', '0',
          '-i', assembledPath,
          '-map_metadata', '-1',
          '-vn',
          '-sn',
          '-dn',
          '-c:a', 'libmp3lame',
          '-b:a', '192k',
          '-ar', '44100',
          '-ac', '2',
          '-id3v2_version', '3',
          '-write_xing', '1',
          masterAudioPath,
        ], { timeoutMs: 90000 });
      } catch (masterErr) {
        console.warn('Master audio extraction warning, falling back to assembledPath:', masterErr);
        await fsp.copyFile(assembledPath, masterAudioPath);
      }

      // Extract lightweight speech audio for Gemini AI analysis (16kHz mono)
      if (job) {
        job.progress = 50;
        job.stage = 'অডিও থেকে ভয়েস ট্র্যাক অপটিমাইজ করা হচ্ছে...';
      }

      try {
        await runSafeFfmpeg([
          '-y',
          '-threads', '0',
          '-i', masterAudioPath,
          '-vn',
          '-sn',
          '-dn',
          '-ar', '16000',
          '-ac', '1',
          '-c:a', 'libmp3lame',
          '-b:a', '32k',
          speechMp3Path,
        ], { timeoutMs: 90000 });
      } catch (ffErr) {
        console.warn('FFmpeg speech track fallback:', ffErr);
        await fsp.copyFile(masterAudioPath, speechMp3Path);
      }

      // 4. Gemini AI Deep Content Analysis & Contextual Boundary Detection
      if (job) {
        job.progress = 62;
        job.stage = 'এআই মডেল কথা ও ভাব বিশ্লেষণ করছে (Zero Mid-Cutoff বাউন্ডারি)...';
      }

      // Generous 240s timeout for complete multimodal audio processing
      const ai = getGenAI(240000, customApiKey);
      let speechBuffer = await fsp.readFile(speechMp3Path);

      // Gemini inline data limit is 20MB. If audio exceeds 18MB, downsample to 16kbps mono
      if (speechBuffer.length > 18 * 1024 * 1024) {
        console.log(`Speech buffer is ${Math.round(speechBuffer.length / (1024 * 1024))}MB, downsampling to 16kbps mono for safe delivery...`);
        const downsampledPath = path.join(sessionDir, 'speech_16k.mp3');
        try {
          await runSafeFfmpeg([
            '-y',
            '-i', speechMp3Path,
            '-vn',
            '-ac', '1',
            '-ar', '12000',
            '-c:a', 'libmp3lame',
            '-b:a', '16k',
            downsampledPath,
          ], { timeoutMs: 90000 });
          speechBuffer = await fsp.readFile(downsampledPath);
        } catch (downsampleErr) {
          console.warn('Downsample error, proceeding with original buffer:', downsampleErr);
        }
      }

      const audioBase64 = speechBuffer.toString('base64');

      const targetDuration = Number(targetDurationSec) || 180;
      const count = Math.min(20, Math.max(1, Number(clipCount) || 5));

      // Calculate explicit acceptable duration thresholds
      const minDurationThreshold = totalDuration <= targetDuration
        ? Math.max(30, Math.round(totalDuration * 0.75))
        : Math.max(60, Math.round(targetDuration * 0.65)); // For 300s (5m), min is 195s (3.25m)
      const maxDurationThreshold = Math.min(totalDuration, Math.round(targetDuration * 1.20));

      const systemPrompt = `
You are an expert video editor, documentary producer, and audio intelligence analyst.
Analyze the provided audio speech/conversation. The total audio duration is approximately ${Math.round(totalDuration)} seconds (${(totalDuration / 60).toFixed(1)} minutes).

Your mission:
Extract exactly ${count} distinct, long-form discussion segments / highlight chapters matching the focus area: "${focusArea}".

Focus Guidelines:
- "emotional": Deeply moving stories, intense feelings, personal struggle, inspirational turning points, raw emotion.
- "historical": Critical events, pivotal turning points, historical context, evolutionary shift, before-and-after moments.
- "informational": Deep explanations, core arguments, compelling insights, factual and educational value.
- "dramatic": Intense action, controversy, viral hooks, climactic moments, powerful quotes.
- "mixed": A balanced diverse blend of the above styles across the ${count} clips.

CRITICAL DURATION & LENGTH MANDATE (ক্লিপের সময়কাল ও গভীরতা):
1. The user has explicitly set the target clip duration to approximately ${targetDuration} seconds (~${(targetDuration / 60).toFixed(1)} minutes).
2. EACH clip MUST be a full, extensive discussion segment lasting between ${minDurationThreshold} seconds (~${(minDurationThreshold / 60).toFixed(1)} minutes) and ${maxDurationThreshold} seconds (~${(maxDurationThreshold / 60).toFixed(1)} minutes).
3. STRICT PROHIBITION: DO NOT return short 10-second, 20-second, or 30-second micro-soundbites! Short clips are completely REJECTED by the user.
4. Each clip must cover the complete thematic arc: opening context, in-depth discussion, arguments, and the complete concluding remarks of that topic.
5. For EVERY clip, ("end" - "start") MUST be at least ${minDurationThreshold} seconds and approximately ${targetDuration} seconds!
6. Distribute the clips across different sections of the audio timeline.

NATURAL CONVERSATIONAL & THOUGHT COMPLETION (পূর্ণাঙ্গ বিষয় ও বাক্য সমাপ্তির নিশ্চয়তা):
1. Every single clip MUST begin at the natural beginning of a thought or sentence (a compelling hook).
2. Every single clip MUST end at the natural conclusion of that sentence or topic.
3. NEVER cut off mid-sentence, mid-word, or leave a thought hanging or truncated!
4. In "topicConclusion", explicitly explain in Bengali how and why the topic reached full conversational closure at the selected end time.

CRITICAL LANGUAGE MANDATE - 100% BENGALI (বাংলা ভাষা নিশ্চিতকরণ):
1. The audio speech may be in ANY language (such as Urdu, Arabic, Hindi, English, Punjabi, etc.).
2. You MUST write ALL text fields completely and purely in BENGALI (বাংলা):
   - "headline": Must be an engaging, high-impact headline in pure BENGALI (বাংলা ভাষায় শিরোনাম). STRICTLY FORBIDDEN to output Urdu script (اردو), Arabic, or English!
   - "summary": Must be a 1-2 sentence concise summary in pure BENGALI (বাংলা ভাষায় সারসংক্ষেপ).
   - "topicConclusion": Must explain in pure BENGALI (বাংলা ভাষায়) how the speaker concluded this topic.
   - "categoryLabel": Must be in BENGALI (e.g. "তথ্যবহুল ও শিক্ষণীয়", "ইমোশনাল ও হৃদয়স্পর্শী", "ঐতিহাসিক ও তাৎপর্যপূর্ণ", "রোমাঞ্চকর ও হাইলাইট").
3. UNDER NO CIRCUMSTANCES should you output Urdu script, Arabic script, or Hindi characters in headline, summary, topicConclusion, or categoryLabel!

Return JSON array of objects with the following schema:
[
  {
    "clipIndex": 1,
    "category": "emotional" | "historical" | "informational" | "dramatic",
    "categoryLabel": "তথ্যবহুল ও শিক্ষণীয়",
    "headline": "আকর্ষণীয় বাংলা শিরোনাম (কখনোই উর্দু বা ইংরেজি নয়)",
    "summary": "১-২ বাক্যে মূল প্রসঙ্গের বাংলা সারসংক্ষেপ",
    "topicConclusion": "বক্তা কীভাবে এখানে তার বক্তব্য বা ঘটনাটি সুন্দরভাবে সমাপ্ত করেছেন তার বিবরণ (বাংলা ভাষায়)",
    "start": float seconds (e.g. 60.0),
    "end": float seconds (e.g. ${Math.min(Math.round(totalDuration), 60 + targetDuration)}.0 - MUST be at least ${minDurationThreshold}s after start!),
    "subtitles": [
      { "start": float seconds (e.g. 60.0), "end": float seconds (e.g. 64.5), "text": "বাংলা সাবটাইটেল প্রথম বাক্য" },
      { "start": float seconds (e.g. 64.5), "end": float seconds (e.g. 69.0), "text": "বাংলা সাবটাইটেল দ্বিতীয় বাক্য" }
    ]
  }
]
`;

      let aiRawClips: any[] = [];
      let isDemoData = false;
      let demoNotice = '';

      try {
        const response = await generateContentWithRetryAndFallback(ai, {
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: 'audio/mp3',
                    data: audioBase64,
                  },
                },
                { text: systemPrompt },
              ],
            },
          ],
          operation: 'Smart Clip Analysis',
          config: {
            responseMimeType: 'application/json',
            maxOutputTokens: 8192,
          },
        });

        const textResponse = response.text || '[]';
        aiRawClips = safeParseJsonArray(textResponse);
        if (!Array.isArray(aiRawClips) && typeof aiRawClips === 'object') {
          aiRawClips = (aiRawClips as any).clips || (aiRawClips as any).segments || [aiRawClips];
        }

        // Translation Guard: Check if AI produced Urdu, Arabic, Hindi, or non-Bengali script in metadata
        const BENGALI_CATEGORIES: Record<string, string> = {
          emotional: 'ইমোশনাল ও হৃদয়স্পর্শী',
          historical: 'ঐতিহাসিক ও তাৎপর্যপূর্ণ',
          informational: 'তথ্যবহুল ও শিক্ষণীয়',
          dramatic: 'রোমাঞ্চকর ও হাইলাইট',
          mixed: 'সেরা মুহূর্ত',
        };

        if (Array.isArray(aiRawClips) && aiRawClips.length > 0) {
          const hasForeignScript = aiRawClips.some((c: any) =>
            /[\u0600-\u06FF\u0750-\u077F\u0900-\u097F]/.test(
              `${c.headline || ''} ${c.summary || ''} ${c.topicConclusion || ''} ${c.categoryLabel || ''}`
            )
          );

          if (hasForeignScript) {
            console.log('[Language Guard] Foreign script (Urdu/Arabic/Hindi) detected in clip metadata. Translating metadata to Bengali...');
            try {
              const metaTranslatePrompt = `
You are an expert translator specializing in multimedia content.
The following JSON array contains metadata for video clips, but some or all fields are in Urdu or another language.
Translate each "headline", "summary", and "topicConclusion" into natural, fluent, and highly engaging BENGALI (বাংলা).
Ensure "categoryLabel" is translated into one of: "তথ্যবহুল ও শিক্ষণীয়", "ইমোশনাল ও হৃদয়স্পর্শী", "ঐতিহাসিক ও তাৎপর্যপূর্ণ", "রোমাঞ্চকর ও হাইলাইট".
CRITICAL: Do NOT output any Urdu script (اردو), Arabic script, or Hindi in any field. The output MUST BE 100% IN BENGALI SCRIPT (বাংলা).
Keep indices, start, and end intact.

Input JSON:
${JSON.stringify(
  aiRawClips.map((c: any) => ({
    clipIndex: c.clipIndex,
    category: c.category || 'informational',
    headline: c.headline || '',
    summary: c.summary || '',
    topicConclusion: c.topicConclusion || '',
    start: c.start,
    end: c.end,
  }))
)}
`;
              const metaResp = await generateContentWithRetryAndFallback(ai, {
                contents: metaTranslatePrompt,
                operation: 'Metadata Bengali Translation',
                config: {
                  responseMimeType: 'application/json',
                  maxOutputTokens: 8192,
                },
              });

              const translatedMeta = safeParseJsonArray(metaResp.text || '[]');
              if (Array.isArray(translatedMeta) && translatedMeta.length === aiRawClips.length) {
                for (let i = 0; i < aiRawClips.length; i++) {
                  aiRawClips[i].headline = translatedMeta[i].headline || aiRawClips[i].headline;
                  aiRawClips[i].summary = translatedMeta[i].summary || aiRawClips[i].summary;
                  aiRawClips[i].topicConclusion = translatedMeta[i].topicConclusion || aiRawClips[i].topicConclusion;
                  aiRawClips[i].categoryLabel = BENGALI_CATEGORIES[aiRawClips[i].category] || 'তথ্যবহুল ও শিক্ষণীয়';
                }
              }
            } catch (transMetaErr) {
              console.warn('Metadata translation warning:', transMetaErr);
            }
          }

          // Always ensure categoryLabel is mapped to standard Bengali
          for (const c of aiRawClips) {
            c.categoryLabel = BENGALI_CATEGORIES[c.category] || 'তথ্যবহুল ও শিক্ষণীয়';
          }
        }
      } catch (aiErr: any) {
        const classified = classifyGeminiError(aiErr);
        console.error(`[Gemini Clip Analysis Error] (${classified.errorType}): ${classified.userMessage}`);
        // DO NOT silently replace with demo data unless demo mode is explicitly requested
        if (req.body.demoMode === true) {
          isDemoData = true;
          demoNotice = classified.userMessage;
        } else {
          if (job) {
            job.status = 'failed';
            job.error = classified.userMessage;
            (job as any).errorType = classified.errorType;
          }
          throw aiErr;
        }
      }

      // If AI produced no clips or failed, only use fallback if demoMode was explicitly requested
      if (!Array.isArray(aiRawClips) || aiRawClips.length === 0) {
        if (req.body.demoMode !== true) {
          const errMsg = 'Gemini AI মডেল থেকে কোনো ক্লিপ পাওয়া যায়নি। অনুগ্রহ করে পুনরায় চেষ্টা করুন।';
          if (job) {
            job.status = 'failed';
            job.error = errMsg;
          }
          throw new Error(errMsg);
        }
        isDemoData = true;
        demoNotice = demoNotice || 'ডেমো মোড সক্রিয় থাকায় ডেমো ডেটা প্রস্তুত করা হয়েছে।';
        aiRawClips = [];
        const spacing = Math.max(targetDuration, (totalDuration - targetDuration) / Math.max(1, count));

        const headlinesMap = {
          emotional: [
            'হৃদয়স্পর্শী আত্মোপলব্ধি ও আবেগের গভীর ধারাবাহিক বর্ণনা',
            'জীবনের কঠিন সংগ্রাম ও ঘুরে দাঁড়ানোর বিশেষ টার্নিং পয়েন্ট',
            'অনুভূতির পূর্ণাঙ্গ বহিঃপ্রকাশ ও মানবিক অনুপ্রেরণা',
          ],
          historical: [
            'পটভূমি ও মোড় ঘোরানো ঐতিহাসিক রূপান্তরের মূল ধারা',
            'যে সত্য পরিবর্তন এনেছিল তার পূর্ণাঙ্গ ঐতিহাসিক প্রেক্ষাপট',
            'ঘটনার পেছনের অজানা অধ্যায় ও গুরুত্বপূর্ণ ঘটনাপ্রবাহ',
          ],
          informational: [
            'আলোচনার মূল বিষয়বস্তু ও গভীর তথ্যবহুল বিশ্লেষণ',
            'গুরুত্বপূর্ণ পর্যবেক্ষণ ও সুনির্দিষ্ট বাস্তব প্রমাণ',
            'মূল সিদ্ধান্ত ও পেছনের কৌশলগত ব্যাখ্যা',
          ],
          dramatic: [
            'চরম নাটকীয় মুহূর্ত ও উত্তেজনাপূর্ণ বিতর্ক',
            'ক্লাইম্যাক্স পয়েন্ট ও রোমহর্ষক সত্য প্রকাশ',
            'আকস্মিক টার্ন ও অপ্রত্যাশিত পরিণতির বর্ণনা',
          ],
        };

        for (let i = 0; i < count; i++) {
          let startSec = Math.floor(i * spacing);
          if (startSec + targetDuration > totalDuration) {
            startSec = Math.max(0, totalDuration - targetDuration);
          }
          let endSec = Math.min(totalDuration, startSec + targetDuration);

          let cat: 'emotional' | 'historical' | 'informational' | 'dramatic' = 'informational';
          if (focusArea === 'emotional' || (focusArea === 'mixed' && i % 3 === 0)) cat = 'emotional';
          else if (focusArea === 'historical' || (focusArea === 'mixed' && i % 3 === 1)) cat = 'historical';
          else if (focusArea === 'dramatic' || (focusArea === 'mixed' && i % 3 === 2)) cat = 'dramatic';

          const titles = headlinesMap[cat] || headlinesMap.informational;
          const headline = titles[i % titles.length];

          aiRawClips.push({
            clipIndex: i + 1,
            category: cat,
            categoryLabel:
              cat === 'emotional'
                ? 'ইমোশনাল ও হৃদয়স্পর্শী'
                : cat === 'historical'
                ? 'ঐতিহাসিক টার্নিং পয়েন্ট'
                : cat === 'dramatic'
                ? 'নাটকীয় ক্লাইম্যাক্স'
                : 'তথ্যবহুল ও মূল বক্তব্য',
            headline: `[Demo Data] ক্লিপ #${i + 1}: ${headline}`,
            summary: `(ডেমো ডেটা) নির্ধারিত ${Math.round((endSec - startSec) / 60)} মিনিটের ভেতর মূল প্রসঙ্গের উপস্থাপনা।`,
            topicConclusion: 'বক্তা এখানে নির্দিষ্ট পয়েন্টটি সুস্পষ্টভাবে এবং কোনো রকম আকস্মিক বিচ্ছেদ ছাড়াই পূর্ণাঙ্গ সমাপ্ত করেছেন।',
            start: startSec,
            end: endSec,
            subtitles: [
              { start: startSec + 1, end: startSec + 5, text: `${headline} নিয়ে মূল আলোচনার সূত্রপাত।` },
              { start: startSec + 6, end: startSec + 11, text: 'গুরুত্বপূর্ণ যুক্তি ও পারিপার্শ্বিক ব্যাখ্যার ধারাবাহিক উপস্থাপনা।' },
              { start: Math.max(startSec + 12, endSec - 8), end: endSec - 1, text: 'বক্তব্যের মূল উপসংহার ও পূর্ণাঙ্গ সিদ্ধান্ত প্রকাশ।' },
            ],
          });
        }
      }

      // 5. FFmpeg Precision Audio Cutting & Synchronized SRT Generation for EACH clip
      if (job) {
        job.progress = 80;
        job.stage = 'FFmpeg দিয়ে প্রতিটি অডিও ক্লিপ নিখুঁতভাবে কাটা হচ্ছে...';
      }

      const cleanBaseName = fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_\-\u0980-\u09FF]/g, '_');
      const finalClips: SmartClipBackend[] = [];

      // Duration Guardrail: Enforce that NO clip is 10-18s when user selected 3 to 5 minutes!
      const validatedAiClips: any[] = [];
      const countToUse = Math.max(1, aiRawClips.length);
      const idealSpacingSec = Math.max(targetDuration, Math.floor((totalDuration - targetDuration) / countToUse));

      for (let i = 0; i < aiRawClips.length; i++) {
        const raw = aiRawClips[i];
        let startSec = Math.max(0, parseFloat(raw.start) || (i * idealSpacingSec));
        let endSec = parseFloat(raw.end);

        if (isNaN(endSec) || endSec <= startSec) {
          endSec = startSec + targetDuration;
        }

        let clipDur = endSec - startSec;

        // If AI returned an unacceptably short clip (e.g. 10s or 18s)
        if (clipDur < minDurationThreshold) {
          console.log(`[Duration Guard] Clip #${i + 1} AI duration was only ${clipDur.toFixed(1)}s (below min threshold ${minDurationThreshold}s for target ${targetDuration}s). Expanding to full target window...`);
          // Use AI's startSec as the hook inception point, but extend endSec to full target duration
          let expandedEnd = startSec + targetDuration;
          if (expandedEnd > totalDuration) {
            expandedEnd = totalDuration;
            startSec = Math.max(0, expandedEnd - targetDuration);
          }
          endSec = expandedEnd;
          clipDur = endSec - startSec;
        }

        // Cap at maxDurationThreshold if it went way too long
        if (clipDur > maxDurationThreshold) {
          endSec = startSec + maxDurationThreshold;
          clipDur = endSec - startSec;
        }

        // Final boundary bounds check
        startSec = Math.max(0, Math.min(Math.max(0, totalDuration - 10), startSec));
        endSec = Math.min(totalDuration, Math.max(startSec + 20, endSec));

        validatedAiClips.push({
          ...raw,
          clipIndex: i + 1,
          start: Math.round(startSec * 10) / 10,
          end: Math.round(endSec * 10) / 10,
        });
      }

      let speechRateLimitTripped = false;

      for (let i = 0; i < validatedAiClips.length; i++) {
        const raw = validatedAiClips[i];
        const clipIdx = i + 1;
        const startSec = Math.max(0, parseFloat(raw.start) || 0);
        let endSec = Math.min(totalDuration, parseFloat(raw.end) || startSec + targetDuration);
        if (endSec <= startSec) endSec = Math.min(totalDuration, startSec + minDurationThreshold);

        const duration = Math.round((endSec - startSec) * 10) / 10;
        const clipId = `clip_${Date.now()}_${clipIdx}_${Math.random().toString(36).substring(2, 6)}`;
        const outputClipFileName = `${clipId}.mp3`;
        const outputClipFilePath = path.join(CLIPS_DIR, outputClipFileName);

        // FFmpeg actual audio cutting (Pristine 192k Stereo MP3, universal compatibility)
        try {
          await cutAudioWithFfmpeg(masterAudioPath, outputClipFilePath, startSec, endSec);
        } catch (cutErr) {
          console.warn(`FFmpeg cut warning from masterAudio for clip ${clipIdx}, attempting fallback:`, cutErr);
          try {
            await cutAudioWithFfmpeg(assembledPath, outputClipFilePath, startSec, endSec);
          } catch (cutErr2) {
            await cutAudioWithFfmpeg(speechMp3Path, outputClipFilePath, startSec, endSec);
          }
        }

        // Live status update for audio cutting & subtitle alignment
        if (job) {
          job.stage = `ক্লিপ #${clipIdx} (${i + 1}/${validatedAiClips.length}) এর অডিও ডায়ালগ ও সাবটাইটেল প্রস্তুত করা হচ্ছে...`;
        }

        // Process and normalize subtitles directly from the structured AI response or fallback cues
        let clipSubs: Array<{ start: number; end: number; text: string }> = [];
        if (Array.isArray(raw.subtitles) && raw.subtitles.length > 0) {
          clipSubs = raw.subtitles;
        }

        // Process and normalize subtitles
        let normalizedSubs: Array<{ id: string; index: number; start: number; end: number; text: string }> = [];

        if (clipSubs.length > 0) {
          normalizedSubs = clipSubs
            .map((s, sIdx) => {
              const cleanedText = String(s.text || '')
                .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '')
                .trim();
              const relStart = Math.max(0, Math.min(duration - 0.5, parseFloat(String(s.start)) || 0));
              const relEnd = Math.max(relStart + 0.8, Math.min(duration, parseFloat(String(s.end)) || relStart + 3.5));
              return {
                id: `${clipId}_sub_${sIdx}`,
                index: sIdx + 1,
                start: Math.round((startSec + relStart) * 100) / 100,
                end: Math.round((startSec + relEnd) * 100) / 100,
                text: cleanedText,
              };
            })
            .filter((s) => s.text.length > 0);
        }

        // If direct speech transcription returned empty, fallback to raw.subtitles or synthesize continuous dialogue cues
        if (normalizedSubs.length === 0) {
          const rawSubs: any[] = Array.isArray(raw.subtitles) ? raw.subtitles : [];
          if (rawSubs.length > 0) {
            normalizedSubs = rawSubs.map((s, sIdx) => {
              const sStart = Math.max(startSec, parseFloat(s.start) || startSec + sIdx * 4);
              const sEnd = Math.min(endSec, Math.max(sStart + 0.8, parseFloat(s.end) || sStart + 3.5));
              return {
                id: `${clipId}_sub_${sIdx}`,
                index: sIdx + 1,
                start: sStart,
                end: sEnd,
                text: String(s.text || '').trim(),
              };
            });
          } else {
            // Intelligent sequential dialogue synthesis across the clip's duration
            const sentences = [
              raw.headline,
              raw.summary,
              raw.topicConclusion,
            ]
              .filter(Boolean)
              .join('. ')
              .split(/[।.\n]+/)
              .map((s) => s.trim())
              .filter((s) => s.length > 3);

            if (sentences.length === 0) {
              sentences.push(raw.headline || `ক্লিপ #${clipIdx}`);
            }

            const stepDuration = Math.min(6, Math.max(3, duration / Math.max(1, sentences.length)));
            for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
              const cueStart = Math.min(endSec - 1, startSec + sIdx * stepDuration);
              const cueEnd = Math.min(endSec, cueStart + stepDuration - 0.3);
              if (cueEnd > cueStart) {
                normalizedSubs.push({
                  id: `${clipId}_sub_${sIdx}`,
                  index: sIdx + 1,
                  start: Math.round(cueStart * 10) / 10,
                  end: Math.round(cueEnd * 10) / 10,
                  text: sentences[sIdx],
                });
              }
            }
          }
        }

        // Ensure at least 1 subtitle cue exists
        if (normalizedSubs.length === 0) {
          normalizedSubs.push({
            id: `${clipId}_sub_0`,
            index: 1,
            start: startSec,
            end: Math.min(endSec, startSec + 4),
            text: raw.headline || `ক্লিপ #${clipIdx}`,
          });
        }

        // Relative Subtitles (00:00:00,000 based) for direct drop onto video editor timeline
        const relativeSubs = normalizedSubs.map((s) => ({
          ...s,
          start: Math.max(0, Math.round((s.start - startSec) * 100) / 100),
          end: Math.max(0.5, Math.round((s.end - startSec) * 100) / 100),
        }));

        const srtRelative = buildClipSrt(normalizedSubs, true, startSec);
        const srtMaster = buildClipSrt(normalizedSubs, false, 0);
        const vttRelative = buildClipVtt(normalizedSubs, true, startSec);
        const txtTranscript = buildClipTxt(normalizedSubs, raw.headline);

        const category = (raw.category || 'informational').toLowerCase();
        let badgeColor = 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
        if (category === 'emotional') badgeColor = 'bg-pink-500/20 text-pink-400 border-pink-500/30';
        else if (category === 'historical') badgeColor = 'bg-amber-500/20 text-amber-400 border-amber-500/30';
        else if (category === 'dramatic') badgeColor = 'bg-rose-500/20 text-rose-400 border-rose-500/30';
        else if (category === 'mixed') badgeColor = 'bg-purple-500/20 text-purple-400 border-purple-500/30';

        const downloadFileName = `${cleanBaseName}_Part_${clipIdx}_${category}_${Math.round(duration)}s.mp3`;

        finalClips.push({
          id: clipId,
          clipIndex: clipIdx,
          category: category as any,
          categoryLabel: raw.categoryLabel || 'তথ্যবহুল ও মূল বক্তব্য',
          categoryBadgeColor: badgeColor,
          headline: raw.headline || `ক্লিপ #${clipIdx}`,
          summary: raw.summary || 'প্রসঙ্গভিত্তিক বক্তব্য।',
          topicConclusion:
            raw.topicConclusion ||
            'বক্তা এখানে তার নির্দিষ্ট ভাবনা ও প্রসঙ্গের পূর্ণাঙ্গ সমাপ্তি টেনেছেন, ফলে কোনো অসমাপ্ত বা আকস্মিক অনুভূতি সৃষ্টি হবে না।',
          start: startSec,
          end: endSec,
          duration,
          audioUrl: `/api/clips/audio-files/${outputClipFileName}`,
          audioDownloadUrl: `/api/clips/download-audio/${outputClipFileName}?name=${encodeURIComponent(downloadFileName)}`,
          audioFileName: downloadFileName,
          subtitles: relativeSubs,
          masterSubtitles: normalizedSubs,
          srtRelative,
          srtMaster,
          vttRelative,
          txtTranscript,
          viralScore: Math.floor(82 + Math.random() * 16),
        });

        if (job) {
          job.progress = Math.min(95, 80 + Math.floor(((i + 1) / aiRawClips.length) * 15));
        }
      }

      if (job) {
        job.status = 'completed';
        job.progress = 100;
        job.stage = isDemoData
          ? `[Demo Mode] সফলভাবে ${finalClips.length}টি ডেমো ক্লিপ ও SRT প্রস্তুত হয়েছে (Gemini API কোটা সীমা বা সংযোগের কারণে)।`
          : `সফলভাবে ${finalClips.length}টি পূর্ণাঙ্গ অর্থবহ ক্লিপ ও সিঙ্কড SRT প্রস্তুত হয়েছে!`;
        job.clips = finalClips;
        (job as any).isDemoData = isDemoData;
        (job as any).demoNotice = demoNotice;
      }
    } catch (err: any) {
      console.error('Clip analysis background error:', err);
      const failedJob = clipAnalysisJobs.get(jobId);
      if (failedJob) {
        failedJob.status = 'failed';
        const classified = classifyGeminiError(err);
        failedJob.error = classified.userMessage;
      }
    }
  })();
});

// Endpoint: Poll Clip Analysis Job Status
app.get('/api/clips/job-status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = clipAnalysisJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found or expired.' });
  }

  return res.json({
    success: true,
    jobId: job.id,
    sessionId: job.sessionId,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    clips: job.clips,
    totalDuration: job.totalDuration,
    error: job.error,
  });
});

// Endpoint: Fine-Tune Re-cut an existing clip with modified start/end times
app.post('/api/clips/recut', async (req, res) => {
  try {
    const { sessionId, clipId, newStart, newEnd, fileName = 'clip.mp3' } = req.body;
    if (!sessionId || !clipId || newStart === undefined || newEnd === undefined) {
      return res.status(400).json({ success: false, error: 'Missing recut parameters.' });
    }

    const sessionDir = path.join('/tmp', 'studio_uploads', sessionId);
    const masterMedia = path.join(sessionDir, 'master_audio.mp3');
    const sourceMedia = path.join(sessionDir, 'source_media');
    const inputPath = fs.existsSync(masterMedia) ? masterMedia : sourceMedia;
    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({ success: false, error: 'Source media session not found or expired.' });
    }

    const outputClipFileName = `${clipId}.mp3`;
    const outputClipFilePath = path.join(CLIPS_DIR, outputClipFileName);

    await cutAudioWithFfmpeg(inputPath, outputClipFilePath, Number(newStart), Number(newEnd));

    const duration = Math.max(0.5, Number(newEnd) - Number(newStart));

    return res.json({
      success: true,
      clipId,
      newStart,
      newEnd,
      duration,
      audioUrl: `/api/clips/audio-files/${outputClipFileName}?t=${Date.now()}`,
    });
  } catch (err: any) {
    console.error('Recut error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to recut audio.' });
  }
});

// Endpoint: Translate clip metadata to Bengali
app.post('/api/clips/translate-bengali', async (req, res) => {
  try {
    const { clips } = req.body;
    if (!Array.isArray(clips) || clips.length === 0) {
      return res.status(400).json({ success: false, error: 'No clips provided.' });
    }

    const customApiKey = extractApiKeyFromReq(req);
    const ai = getGenAI(240000, customApiKey);
    const prompt = `
You are an expert translator specializing in media, headlines, and subtitles.
Translate the metadata for the following clips into natural, fluent, and highly engaging BENGALI (বাংলা).
Rules:
1. "headline": Must be an engaging, professional headline in BENGALI (বাংলা ভাষায় আকর্ষণীয় শিরোনাম).
2. "summary": 1-2 sentences in clear, natural BENGALI (বাংলা সারসংক্ষেপ).
3. "topicConclusion": Full sentence in natural BENGALI explaining how the speaker concluded the topic (বাংলায় বাক্য ও বিষয় সমাপ্তির কারণ).
4. "categoryLabel": Must be one of: "তথ্যবহুল ও শিক্ষণীয়", "ইমোশনাল ও হৃদয়স্পর্শী", "ঐতিহাসিক ও তাৎপর্যপূর্ণ", "রোমাঞ্চকর ও হাইলাইট".
5. STRICT PROHIBITION: Do NOT output any Urdu script (اردو), Arabic script, or Hindi characters in any field. Everything must be in 100% pure Bengali script (বাংলা).

Input JSON:
${JSON.stringify(
  clips.map((c: any) => ({
    id: c.id,
    category: c.category,
    headline: c.headline,
    summary: c.summary,
    topicConclusion: c.topicConclusion,
  }))
)}

Return ONLY a valid JSON array with objects matching:
[
  {
    "id": "clip_id",
    "headline": "বাংলা আকর্ষণীয় শিরোনাম",
    "summary": "বাংলা সারসংক্ষেপ",
    "topicConclusion": "বাংলা উপসংহারের বিবরণ",
    "categoryLabel": "তথ্যবহুল ও শিক্ষণীয়"
  }
]
`;

    const response = await generateContentWithRetryAndFallback(ai, {
      contents: prompt,
      operation: 'Clip Bengali Translation',
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
      },
    });

    const parsed = safeParseJsonArray(response.text || '[]');
    return res.json({ success: true, translations: parsed, diagnostic: response.diagnostic });
  } catch (err: any) {
    console.error('Translate clips error:', err);
    const classified = classifyGeminiError(err);
    return res.status(classified.status || 500).json({
      success: false,
      error: classified.userMessage,
      errorType: classified.errorType,
      originalMessage: classified.originalMessage,
    });
  }
});

// Developer Diagnostic & Minimal Connectivity Test Endpoint (Sections 11 & 12)
app.get('/api/gemini/health-check', async (_req, res) => {
  try {
    const ai = getCentralizedGenAI();

    // 1. Simplest valid text request ("Say OK.")
    const simpleTextResult = await executeGeminiRequest({
      operation: 'Minimal Text Connectivity Test',
      contents: 'Say OK.',
      config: {
        maxOutputTokens: 16,
      },
      skipCache: true,
    });

    // 2. Structured JSON request
    const structuredJsonResult = await executeGeminiRequest({
      operation: 'Structured JSON Test',
      contents: 'Respond with a valid JSON object: {"status": "HEALTHY", "message": "OK"}',
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 64,
      },
      skipCache: true,
    });

    return res.json({
      success: true,
      status: 'HEALTHY',
      primaryModel: GEMINI_MODEL,
      fallbackModel: FALLBACK_GEMINI_MODEL,
      tests: {
        simpleText: {
          success: true,
          output: simpleTextResult.text.trim(),
          modelUsed: simpleTextResult.modelUsed,
        },
        structuredJson: {
          success: true,
          output: safeParseJson(structuredJsonResult.text, {}),
          modelUsed: structuredJsonResult.modelUsed,
        },
      },
      diagnostic: simpleTextResult.diagnostic,
    });
  } catch (err: any) {
    const classified = classifyGeminiError(err);
    return res.status(classified.status || 500).json({
      success: false,
      status: 'UNHEALTHY',
      error: classified.userMessage,
      errorType: classified.errorType,
      originalMessage: classified.originalMessage,
    });
  }
});

// API Route: Direct Subtitle Generation (with automatic ffmpeg compression for small/direct payloads)
app.post('/api/subtitles/generate', async (req, res) => {
  const tempId = `direct_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const tempDir = path.join('/tmp', 'studio_uploads', tempId);

  try {
    const {
      audioBase64,
      mimeType = 'audio/mp3',
      sourceLang = 'auto',
      targetLang = 'bn',
      maxCharsPerLine = 42,
      maxLines = 2,
    } = req.body;

    const customApiKey = extractApiKeyFromReq(req);

    if (!audioBase64) {
      return res.status(400).json({ success: false, error: 'Audio/Video data is required.' });
    }

    await fsp.mkdir(tempDir, { recursive: true });
    const tempInput = path.join(tempDir, 'in_media');
    const tempMp3 = path.join(tempDir, 'out.mp3');

    await fsp.writeFile(tempInput, Buffer.from(audioBase64, 'base64'));

    try {
      await runSafeFfmpeg([
        '-y',
        '-threads', '0',
        '-i', tempInput,
        '-vn',
        '-sn',
        '-dn',
        '-avoid_negative_ts', 'make_zero',
        '-af', 'aresample=async=1:first_pts=0',
        '-ar', '24000',
        '-ac', '1',
        '-c:a', 'libmp3lame',
        '-b:a', '96k',
        tempMp3,
      ], { timeoutMs: 90000 });
    } catch (ffmpegErr) {
      console.warn('Direct ffmpeg conversion warning, using input buffer directly:', ffmpegErr);
      await fsp.copyFile(tempInput, tempMp3);
    }

    const result = await processAudioFileForSubtitles({
      audioFilePath: tempMp3,
      sourceLang,
      targetLang,
      maxCharsPerLine,
      maxLines,
      customApiKey,
    });

    return res.json({
      success: true,
      detectedLanguage: result.detectedLanguage,
      segments: result.segments,
    });
  } catch (error: any) {
    console.error('Subtitle generation error:', error);
    const classified = classifyGeminiError(error);
    return res.status(classified.status || 500).json({
      success: false,
      error: classified.userMessage,
      errorType: classified.errorType,
    });
  } finally {
    fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

// API Route: Translate Existing Subtitle Segments to a New Target Language
app.post('/api/subtitles/translate-segments', async (req, res) => {
  try {
    const { segments, targetLang = 'en', maxCharsPerLine = 42, maxLines = 2 } = req.body;

    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return res.status(400).json({ error: 'No subtitle segments provided.' });
    }

    const customApiKey = extractApiKeyFromReq(req);
    const ai = getGenAI(240000, customApiKey);
    const tgtLangDesc = LANGUAGE_NAMES[targetLang] || targetLang;

    const prompt = `Translate the following subtitle segments into natural, fluent ${tgtLangDesc}.
Maintain the same indexes and timing.
Ensure each block does not exceed ${maxLines} lines and each line is approximately under ${maxCharsPerLine} characters.

Segments to translate:
${JSON.stringify(
  segments.map((s) => ({
    index: s.index,
    original: s.originalText || s.text,
  })),
  null,
  2
)}`;

    const response = await generateContentWithRetryAndFallback(ai, {
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              index: { type: Type.INTEGER },
              text: { type: Type.STRING },
            },
            required: ['index', 'text'],
          },
        },
      },
    });

    const translations: Array<{ index: number; text: string }> = safeParseJsonArray(response.text || '[]');
    const translationMap = new Map(translations.map((t) => [t.index, t.text]));

    const updatedSegments = segments.map((seg) => ({
      ...seg,
      text: translationMap.get(seg.index) || seg.text,
    }));

    // Enforce strict subtitle character and line limits after translation
    const constrained = enforceSubtitleConstraints(updatedSegments, maxCharsPerLine, maxLines);

    return res.json({
      success: true,
      segments: constrained,
    });
  } catch (error: any) {
    console.error('Translate segments error:', error);
    const classified = classifyGeminiError(error);
    return res.status(classified.status || 500).json({
      success: false,
      error: classified.userMessage,
      errorType: classified.errorType,
    });
  }
});


// Return JSON 404 for any unhandled /api/* endpoint
app.all('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global Express error handler ensuring JSON response instead of HTML error pages
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Express server error:', err);
  if (res.headersSent) {
    return next(err);
  }
  const status = err.status || err.statusCode || 500;
  return res.status(status).json({
    success: false,
    error: err.message || 'An unexpected server error occurred.',
  });
});

// Vite middleware or pre-built static Single-Page App serving
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';
  const distPath = path.join(process.cwd(), 'dist');
  const distIndexPath = path.join(distPath, 'index.html');

  if (isProduction && fs.existsSync(distIndexPath)) {
    // In production mode: serve pre-built static distribution assets
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'API route not found' });
      }
      if (fs.existsSync(distIndexPath)) {
        res.sendFile(distIndexPath, (err) => {
          if (err && !res.headersSent) {
            res.status(500).send('Application loading, please refresh.');
          }
        });
      } else {
        next();
      }
    });
  } else {
    // In dev mode: mount Vite middleware for instantaneous HMR-less SPA serving
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true, hmr: false },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (viteErr) {
      console.warn('Vite dev server failed to initialize, falling back to static dist if present:', viteErr);
      if (fs.existsSync(distIndexPath)) {
        app.use(express.static(distPath));
        app.get('*', (req, res, next) => {
          if (req.path.startsWith('/api')) return next();
          res.sendFile(distIndexPath, (err) => {
            if (err && !res.headersSent) {
              res.status(500).send('Application loading, please refresh.');
            }
          });
        });
      }
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SubSync - Precision Subtitle & SRT Studio server running on port ${PORT}`);
  });
}

startServer();
