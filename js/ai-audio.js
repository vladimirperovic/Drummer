export function encodeAiWav(channels, sampleRate = 44100) {
  if (!channels?.length || channels.length > 2 || channels.some(c => !(c instanceof Float32Array) || c.length !== channels[0].length)) throw new Error('Neispravan audio.');
  const frames = channels[0].length, count = channels.length, buffer = new ArrayBuffer(44 + frames * count * 2), view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, count, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true); view.setUint16(32, count * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, buffer.byteLength - 44, true);
  for (let frame = 0, offset = 44; frame < frames; frame++) for (const channel of channels) {
    const value = Math.max(-1, Math.min(1, channel[frame] || 0)); view.setInt16(offset, Math.round(value * (value < 0 ? 32768 : 32767)), true); offset += 2;
  }
  return buffer;
}

export async function decodeAiAudio(file, { signal } = {}) {
  if (!file || file.size > 100 * 1024 * 1024 || !file.size) throw new Error('Izaberi audio fajl do 100 MB.');
  const url = URL.createObjectURL(file), media = new Audio(); media.preload = 'metadata';
  try {
    await new Promise((resolve, reject) => {
      const finish = error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); media.onloadedmetadata = media.onerror = null; error ? reject(error) : resolve(); };
      const abort = () => finish(new DOMException('Aborted', 'AbortError'));
      const timer = setTimeout(() => finish(new Error('Browser ne može da pročita ovaj audio fajl.')), 15000);
      media.onloadedmetadata = () => finish(); media.onerror = () => finish(new Error('Browser ne može da pročita ovaj audio fajl.'));
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) return abort(); media.src = url;
    });
    if (!Number.isFinite(media.duration) || media.duration < .05 || media.duration > 600) throw new Error('Za AI izaberi snimak od 0,05 sekundi do 10 minuta.');
  } finally { media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url); }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) throw new Error('Browser ne može da pročita ovaj audio fajl.');
  const context = new Context({ sampleRate: 44100 });
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (buffer.duration > 600 || buffer.numberOfChannels > 2) throw new Error('AI podržava mono ili stereo snimak do 10 minuta.');
    return buffer;
  } finally { await context.close().catch(() => {}); }
}

export function aiAudioBuffer(channels, sampleRate = 44100) {
  const buffer = new AudioBuffer({ length: channels[0].length, numberOfChannels: channels.length, sampleRate });
  channels.forEach((channel, index) => buffer.copyToChannel(channel, index)); return buffer;
}
