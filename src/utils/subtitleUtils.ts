import { SubtitleSegment } from '../types';

export function formatSrtTime(seconds: number): string {
  const safeSec = Math.max(0, isFinite(seconds) ? seconds : 0);
  const totalMs = Math.round(safeSec * 1000);
  const hrs = Math.floor(totalMs / 3600000);
  const mins = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const msecs = totalMs % 1000;

  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(msecs).padStart(3, '0')}`;
}

export function formatVttTime(seconds: number): string {
  const safeSec = Math.max(0, isFinite(seconds) ? seconds : 0);
  const totalMs = Math.round(safeSec * 1000);
  const hrs = Math.floor(totalMs / 3600000);
  const mins = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const msecs = totalMs % 1000;

  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(msecs).padStart(3, '0')}`;
}

export function formatDisplayTime(seconds: number): string {
  const safeSec = Math.max(0, isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safeSec / 60);
  const secs = Math.floor(safeSec % 60);
  const tenths = Math.floor((safeSec % 1) * 10);

  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

export function parseSubtitleTime(timeStr: string): number | null {
  if (!timeStr) return null;
  const clean = timeStr.trim();
  // Handle [HH:]MM:SS[,.]mmm or [HH:]MM:SS
  const match = clean.match(/^(?:(?:(\d{1,3}):)?(\d{1,2}):)?(\d{1,2})(?:[,\.](\d{1,4}))?$/);
  if (!match) return null;

  let hrs = 0;
  let mins = 0;
  let secs = 0;

  if (match[1] !== undefined && match[2] !== undefined) {
    hrs = parseInt(match[1], 10);
    mins = parseInt(match[2], 10);
    secs = parseInt(match[3], 10);
  } else if (match[2] !== undefined) {
    mins = parseInt(match[2], 10);
    secs = parseInt(match[3], 10);
  } else {
    secs = parseInt(match[3], 10);
  }

  let ms = 0;
  if (match[4]) {
    const rawMs = match[4].padEnd(3, '0').slice(0, 3);
    ms = parseInt(rawMs, 10);
  }

  return hrs * 3600 + mins * 60 + secs + ms / 1000;
}

export function splitTextIntoStrictLines(text: string, maxChars: number): string[] {
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

export function enforceSubtitleConstraints(
  segments: SubtitleSegment[],
  maxCharsPerLine: number = 42,
  maxLines: number = 2
): SubtitleSegment[] {
  const maxChars = Math.max(15, Number(maxCharsPerLine) || 42);
  const maxLineCount = Math.max(1, Number(maxLines) || 2);
  const result: SubtitleSegment[] = [];
  let nextIndex = 1;

  for (const seg of segments) {
    const rawText = String(seg.text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();

    if (!rawText) continue;

    // Check if text already meets constraints without destructive re-wrapping
    const existingLines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
    const alreadyValid =
      existingLines.length <= maxLineCount &&
      existingLines.every((l) => l.length <= maxChars);

    if (alreadyValid) {
      result.push({
        ...seg,
        id: seg.id || nextIndex,
        index: nextIndex++,
        text: existingLines.join('\n'),
        start: Math.round(Number(seg.start || 0) * 100) / 100,
        end: Math.round(Number(seg.end || seg.start + 2) * 100) / 100,
      });
      continue;
    }

    const lines = splitTextIntoStrictLines(rawText, maxChars);

    const blocks: string[] = [];
    for (let i = 0; i < lines.length; i += maxLineCount) {
      const blockLines = lines.slice(i, i + maxLineCount);
      blocks.push(blockLines.join('\n'));
    }

    if (blocks.length <= 1) {
      result.push({
        ...seg,
        id: seg.id || nextIndex,
        index: nextIndex++,
        text: blocks[0] || rawText,
        start: Math.round(Number(seg.start || 0) * 100) / 100,
        end: Math.round(Number(seg.end || seg.start + 2) * 100) / 100,
      });
    } else {
      const segStart = Number(seg.start) || 0;
      const segEnd = Math.max(segStart + 0.6, Number(seg.end) || segStart + 2);
      const totalDuration = segEnd - segStart;

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

export function generateSrtContent(
  subtitles: SubtitleSegment[],
  offsetMs = 0,
  maxCharsPerLine?: number,
  maxLines?: number
): string {
  const offsetSec = offsetMs / 1000;
  let content = '';

  const processed = maxCharsPerLine
    ? enforceSubtitleConstraints(subtitles, maxCharsPerLine, maxLines || 2)
    : subtitles;

  processed.forEach((sub, idx) => {
    const start = Math.max(0, sub.start + offsetSec);
    const end = Math.max(start + 0.2, sub.end + offsetSec);

    content += `${idx + 1}\r\n`;
    content += `${formatSrtTime(start)} --> ${formatSrtTime(end)}\r\n`;
    content += `${sub.text.trim()}\r\n\r\n`;
  });

  return content;
}

export function generateVttContent(
  subtitles: SubtitleSegment[],
  offsetMs = 0,
  maxCharsPerLine?: number,
  maxLines?: number
): string {
  const offsetSec = offsetMs / 1000;
  let content = 'WEBVTT\r\n\r\n';

  const processed = maxCharsPerLine
    ? enforceSubtitleConstraints(subtitles, maxCharsPerLine, maxLines || 2)
    : subtitles;

  processed.forEach((sub, idx) => {
    const start = Math.max(0, sub.start + offsetSec);
    const end = Math.max(start + 0.2, sub.end + offsetSec);

    content += `${idx + 1}\r\n`;
    content += `${formatVttTime(start)} --> ${formatVttTime(end)}\r\n`;
    content += `${sub.text.trim()}\r\n\r\n`;
  });

  return content;
}

export function generateTxtTranscript(subtitles: SubtitleSegment[], withTimestamps = true): string {
  if (!withTimestamps) {
    return subtitles.map((s) => s.text.trim()).join('\n\n');
  }

  return subtitles
    .map(
      (s) =>
        `[${formatDisplayTime(s.start)} - ${formatDisplayTime(s.end)}] ${
          s.speaker ? s.speaker + ': ' : ''
        }${s.text.trim()}`
    )
    .join('\n\n');
}

/**
 * Production-grade resilient parser for .SRT and .VTT files.
 * Handles:
 * - UTF-8 BOM (\uFEFF)
 * - Non-standard timestamp formats (single-digit hours, 1/2 digit ms, mm:ss)
 * - Trailing cue settings (position:50%, line:0)
 * - Windows (\r\n), Mac (\r), Linux (\n)
 * - Whitespace on empty lines
 * - HTML tags (<i>, <b>, <font>, etc.)
 */
export function parseSrtContent(
  rawContent: string,
  maxCharsPerLine?: number,
  maxLines?: number
): SubtitleSegment[] {
  if (!rawContent || typeof rawContent !== 'string') return [];

  // Remove UTF-8 BOM, zero-width spaces, and normalize line endings
  const cleanText = rawContent
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const lines = cleanText.split('\n');
  const segments: SubtitleSegment[] = [];

  const timeArrowRegex = /(?:^|\s)(?:(?:\d{1,3}:)?\d{1,2}:)?\d{1,2}(?:[,\.]\d{1,4})?\s*-->\s*(?:(?:\d{1,3}:)?\d{1,2}:)?\d{1,2}(?:[,\.]\d{1,4})?/;

  let currentStart = -1;
  let currentEnd = -1;
  let currentTextLines: string[] = [];
  let prevLine = '';

  const finalizeCurrentCue = () => {
    if (currentStart >= 0 && currentEnd >= currentStart) {
      let rawText = currentTextLines.join('\n').trim();
      // Clean HTML tags and SSA/ASS style tags
      rawText = rawText
        .replace(/<[^>]+>/g, '')
        .replace(/\{\\[^}]*\}/g, '')
        .trim();

      if (rawText) {
        // Extract speaker if present (e.g. "[Speaker 1]: text" or "Speaker 1: text")
        let speaker = 'Speaker 1';
        let displayText = rawText;
        const speakerMatch = rawText.match(/^(?:\[([^\]]+)\]|([^:\n]{2,30}):)\s*(.*)/s);
        if (speakerMatch) {
          speaker = (speakerMatch[1] || speakerMatch[2] || 'Speaker 1').trim();
          displayText = (speakerMatch[3] || '').trim();
          if (!displayText) {
            displayText = rawText;
          }
        }

        const idx = segments.length + 1;
        segments.push({
          id: idx,
          index: idx,
          start: Math.round(currentStart * 100) / 100,
          end: Math.round(Math.max(currentStart + 0.3, currentEnd) * 100) / 100,
          text: displayText,
          originalText: displayText,
          speaker,
        });
      }
    }
    currentStart = -1;
    currentEnd = -1;
    currentTextLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Check if this line is a timestamp line (contains "-->")
    if (trimmed.includes('-->') && timeArrowRegex.test(trimmed)) {
      // Finalize previous cue if any
      finalizeCurrentCue();

      const parts = trimmed.split('-->');
      if (parts.length >= 2) {
        const leftTokens = parts[0].trim().split(/\s+/);
        const rightTokens = parts[1].trim().split(/\s+/);

        const startStr = leftTokens[leftTokens.length - 1];
        const endStr = rightTokens[0];

        const s = parseSubtitleTime(startStr);
        const e = parseSubtitleTime(endStr);

        if (s !== null && e !== null) {
          currentStart = s;
          currentEnd = e;
          prevLine = trimmed;
          continue;
        }
      }
    }

    // If we have an active cue timing, collect text lines
    if (currentStart >= 0) {
      if (trimmed === '') {
        // Blank line: check if next non-empty line starts a new cue
        let nextIsCue = false;
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const nextTrimmed = lines[j].trim();
          if (!nextTrimmed) continue;
          if (nextTrimmed.includes('-->') || /^\d+$/.test(nextTrimmed)) {
            nextIsCue = true;
          }
          break;
        }
        if (nextIsCue) {
          finalizeCurrentCue();
        } else if (currentTextLines.length > 0) {
          currentTextLines.push('');
        }
      } else {
        // Ignore standalone index numbers if next line is a timestamp
        if (/^\d+$/.test(trimmed) && i + 1 < lines.length && lines[i + 1].includes('-->')) {
          finalizeCurrentCue();
        } else {
          currentTextLines.push(trimmed);
        }
      }
    }

    prevLine = trimmed;
  }

  // Finalize last cue
  finalizeCurrentCue();

  // If maxCharsPerLine is provided and segment lines exceed it, format politely
  if (maxCharsPerLine && segments.length > 0) {
    return enforceSubtitleConstraints(segments, maxCharsPerLine, maxLines || 2);
  }

  return segments;
}

export function downloadBlob(content: string | Blob, filename: string, mimeType: string): void {
  let blob: Blob;
  if (typeof content === 'string') {
    // Prepend UTF-8 BOM (\uFEFF) to guarantee correct Bengali / Unicode rendering in VLC, Windows Notepad, and Video Editors
    const hasBom = content.charCodeAt(0) === 0xFEFF;
    const finalContent = hasBom ? content : '\uFEFF' + content;
    blob = new Blob([finalContent], { type: `${mimeType};charset=utf-8;` });
  } else {
    blob = content;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function splitTextToBlocks(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length <= maxChars) {
      currentLine = currentLine ? currentLine + ' ' + word : word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  const blocks: string[] = [];
  for (let i = 0; i < lines.length; i += maxLines) {
    const chunkLines = lines.slice(i, i + maxLines);
    blocks.push(chunkLines.join('\n'));
  }
  return blocks.length > 0 ? blocks : [text];
}
