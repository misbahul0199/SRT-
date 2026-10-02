import crypto from 'crypto';
import { GoogleGenAI, Type } from '@google/genai';

// ==================================================
// 4. CENTRALIZED GEMINI MODEL CONFIGURATION
// ==================================================
// High-reliability primary and fallback models verified for @google/genai ^2.4.0
export const GEMINI_MODEL = 'gemini-3.1-flash-lite';
export const FALLBACK_GEMINI_MODEL = 'gemini-2.5-flash';
export const TERTIARY_GEMINI_MODEL = 'gemini-3.8-flash';
export const MODEL_CASCADE = [
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-3.8-flash',
  'gemini-flash-latest',
];

// ==================================================
// 9. ERROR CLASSIFICATION TYPES & USER MESSAGES
// ==================================================
export enum GeminiErrorType {
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  RATE_LIMITED = 'RATE_LIMITED',
  INVALID_ARGUMENT = 'INVALID_ARGUMENT',
  INVALID_API_KEY = 'INVALID_API_KEY',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  MODEL_UNAVAILABLE = 'MODEL_UNAVAILABLE',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  MALFORMED_RESPONSE = 'MALFORMED_RESPONSE',
  EMPTY_RESPONSE = 'EMPTY_RESPONSE',
  UNKNOWN = 'UNKNOWN',
}

export interface ClassifiedGeminiError {
  errorType: GeminiErrorType;
  status: number;
  userMessage: string;
  originalMessage: string;
  retryDelayMs?: number;
}

export function classifyGeminiError(err: any): ClassifiedGeminiError {
  // If error has already been classified, preserve the classified metadata directly
  if (err && typeof err === 'object' && err.classified && err.classified.userMessage) {
    return err.classified;
  }

  const msg = String(err?.message || err?.error?.message || (typeof err === 'string' ? err : JSON.stringify(err)) || '');
  const status = Number(err?.status || err?.statusCode || err?.code || 0);

  // 1. INVALID_ARGUMENT (HTTP 400 with invalid argument or schema issues)
  // Must NEVER be retried automatically.
  if (
    (status === 400 && (msg.includes('INVALID_ARGUMENT') || msg.includes('invalid argument') || msg.includes('Request contains an invalid argument'))) ||
    msg.includes('INVALID_ARGUMENT')
  ) {
    let specificDetail = '';
    try {
      const parsed = JSON.parse(msg);
      if (parsed?.error?.message) {
        specificDetail = parsed.error.message;
      }
    } catch (_) {
      const match = msg.match(/"message":\s*"([^"]+)"/);
      if (match && match[1]) specificDetail = match[1];
    }

    return {
      errorType: GeminiErrorType.INVALID_ARGUMENT,
      status: 400,
      userMessage: specificDetail
        ? `Gemini API অনুরোধে একটি অবৈধ প্যারামিটার (INVALID_ARGUMENT) রয়েছে: "${specificDetail}"। কনফিগারেশন সংশোধন করুন।`
        : 'Gemini API অনুরোধে একটি অবৈধ প্যারামিটার (INVALID_ARGUMENT) রয়েছে। অনুরোধ কনফিগারেশন পরীক্ষা করুন।',
      originalMessage: msg,
    };
  }

  // 2. Invalid API Key
  if (
    msg.includes('API_KEY_INVALID') ||
    msg.includes('API key not valid') ||
    msg.includes('Invalid API key') ||
    (status === 400 && msg.includes('API key'))
  ) {
    return {
      errorType: GeminiErrorType.INVALID_API_KEY,
      status: 400,
      userMessage: 'Gemini API key সঠিক নয় অথবা নিষ্ক্রিয়। সেটিংস থেকে API key পরীক্ষা করুন।',
      originalMessage: msg,
    };
  }

  // 3. Permission Denied / Forbidden
  if (status === 403 || msg.includes('PERMISSION_DENIED')) {
    return {
      errorType: GeminiErrorType.PERMISSION_DENIED,
      status: 403,
      userMessage: 'Gemini API এক্সেস অনুমোদিত নয় (Permission Denied)। প্রজেক্ট ও এপিআই পারমিশন যাচাই করুন।',
      originalMessage: msg,
    };
  }

  // 4. Authentication Error
  if (status === 401 || msg.includes('UNAUTHENTICATED') || msg.includes('unauthenticated')) {
    return {
      errorType: GeminiErrorType.AUTHENTICATION_ERROR,
      status: 401,
      userMessage: 'Gemini API Authentication ব্যর্থ হয়েছে। API প্রমাণীকরণ যাচাই করুন।',
      originalMessage: msg,
    };
  }

  // 5. Model Not Found
  if (
    status === 404 ||
    msg.includes('NOT_FOUND') ||
    msg.includes('model not found') ||
    msg.includes('is not found')
  ) {
    return {
      errorType: GeminiErrorType.MODEL_NOT_FOUND,
      status: 404,
      userMessage: 'অনুরোধকৃত Gemini মডেলটি পাওয়া যায়নি (Model Not Found)।',
      originalMessage: msg,
    };
  }

  // 6. Quota Exhaustion (Daily / Tier Quota - No Retries Allowed)
  const isDailyOrAccountQuota =
    msg.includes('quota limit') ||
    msg.includes('Free tier') ||
    msg.includes('free tier') ||
    msg.includes('current quota') ||
    msg.includes('Per-day') ||
    msg.includes('exceeded your current quota') ||
    msg.includes('daily limit');

  const retryDelay = extractRetryDelayMs(err);

  if (isDailyOrAccountQuota || (msg.includes('RESOURCE_EXHAUSTED') && retryDelay > 60000)) {
    return {
      errorType: GeminiErrorType.QUOTA_EXCEEDED,
      status: 429,
      userMessage:
        'Gemini API-এর বর্তমান quota সীমা অতিক্রম করা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন অথবা Google AI Studio-তে Usage ও Rate Limits পরীক্ষা করুন।',
      originalMessage: msg,
      retryDelayMs: retryDelay,
    };
  }

  // 7. Temporary Rate Limit (RPM / Bursts - Maximum 2 retries)
  if (
    status === 429 ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('Rate limit') ||
    msg.includes('Too Many Requests')
  ) {
    return {
      errorType: GeminiErrorType.RATE_LIMITED,
      status: 429,
      userMessage: 'Gemini API বর্তমানে ব্যস্ত। কয়েক মুহূর্ত পরে আবার চেষ্টা করুন।',
      originalMessage: msg,
      retryDelayMs: retryDelay > 0 ? retryDelay : 2000,
    };
  }

  // 8. Model Unavailable (503 / 504 / High Demand)
  if (
    status === 503 ||
    status === 504 ||
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('high demand') ||
    msg.includes('overloaded')
  ) {
    return {
      errorType: GeminiErrorType.MODEL_UNAVAILABLE,
      status: status || 503,
      userMessage: 'Google Gemini মডেলটি বর্তমানে অত্যধিক চাপের কারণে সাময়িকভাবে ব্যস্ত (High Demand)। ১ মিনিট পর আবার চেষ্টা করুন অথবা সেটিংস থেকে নিজস্ব ফ্রি Gemini API Key ব্যবহার করুন।',
      originalMessage: msg,
    };
  }

  // 9. Network Error
  if (
    msg.includes('fetch failed') ||
    msg.includes('ECONNRESET') ||
    msg.includes('socket hang up') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('EAI_AGAIN') ||
    msg.includes('network')
  ) {
    return {
      errorType: GeminiErrorType.NETWORK_ERROR,
      status: 502,
      userMessage:
        'Gemini API সার্ভারের সাথে নেটওয়ার্ক সংযোগ বিঘ্নিত হয়েছে। ইন্টারনেট সংযোগ ও সার্ভার স্ট্যাটাস পরীক্ষা করুন।',
      originalMessage: msg,
    };
  }

  // 10. Timeout
  if (
    msg.includes('aborted') ||
    msg.includes('AbortError') ||
    msg.includes('timeout') ||
    err?.name === 'AbortError' ||
    err?.name === 'DOMException'
  ) {
    return {
      errorType: GeminiErrorType.TIMEOUT,
      status: 504,
      userMessage: 'Gemini API অনুরোধটির সময়সীমা অতিক্রম করেছে (Timeout)। পুনরায় চেষ্টা করুন।',
      originalMessage: msg,
    };
  }

  return {
    errorType: GeminiErrorType.UNKNOWN,
    status: status || 500,
    userMessage: 'Google Gemini এআই সার্ভারে সাময়িক বিঘ্ন ঘটেছে (ফ্রি সার্ভার ট্রাফিক বা রেট লিমিট)। অনুগ্রহ করে ১ মিনিট পর আবার চেষ্টা করুন অথবা নিজস্ব ফ্রি API Key ব্যবহার করুন।',
    originalMessage: msg,
  };
}

function extractRetryDelayMs(err: any): number {
  try {
    const raw = String(err?.message || JSON.stringify(err) || '');
    const secMatch = raw.match(/retry(?:ing)? in ([\d\.]+)s/i) || raw.match(/retry after ([\d\.]+)s/i);
    if (secMatch && secMatch[1]) {
      const sec = parseFloat(secMatch[1]);
      if (!isNaN(sec) && sec > 0) return Math.min(Math.round(sec * 1000), 86400000);
    }
  } catch (_) {}
  return 0;
}

// ==================================================
// 2 & 11. TEMPORARY DEBUG MODE & REQUEST SANITIZER
// ==================================================
export interface GeminiRequestDiagnosticInfo {
  model: string;
  operation: string;
  contentsValid: boolean;
  contentsCount: number;
  partsSummary: string[];
  generationConfigKeys: string[];
  responseFormat?: string;
  responseSchemaStatus: string;
  tools: string;
  mediaTypes: string[];
}

export function sanitizeAndValidateGeminiRequest(
  model: string,
  operation: string,
  rawContents: any,
  rawConfig?: any
): {
  sanitizedContents: any;
  sanitizedConfig?: any;
  diagnostic: GeminiRequestDiagnosticInfo;
} {
  const partsSummary: string[] = [];
  const mediaTypes: string[] = [];
  let contentsCount = 0;
  let contentsValid = true;

  // 1. Sanitize Contents
  let sanitizedContents: any;

  if (typeof rawContents === 'string') {
    sanitizedContents = rawContents;
    contentsCount = 1;
    partsSummary.push('1 text string');
  } else if (Array.isArray(rawContents)) {
    contentsCount = rawContents.length;
    sanitizedContents = rawContents.map((item, idx) => {
      // If item is { text: "..." } without parts, format into proper Part object
      if (item && typeof item === 'object' && !('parts' in item) && typeof (item as any).text === 'string') {
        partsSummary.push(`Item ${idx}: 1 text part (normalized)`);
        return {
          role: (item as any).role || 'user',
          parts: [{ text: (item as any).text }],
        };
      }

      // If item has parts
      if (item && typeof item === 'object' && Array.isArray((item as any).parts)) {
        const itemParts = (item as any).parts.map((p: any) => {
          if (p.inlineData) {
            const mime = p.inlineData.mimeType || 'unknown';
            const size = typeof p.inlineData.data === 'string' ? p.inlineData.data.length : 0;
            mediaTypes.push(mime);
            partsSummary.push(`inlineData [${mime}, ${Math.round(size / 1024)}KB]`);
            return {
              inlineData: {
                mimeType: mime,
                data: p.inlineData.data,
              },
            };
          }
          if (p.text !== undefined) {
            partsSummary.push('1 text part');
            return { text: String(p.text) };
          }
          return p;
        });
        return {
          role: (item as any).role || 'user',
          parts: itemParts,
        };
      }

      return item;
    });
  } else if (rawContents && typeof rawContents === 'object' && Array.isArray(rawContents.parts)) {
    contentsCount = 1;
    const itemParts = rawContents.parts.map((p: any) => {
      if (p.inlineData) {
        const mime = p.inlineData.mimeType || 'unknown';
        const size = typeof p.inlineData.data === 'string' ? p.inlineData.data.length : 0;
        mediaTypes.push(mime);
        partsSummary.push(`inlineData [${mime}, ${Math.round(size / 1024)}KB]`);
        return {
          inlineData: {
            mimeType: mime,
            data: p.inlineData.data,
          },
        };
      }
      if (p.text !== undefined) {
        partsSummary.push('1 text part');
        return { text: String(p.text) };
      }
      return p;
    });
    sanitizedContents = { parts: itemParts };
  } else {
    sanitizedContents = rawContents;
    contentsValid = false;
  }

  // 2. Sanitize Config
  let sanitizedConfig: any = undefined;
  const generationConfigKeys: string[] = [];
  let responseSchemaStatus = 'none';
  let responseFormat = 'text/plain';

  if (rawConfig && typeof rawConfig === 'object') {
    sanitizedConfig = {};

    // responseMimeType
    if (rawConfig.responseMimeType && typeof rawConfig.responseMimeType === 'string') {
      sanitizedConfig.responseMimeType = rawConfig.responseMimeType;
      generationConfigKeys.push('responseMimeType');
      responseFormat = rawConfig.responseMimeType;
    }

    // responseSchema (validate structure)
    if (rawConfig.responseSchema && typeof rawConfig.responseSchema === 'object') {
      if (rawConfig.responseSchema.type) {
        sanitizedConfig.responseSchema = rawConfig.responseSchema;
        generationConfigKeys.push('responseSchema');
        responseSchemaStatus = `valid (${rawConfig.responseSchema.type})`;
      } else {
        responseSchemaStatus = 'omitted (missing type property)';
      }
    }

    // maxOutputTokens
    if (typeof rawConfig.maxOutputTokens === 'number' && rawConfig.maxOutputTokens > 0) {
      sanitizedConfig.maxOutputTokens = rawConfig.maxOutputTokens;
      generationConfigKeys.push('maxOutputTokens');
    }

    // temperature
    if (typeof rawConfig.temperature === 'number') {
      sanitizedConfig.temperature = rawConfig.temperature;
      generationConfigKeys.push('temperature');
    }

    // topP
    if (typeof rawConfig.topP === 'number') {
      sanitizedConfig.topP = rawConfig.topP;
      generationConfigKeys.push('topP');
    }

    // topK
    if (typeof rawConfig.topK === 'number') {
      sanitizedConfig.topK = rawConfig.topK;
      generationConfigKeys.push('topK');
    }

    // systemInstruction
    if (rawConfig.systemInstruction && typeof rawConfig.systemInstruction === 'string') {
      sanitizedConfig.systemInstruction = rawConfig.systemInstruction;
      generationConfigKeys.push('systemInstruction');
    }

    // CRITICAL: Filter out invalid thinkingConfig for Gemini 3.5/3.1
    // In Gemini 3.x, thinkingBudget causes HTTP 400 INVALID_ARGUMENT!
    if (rawConfig.thinkingConfig && typeof rawConfig.thinkingConfig === 'object') {
      if (rawConfig.thinkingConfig.thinkingLevel) {
        sanitizedConfig.thinkingConfig = {
          thinkingLevel: rawConfig.thinkingConfig.thinkingLevel,
        };
        generationConfigKeys.push('thinkingConfig (thinkingLevel)');
      }
      // Explicitly DROP thinkingBudget: 0 or any other thinkingBudget property!
    }

    // If sanitizedConfig is completely empty, keep it undefined
    if (Object.keys(sanitizedConfig).length === 0) {
      sanitizedConfig = undefined;
    }
  }

  const diagnostic: GeminiRequestDiagnosticInfo = {
    model,
    operation,
    contentsValid,
    contentsCount,
    partsSummary,
    generationConfigKeys,
    responseFormat,
    responseSchemaStatus,
    tools: 'none',
    mediaTypes,
  };

  return { sanitizedContents, sanitizedConfig, diagnostic };
}

export function logGeminiRequestDiagnostic(diag: GeminiRequestDiagnosticInfo) {
  console.log(`
================ Gemini Request Diagnostic ================
Model: ${diag.model}
Operation: ${diag.operation}
Contents: ${diag.contentsValid ? 'valid' : 'invalid'} (${diag.contentsCount} item${diag.contentsCount > 1 ? 's' : ''})
Parts: ${diag.partsSummary.join(', ') || '1 text prompt'}
Generation Config: ${diag.generationConfigKeys.length > 0 ? diag.generationConfigKeys.join(', ') : 'default (none)'}
Response Format: ${diag.responseFormat || 'text/plain'}
Response Schema: ${diag.responseSchemaStatus}
Tools: ${diag.tools}
Media: ${diag.mediaTypes.length > 0 ? diag.mediaTypes.join(', ') : 'none'}
===========================================================`);
}

// ==================================================
// SESSION RESULT CACHE & IN-FLIGHT DEDUPLICATION
// ==================================================
interface CacheEntry {
  data: any;
  timestamp: number;
}

const MAX_CACHE_ENTRIES = 60;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const sessionResultCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<any>>();

function computeRequestHash(operation: string, payload: any): string {
  try {
    const serialized = JSON.stringify({ operation, payload });
    return crypto.createHash('sha256').update(serialized).digest('hex').substring(0, 24);
  } catch {
    return `${operation}_${Date.now()}`;
  }
}

// ==================================================
// CONCISE STRUCTURED LOGGING
// ==================================================
function logGeminiEvent(params: {
  model: string;
  operation: string;
  requestId: string;
  status: number | string;
  errorType?: GeminiErrorType;
}) {
  const lines = [
    '[Gemini]',
    `Model: ${params.model}`,
    `Operation: ${params.operation}`,
    `Request ID: ${params.requestId}`,
    `Status: ${params.status}`,
  ];
  if (params.errorType) {
    lines.push(`Error Type: ${params.errorType}`);
  }
  console.log(lines.join('\n'));
}

// ==================================================
// CENTRALIZED CLIENT INSTANCE FACTORY
// ==================================================
export function getCentralizedGenAI(timeoutMs: number = 240000, customApiKey?: string) {
  const apiKey = (customApiKey && typeof customApiKey === 'string' && customApiKey.trim()) || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key is required. Open Settings to add your key.');
  }
  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
      timeout: timeoutMs,
    },
  });
}

// ==================================================
// JSON CLEANUP & SAFE PARSING
// ==================================================
export function safeParseJson<T = any>(rawText: string, fallback: T): T {
  if (!rawText || typeof rawText !== 'string') return fallback;

  let cleaned = rawText.trim();
  // Strip Markdown code blocks
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch (_) {
    // Attempt relaxed object/array extraction
    try {
      const firstBracket = cleaned.indexOf('[');
      const lastBracket = cleaned.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket > firstBracket) {
        const arraySub = cleaned.slice(firstBracket, lastBracket + 1);
        return JSON.parse(arraySub) as T;
      }
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const objSub = cleaned.slice(firstBrace, lastBrace + 1);
        return JSON.parse(objSub) as T;
      }
    } catch (_) {}
  }

  return fallback;
}

// ==================================================
// CORE CENTRALIZED GEMINI SERVICE
// ==================================================
export interface GeminiRequestOptions {
  operation: string;
  contents: any;
  config?: any;
  requestId?: string;
  skipCache?: boolean;
  customApiKey?: string;
  timeoutMs?: number;
}

export async function executeGeminiRequest(options: GeminiRequestOptions): Promise<{
  text: string;
  modelUsed: string;
  fromCache?: boolean;
  diagnostic: GeminiRequestDiagnosticInfo;
}> {
  const { operation, contents, config, customApiKey, timeoutMs } = options;
  const requestId = options.requestId || `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // 1. Cache Check (isolated by key type)
  const keyIdentifier = customApiKey ? `custom_${computeRequestHash('key', customApiKey).substring(0, 8)}` : 'server_default';
  const cacheKey = `${keyIdentifier}_${computeRequestHash(operation, { contents, config })}`;
  if (!options.skipCache) {
    const cached = sessionResultCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      logGeminiEvent({
        model: GEMINI_MODEL,
        operation,
        requestId,
        status: '200 OK (Cache Hit)',
      });
      return {
        text: cached.data.text,
        modelUsed: cached.data.modelUsed,
        fromCache: true,
        diagnostic: cached.data.diagnostic,
      };
    }
  }

  // 2. Request Deduplication: In-flight execution check
  const inFlight = inFlightRequests.get(cacheKey);
  if (inFlight) {
    logGeminiEvent({
      model: GEMINI_MODEL,
      operation,
      requestId,
      status: 'In-Flight Shared Request',
    });
    return await inFlight;
  }

  // 3. Initiate Single Execution Promise
  const requestPromise = (async () => {
    const ai = getCentralizedGenAI(timeoutMs || 240000, customApiKey);
    let modelIndex = 0;
    let currentModel = MODEL_CASCADE[modelIndex] || GEMINI_MODEL;
    let attemptsOnCurrentModel = 0;
    const MAX_RETRIES = 2; // Maximum 2 retries (3 attempts total) for temporary rate limits per model

    while (true) {
      attemptsOnCurrentModel++;

      // Sanitize and validate request to prevent INVALID_ARGUMENT (400)
      const { sanitizedContents, sanitizedConfig, diagnostic } = sanitizeAndValidateGeminiRequest(
        currentModel,
        operation,
        contents,
        config
      );

      // Log request diagnostic
      logGeminiRequestDiagnostic(diagnostic);

      try {
        const response = await ai.models.generateContent({
          model: currentModel,
          contents: sanitizedContents,
          config: sanitizedConfig,
        });

        const text = response.text || '';
        if (!text || text.trim().length === 0) {
          const errClass = {
            errorType: GeminiErrorType.EMPTY_RESPONSE,
            status: 500,
            userMessage: 'Gemini API থেকে কোনো ফলাফল পাওয়া যায়নি। অনুগ্রহ করে পুনরায় চেষ্টা করুন।',
            originalMessage: 'Empty response text received from Gemini API',
          };
          logGeminiEvent({
            model: currentModel,
            operation,
            requestId,
            status: 500,
            errorType: errClass.errorType,
          });
          const error = new Error(errClass.userMessage);
          (error as any).classified = errClass;
          throw error;
        }

        // Success Log
        logGeminiEvent({
          model: currentModel,
          operation,
          requestId,
          status: '200 OK',
        });

        const result = { text, modelUsed: currentModel, diagnostic };

        // Save to session result cache
        if (sessionResultCache.size >= MAX_CACHE_ENTRIES) {
          const firstKey = sessionResultCache.keys().next().value;
          if (firstKey) sessionResultCache.delete(firstKey);
        }
        sessionResultCache.set(cacheKey, { data: result, timestamp: Date.now() });

        return result;
      } catch (rawError: any) {
        if (rawError?.classified && rawError?.classified?.errorType === GeminiErrorType.INVALID_ARGUMENT) {
          throw rawError;
        }

        const classified = classifyGeminiError(rawError);

        logGeminiEvent({
          model: currentModel,
          operation,
          requestId,
          status: classified.status,
          errorType: classified.errorType,
        });

        // ==========================================
        // RULE 1: INVALID_ARGUMENT (HTTP 400) -> NEVER RETRY, NEVER FALLBACK LOOP!
        // ==========================================
        if (classified.errorType === GeminiErrorType.INVALID_ARGUMENT) {
          console.error(`[Gemini INVALID_ARGUMENT] Operation: ${operation}, Model: ${currentModel}. Stopping request immediately without retry.`);
          const err = new Error(classified.userMessage);
          (err as any).classified = classified;
          (err as any).diagnostic = diagnostic;
          throw err;
        }

        // ==========================================
        // RULE 2: QUOTA EXHAUSTED -> FAILOVER TO NEXT CASCADE MODEL IF AVAILABLE
        // ==========================================
        if (classified.errorType === GeminiErrorType.QUOTA_EXCEEDED) {
          if (modelIndex + 1 < MODEL_CASCADE.length) {
            modelIndex++;
            const nextModel = MODEL_CASCADE[modelIndex];
            console.log(`[Gemini Quota Failover] Model ${currentModel} reached free tier quota. Seamlessly cascading to next model ${nextModel} (${modelIndex + 1}/${MODEL_CASCADE.length})...`);
            currentModel = nextModel;
            attemptsOnCurrentModel = 0;
            await new Promise((r) => setTimeout(r, 400));
            continue;
          }
          const err = new Error(classified.userMessage);
          (err as any).classified = classified;
          throw err;
        }

        // ==========================================
        // RULE 3: RETRIABLE TRANSIENT ERRORS (RATE_LIMITED, MODEL_UNAVAILABLE, NETWORK_ERROR, TIMEOUT)
        // ==========================================
        const isRetriable = (
          classified.errorType === GeminiErrorType.RATE_LIMITED ||
          classified.errorType === GeminiErrorType.MODEL_UNAVAILABLE ||
          classified.errorType === GeminiErrorType.NETWORK_ERROR ||
          classified.errorType === GeminiErrorType.TIMEOUT ||
          classified.status === 429 ||
          classified.status === 503 ||
          classified.status === 504 ||
          classified.status === 502
        );

        const longWaitRequired = (classified.retryDelayMs !== undefined && classified.retryDelayMs > 10000);

        if (!longWaitRequired && isRetriable && attemptsOnCurrentModel <= MAX_RETRIES) {
          const baseBackoff = Math.max(classified.retryDelayMs || 1500, attemptsOnCurrentModel * 1500);
          const jitter = Math.floor(Math.random() * 500);
          const waitTime = Math.min(baseBackoff + jitter, 8000);

          console.log(`[Gemini Retry] ${classified.errorType} (${classified.status}) on ${currentModel}. Retrying attempt ${attemptsOnCurrentModel}/${MAX_RETRIES} after ${waitTime}ms...`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }

        // ==========================================
        // RULE 4: RETRIES EXHAUSTED OR MODEL ERROR -> CASCADE TO NEXT MODEL
        // ==========================================
        const canCascade = (
          classified.errorType === GeminiErrorType.MODEL_NOT_FOUND ||
          classified.errorType === GeminiErrorType.MODEL_UNAVAILABLE ||
          classified.errorType === GeminiErrorType.RATE_LIMITED ||
          classified.errorType === GeminiErrorType.NETWORK_ERROR ||
          classified.errorType === GeminiErrorType.TIMEOUT ||
          classified.status === 503 ||
          classified.status === 504 ||
          classified.status === 429 ||
          classified.status === 502
        );

        if (canCascade && modelIndex + 1 < MODEL_CASCADE.length) {
          modelIndex++;
          const nextModel = MODEL_CASCADE[modelIndex];
          console.log(`[Gemini Failover] Model ${currentModel} exhausted attempts or encountered ${classified.errorType} (${classified.status}). Seamlessly switching to cascade model ${nextModel} (${modelIndex + 1}/${MODEL_CASCADE.length})...`);
          currentModel = nextModel;
          attemptsOnCurrentModel = 0;
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }

        // ==========================================
        // RULE 5: ALL ATTEMPTS / MODELS EXHAUSTED OR FATAL ERROR -> THROW CLASSIFIED ERROR
        // ==========================================
        const err = new Error(classified.userMessage);
        (err as any).classified = classified;
        throw err;
      }
    }
  })();

  inFlightRequests.set(cacheKey, requestPromise);

  try {
    return await requestPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}
