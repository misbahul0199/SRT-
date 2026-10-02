// Utility to convert AudioBuffer into a standard 16-bit PCM WAV Blob
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = 1;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  // Get mono channel data (if stereo, mix down to mono)
  let channelData: Float32Array;
  if (buffer.numberOfChannels === 1) {
    channelData = buffer.getChannelData(0);
  } else {
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    channelData = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      channelData[i] = (left[i] + right[i]) / 2;
    }
  }

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataByteLength = channelData.length * bytesPerSample;
  const bufferLength = 44 + dataByteLength;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeString(view, 8, 'WAVE');

  // 'fmt ' chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // SubChunk1Size
  view.setUint16(20, format, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // ByteRate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  // 'data' chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);

  // Write PCM 16-bit samples
  let offset = 44;
  for (let i = 0; i < channelData.length; i++) {
    const sample = Math.max(-1, Math.min(1, channelData[i]));
    // Scale to 16-bit signed integer
    const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Optimizes an uploaded audio/video file for AI transcription by extracting audio
 * and downsampling to 16kHz mono WAV if necessary.
 * This keeps the upload size tiny (< 5MB for minutes of speech) and avoids 413 / timeout errors.
 */
export async function prepareAudioForAI(
  file: File,
  onProgress?: (msg: string) => void
): Promise<{ base64: string; mimeType: string }> {
  // If already an audio file and smaller than 8MB, directly use it
  if (file.type.startsWith('audio/') && file.size < 8 * 1024 * 1024) {
    if (onProgress) onProgress('অডিও ফাইল প্রস্তুত করা হচ্ছে...');
    const base64 = await blobToBase64(file);
    return { base64, mimeType: file.type || 'audio/mp3' };
  }

  // If it's a video or large audio, extract & downsample audio track via Web Audio API
  try {
    if (onProgress) onProgress('ভিডিও থেকে হালকা অডিও ট্র্যাক অপটিমাইজ করা হচ্ছে...');
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('AudioContext not available');
    }

    const arrayBuffer = await file.arrayBuffer();
    const audioCtx = new AudioContextClass();
    const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    const targetSampleRate = 16000; // 16kHz is ideal for speech models
    const targetLength = Math.max(1, Math.round(decodedBuffer.duration * targetSampleRate));

    const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = decodedBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
    audioCtx.close();

    const wavBlob = audioBufferToWav(renderedBuffer);
    const wavBase64 = await blobToBase64(wavBlob);

    return {
      base64: wavBase64,
      mimeType: 'audio/wav',
    };
  } catch (err) {
    console.warn('Web Audio downsample fallback to standard file base64:', err);
    const base64 = await blobToBase64(file);
    return {
      base64,
      mimeType: file.type || 'audio/mp3',
    };
  }
}
