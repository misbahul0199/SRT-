// API Utility with friendly Bengali error translations, automatic retry, and Bring-Your-Own-Key (BYOK) support

export const API_KEY_STORAGE_KEY = 'subsync_user_gemini_api_key';

/**
 * Retrieve user's custom Gemini API key from localStorage
 */
export function getStoredApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * Persist user's custom Gemini API key into localStorage and notify listeners
 */
export function setStoredApiKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed) {
      localStorage.setItem(API_KEY_STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
    window.dispatchEvent(new Event('subsync_api_key_changed'));
  } catch (e) {
    console.error('Failed to save API key to localStorage:', e);
  }
}

/**
 * Remove stored API key from localStorage
 */
export function removeStoredApiKey(): void {
  try {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    window.dispatchEvent(new Event('subsync_api_key_changed'));
  } catch (e) {
    console.error('Failed to remove API key from localStorage:', e);
  }
}

/**
 * Check if a custom API key is configured
 */
export function hasStoredApiKey(): boolean {
  return Boolean(getStoredApiKey());
}

/**
 * Safely mask API key for display (e.g. AIzaSy...xxxx)
 */
export function maskApiKey(key: string): string {
  if (!key) return '';
  const trimmed = key.trim();
  if (trimmed.length <= 10) return '••••••••••';
  return `${trimmed.slice(0, 7)}...${trimmed.slice(-4)}`;
}

/**
 * Validate a Gemini API key by making a test call to the server validation endpoint
 */
export async function validateApiKeyOnServer(apiKey: string): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch('/api/gemini/validate-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: apiKey.trim() }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return { success: true, message: data.message || 'API Key সফলভাবে যাচাই হয়েছে!' };
    }
    return { success: false, error: data.error || 'API Key টি সঠিক নয়।' };
  } catch (err: any) {
    return { success: false, error: err.message || 'যাচাইয়ের সময় সার্ভারের সাথে সংযোগ করা সম্ভব হয়নি।' };
  }
}

/**
 * Core robust fetch helper with automatic retry, JSON parsing, and user API key header injection
 */
export async function safeFetchJson<T = any>(
  url: string,
  options?: RequestInit,
  fallbackErrMsg = 'অনুরোধটি সম্পন্ন করা যায়নি।',
  maxRetries = 2
): Promise<T> {
  let attempt = 0;

  // Clone or build headers with custom API key if present
  const baseHeaders: Record<string, string> = {};
  const customKey = getStoredApiKey();
  if (customKey) {
    baseHeaders['x-gemini-api-key'] = customKey;
  }

  let finalOptions: RequestInit = { ...(options || {}) };
  if (options?.headers) {
    if (options.headers instanceof Headers) {
      const merged = new Headers(options.headers);
      if (customKey && !merged.has('x-gemini-api-key')) {
        merged.set('x-gemini-api-key', customKey);
      }
      finalOptions.headers = merged;
    } else if (Array.isArray(options.headers)) {
      finalOptions.headers = [
        ...options.headers,
        ...(customKey ? [['x-gemini-api-key', customKey] as [string, string]] : []),
      ];
    } else {
      finalOptions.headers = {
        ...baseHeaders,
        ...options.headers,
      };
    }
  } else if (customKey) {
    finalOptions.headers = baseHeaders;
  }

  while (attempt <= maxRetries) {
    attempt++;
    let res: Response;
    try {
      res = await fetch(url, finalOptions);
    } catch (networkErr: any) {
      if (attempt <= maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      throw new Error('সার্ভারের সাথে সংযোগ স্থাপন করা যায়নি। অনুগ্রহ করে আপনার ইন্টারনেট বা নেটওয়ার্ক সংযোগ পরীক্ষা করুন।');
    }

    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const data = await res.json();
      if (!res.ok || data.success === false) {
        // If 503 or 504 JSON error and we have retries left
        if ((res.status === 503 || res.status === 504) && attempt <= maxRetries) {
          await new Promise((r) => setTimeout(r, 1200 * attempt));
          continue;
        }
        throw new Error(data.error || fallbackErrMsg);
      }
      return data as T;
    }

    // Response was not JSON (e.g. HTML from reverse proxy or error page)
    const errorText = await res.text();
    const isProxyTimeoutOrBusy =
      errorText.includes('<!doctype') ||
      errorText.includes('<html') ||
      errorText.includes('warmup') ||
      errorText.includes('Starting Server') ||
      res.status === 502 ||
      res.status === 503 ||
      res.status === 504;

    if (isProxyTimeoutOrBusy && attempt <= maxRetries) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }

    if (isProxyTimeoutOrBusy) {
      throw new Error(
        'সার্ভারে ফাইল প্রসেসিং সম্পন্ন হতে বিলম্ব হচ্ছে বা সার্ভার সাময়িক ব্যস্ত রয়েছে। অনুগ্রহ করে পুনরায় চেষ্টা করুন।'
      );
    }

    throw new Error(`${fallbackErrMsg} (${res.status}): ${errorText.slice(0, 120)}`);
  }

  throw new Error(fallbackErrMsg);
}
