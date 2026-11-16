import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** Find a Silero VAD model in the dev cache or the plugin data directory. */
export function resolveVadModel(dataDir) {
  const candidates = [
    join(PACKAGE_ROOT, '.models', 'sensevoice', 'silero_vad.onnx'),
    join(PACKAGE_ROOT, '.models', 'vad', 'silero_vad.onnx'),
    join(dataDir, 'models', 'silero_vad.onnx'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) || null
}

/**
 * Silero-backed segmenter with the same push/flush/active/reset surface as
 * EnergySegmenter. It is used when a model is available; otherwise the service
 * falls back to the energy segmenter.
 */
export class SileroSegmenter {
  constructor({ dataDir, threshold = 0.5, minSpeechMs = 250, silenceMs = 300, maxSegmentMs = 12000, preRollMs = 500, postRollMs = 0, onSegment }) {
    const model = resolveVadModel(dataDir)
    if (!model) throw Object.assign(new Error('Silero VAD 模型不存在'), { code: 'VAD_MODEL_MISSING' })
    const require = createRequire(import.meta.url)
    const sherpa = require('sherpa-onnx-node')
    const Vad = sherpa.Vad
    if (typeof Vad !== 'function') throw new Error('sherpa-onnx-node 未提供 Vad')
    this.model = model
    this.sampleRate = 16000
    this.maxSegmentMs = maxSegmentMs
    this.preRollMs = preRollMs
    this.postRollMs = postRollMs
    this.onSegment = onSegment || (() => {})
    this.lastVoiceAt = 0
    this.noiseFloor = 0
    this.noiseFrames = 0
    this.vad = new Vad({
      sileroVad: {
        model,
        threshold,
        minSilenceDuration: silenceMs / 1000,
        minSpeechDuration: minSpeechMs / 1000,
        maxSpeechDuration: maxSegmentMs / 1000,
        windowSize: 512,
      },
      sampleRate: this.sampleRate,
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
    }, Math.ceil(maxSegmentMs / 1000) + 3)
    this.pending = new Float32Array(0)
    this.ring = []
    this.totalSamples = 0
    this.lastPush = 0
    this.dropped = 0
  }

  push(samples) {
    if (!samples.length) return
    this.lastPush = Date.now()
    let sum = 0
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
    const level = Math.sqrt(sum / samples.length)
    const threshold = Math.min(0.05, Math.max(0.006, this.noiseFloor * 3.2))
    if (level >= threshold) {
      this.lastVoiceAt = Date.now()
    } else {
      this.noiseFrames += 1
      this.noiseFloor = this.noiseFloor * 0.985 + level * 0.015
    }
    this.appendRing(samples)
    this.totalSamples += samples.length
    const merged = new Float32Array(this.pending.length + samples.length)
    merged.set(this.pending, 0)
    merged.set(samples, this.pending.length)
    let offset = 0
    while (merged.length - offset >= 512) {
      this.vad.acceptWaveform(merged.subarray(offset, offset + 512))
      offset += 512
    }
    this.pending = merged.slice(offset)
    this.drain()
    this.trimRing()
  }

  drain() {
    while (!this.vad.isEmpty()) {
      const segment = this.vad.front(false)
      const length = segment.samples.length
      const end = this.totalSamples
      const start = Math.max(0, end - length)
      const preRoll = this.sliceRing(Math.max(0, start - Math.round((this.preRollMs / 1000) * this.sampleRate)), start)
      const samples = new Float32Array(preRoll.length + length)
      samples.set(preRoll, 0)
      samples.set(segment.samples, preRoll.length)
      this.vad.pop()
      const startMs = Math.max(0, Math.round(((start - preRoll.length) / this.sampleRate) * 1000))
      const endMs = Math.round((end / this.sampleRate) * 1000)
      if (endMs - startMs >= 120) this.onSegment({ samples, startMs, endMs })
      else this.dropped += 1
    }
  }

  active(maxSeconds = 8) {
    if (Date.now() - this.lastPush > 800) return null
    if (!this.lastVoiceAt || Date.now() - this.lastVoiceAt > 900) return null
    if (this.totalSamples < this.sampleRate * 0.6) return null
    const start = Math.max(0, this.totalSamples - Math.round(this.sampleRate * maxSeconds))
    const samples = this.sliceRing(start, this.totalSamples)
    if (samples.length < this.sampleRate * 0.6) return null
    return { samples, startMs: Math.round((start / this.sampleRate) * 1000), endMs: Math.round((this.totalSamples / this.sampleRate) * 1000) }
  }

  flush() {
    try {
      this.vad.flush()
      this.drain()
    } catch {}
  }

  reset() {
    try { this.vad.reset() } catch {}
    this.pending = new Float32Array(0)
    this.ring = []
    this.totalSamples = 0
    this.lastPush = 0
    this.lastVoiceAt = 0
    this.noiseFloor = 0
    this.noiseFrames = 0
    this.dropped = 0
  }

  appendRing(samples) {
    this.ring.push({ start: this.totalSamples, data: new Float32Array(samples) })
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
    const keepFrom = Math.max(0, this.totalSamples - Math.round(((this.maxSegmentMs + 12000) / 1000) * this.sampleRate))
    while (this.ring.length && this.ring[0].start + this.ring[0].data.length <= keepFrom) this.ring.shift()
  }
}

/** Pinned Silero VAD asset (1.8 MB). */
export const VAD_ASSET = {
  name: 'silero_vad.onnx',
  bytes: 1807522,
  sha256: 'a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28',
  url: 'https://huggingface.co/csukuangfj/vad/resolve/fba88cd2e921609e7675c3aaf51e0b9b295da4bc/silero_vad.onnx',
}

/** Download the VAD model into the plugin data directory and verify its hash. */
export async function ensureVadModel(dataDir, { signal, onProgress } = {}) {
  const { mkdir, open, rename, rm, stat } = await import('node:fs/promises')
  const { createHash } = await import('node:crypto')
  const { createReadStream } = await import('node:fs')
  const dir = join(dataDir, 'models')
  const destination = join(dir, VAD_ASSET.name)
  const hashFile = async (path) => {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    return hash.digest('hex')
  }
  try {
    const info = await stat(destination)
    if (info.size === VAD_ASSET.bytes && (await hashFile(destination)) === VAD_ASSET.sha256) return destination
  } catch {}
  await mkdir(dir, { recursive: true })
  const response = await fetch(VAD_ASSET.url, { signal })
  if (!response.ok || !response.body) throw new Error('VAD 模型下载失败 HTTP ' + response.status)
  const temp = destination + '.part-' + process.pid
  const handle = await open(temp, 'w')
  let written = 0
  try {
    for await (const chunk of response.body) {
      signal?.throwIfAborted()
      await handle.write(chunk)
      written += chunk.length
      onProgress?.(written, VAD_ASSET.bytes)
    }
  } finally {
    await handle.close()
  }
  if (written !== VAD_ASSET.bytes || (await hashFile(temp)) !== VAD_ASSET.sha256) {
    await rm(temp, { force: true })
    throw new Error('VAD 模型校验失败')
  }
  await rename(temp, destination)
  return destination
}

