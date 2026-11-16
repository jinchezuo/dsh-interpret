/** 16 kHz mono PCM16 helpers and an energy VAD/segmenter. */

/** Convert little-endian PCM16 bytes to Float32 samples in [-1, 1]. */
export function pcm16ToFloat32(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const frames = Math.floor(buffer.byteLength / 2)
  const out = new Float32Array(frames)
  for (let i = 0; i < frames; i += 1) out[i] = view.getInt16(i * 2, true) / 32768
  return out
}

/** Convert Float32 samples to little-endian PCM16. */
export function float32ToPcm16(samples) {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]))
    out[i] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767)
  }
  return out
}

/** Encode Float32 samples as a 16 kHz mono PCM16 WAV. */
export function encodeWav(samples, sampleRate = 16000) {
  const data = float32ToPcm16(samples)
  const buffer = Buffer.alloc(44 + data.length * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + data.length * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(data.length * 2, 40)
  for (let i = 0; i < data.length; i += 1) buffer.writeInt16LE(data[i], 44 + i * 2)
  return buffer
}

/** Root-mean-square amplitude of one frame. */
export function rms(samples) {
  if (!samples.length) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

/** Linear resample to 16 kHz for devices that ignore the requested rate. */
export function resampleTo16k(samples, inputRate, outputRate = 16000) {
  if (inputRate === outputRate || !samples.length) return samples
  const ratio = inputRate / outputRate
  const length = Math.max(1, Math.floor(samples.length / ratio))
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio
    const index = Math.floor(position)
    const next = Math.min(index + 1, samples.length - 1)
    const fraction = position - index
    out[i] = samples[index] * (1 - fraction) + samples[next] * fraction
  }
  return out
}

/**
 * Energy-gated segmenter over a continuous sample stream. It keeps a pre-roll
 * window so the first syllable is not clipped, and emits one Float32 buffer per
 * speech run. This is the Phase-0 replacement for Silero VAD.
 */
export class EnergySegmenter {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || 16000
    this.threshold = options.threshold ?? 0.008
    this.minSpeechMs = options.minSpeechMs ?? 350
    this.silenceMs = options.silenceMs ?? 500
    this.maxSegmentMs = options.maxSegmentMs ?? 12000
    this.preRollMs = options.preRollMs ?? 300
    this.frameMs = 20
    this.frameSamples = Math.round((this.sampleRate * this.frameMs) / 1000)
    this.onSegment = options.onSegment || (() => {})
    this.noiseFloor = 0
    this.noiseFrames = 0
    this.pending = new Float32Array(0)
    this.ring = []
    this.ringStart = 0
    this.ringEnd = 0
    this.totalSamples = 0
    this.inSpeech = false
    this.speechStart = 0
    this.lastVoiceEnd = 0
    this.speechSamples = 0
    this.dropped = 0
  }

  /** Push mono 16 kHz samples; segmentation runs on whole 20 ms frames. */
  push(samples) {
    if (!samples.length) return
    const merged = new Float32Array(this.pending.length + samples.length)
    merged.set(this.pending, 0)
    merged.set(samples, this.pending.length)
    let offset = 0
    while (merged.length - offset >= this.frameSamples) {
      this.consumeFrame(merged.subarray(offset, offset + this.frameSamples))
      offset += this.frameSamples
    }
    this.pending = merged.slice(offset)
    this.trimRing()
  }

  consumeFrame(frame) {
    const startSample = this.totalSamples
    this.totalSamples += frame.length
    this.appendRing(frame)
    const level = rms(frame)
    if (!this.inSpeech) {
      if (level < this.effectiveThreshold()) {
        this.noiseFrames += 1
        this.noiseFloor = this.noiseFloor * 0.985 + level * 0.015
        return
      }
      this.inSpeech = true
      this.speechStart = startSample
      this.lastVoiceEnd = this.totalSamples
      this.speechSamples = frame.length
      return
    }
    if (level >= this.effectiveThreshold() * 0.65) this.lastVoiceEnd = this.totalSamples
    this.speechSamples += frame.length
    const silentMs = ((this.totalSamples - this.lastVoiceEnd) / this.sampleRate) * 1000
    const speechMs = ((this.totalSamples - this.speechStart) / this.sampleRate) * 1000
    if (silentMs >= this.silenceMs || speechMs >= this.maxSegmentMs) this.finish()
  }

  effectiveThreshold() {
    if (this.noiseFrames < 25) return this.threshold
    return Math.min(0.05, Math.max(this.threshold, this.noiseFloor * 3.2))
  }

  finish() {
    if (!this.inSpeech) return
    const start = Math.max(0, this.speechStart - Math.round((this.preRollMs / 1000) * this.sampleRate))
    const end = this.lastVoiceEnd
    const samples = this.sliceRing(start, end)
    this.inSpeech = false
    this.speechSamples = 0
    const speechMs = ((end - start) / this.sampleRate) * 1000
    if (speechMs < this.minSpeechMs) {
      this.dropped += 1
      return
    }
    this.onSegment({
      samples,
      startMs: Math.round((start / this.sampleRate) * 1000),
      endMs: Math.round((end / this.sampleRate) * 1000),
    })
  }

  /** Snapshot the speech currently in flight, capped for a draft recognition pass. */
  active(maxSeconds = 8) {
    if (!this.inSpeech) return null
    const end = this.totalSamples
    const start = Math.max(0, this.speechStart - Math.round((this.preRollMs / 1000) * this.sampleRate))
    const all = this.sliceRing(start, end)
    if (all.length < this.sampleRate * 0.6) return null
    const keep = Math.min(all.length, Math.round(this.sampleRate * maxSeconds))
    const samples = all.subarray(all.length - keep)
    const startMs = Math.round(((end - keep) / this.sampleRate) * 1000)
    return { samples, startMs, endMs: Math.round((end / this.sampleRate) * 1000) }
  }

  /** Flush any in-flight speech immediately (session stop). */
  flush() {
    if (this.inSpeech) this.finish()
  }

  appendRing(frame) {
    this.ring.push({ start: this.totalSamples - frame.length, data: frame })
    this.ringEnd = this.totalSamples
  }

  sliceRing(startSample, endSample) {
    const parts = []
    for (const chunk of this.ring) {
      const from = Math.max(chunk.start, startSample)
      const to = Math.min(chunk.start + chunk.data.length, endSample)
      if (to <= from) continue
      parts.push(chunk.data.subarray(from - chunk.start, to - chunk.start))
    }
    const length = parts.reduce((sum, part) => sum + part.length, 0)
    const out = new Float32Array(length)
    let offset = 0
    for (const part of parts) {
      out.set(part, offset)
      offset += part.length
    }
    return out
  }

  trimRing() {
    const keepFrom = Math.max(0, this.totalSamples - Math.round(((this.maxSegmentMs + 3000) / 1000) * this.sampleRate))
    while (this.ring.length && this.ring[0].start + this.ring[0].data.length <= keepFrom) this.ring.shift()
  }

  reset() {
    this.pending = new Float32Array(0)
    this.ring = []
    this.totalSamples = 0
    this.inSpeech = false
    this.lastVoiceEnd = 0
    this.speechSamples = 0
    this.dropped = 0
    this.noiseFrames = 0
    this.noiseFloor = 0
  }
}

/** Decode a PCM16 mono/stereo WAV into mono Float32 samples at 16 kHz. */
export function decodeWav(buffer) {
  if (!buffer || buffer.byteLength < 44) throw new Error('WAV 文件过短')
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  if (view.getUint32(0, false) !== 0x52494646) throw new Error('不是 RIFF/WAV 文件')
  let offset = 12
  let format = null
  let dataOffset = -1
  let dataLength = 0
  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3))
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      format = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      }
    } else if (id === 'data') {
      dataOffset = body
      dataLength = Math.min(size, view.byteLength - body)
      break
    }
    offset = body + size + (size % 2)
  }
  if (!format || dataOffset < 0) throw new Error('WAV 缺少 fmt/data 块')
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) throw new Error('只支持 PCM16 WAV')
  const channels = Math.max(1, format.channels)
  const frames = Math.floor(dataLength / 2 / channels)
  const out = new Float32Array(frames)
  for (let i = 0; i < frames; i += 1) {
    let sum = 0
    for (let channel = 0; channel < channels; channel += 1) sum += view.getInt16(dataOffset + (i * channels + channel) * 2, true) / 32768
    out[i] = sum / channels
  }
  if (format.sampleRate !== 16000) {
    return { samples: resampleTo16k(out, format.sampleRate), sampleRate: format.sampleRate, channels }
  }
  return { samples: out, sampleRate: format.sampleRate, channels }
}

