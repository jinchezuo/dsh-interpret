import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const BASE_URL = 'https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26/resolve/main/'

/** Apache-2.0 English streaming zipformer (int8, chunk-16-left-128). */
export const STREAMING_ASSETS = [
  { name: 'encoder.int8.onnx', remote: 'encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx', bytes: 71083163, sha256: '563fde436d16cf7607cf408cd6b30909819d03162652ef389c2450ced3f45ac1' },
  { name: 'decoder.int8.onnx', remote: 'decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx', bytes: 1307236, sha256: '98da299f471e38bb4e1a8df579b8cc9122d6039576a77e357b3c60f17dd83b02' },
  { name: 'joiner.int8.onnx', remote: 'joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx', bytes: 259335, sha256: 'd944208d660d67c8d72cd2acaeac971fa5ceb8c80e76c1968148846fedd6e297' },
  { name: 'tokens.txt', remote: 'tokens.txt', bytes: 5048, sha256: '49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb' },
]

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function hasAssets(dir) {
  if (!dir) return false
  for (const asset of STREAMING_ASSETS) {
    try {
      const info = await stat(join(dir, asset.name))
      if (!info.isFile() || info.size !== asset.bytes) return false
    } catch {
      return false
    }
  }
  return true
}

/** Resolve the development cache or the per-profile model directory. */
export async function findStreamingModel(dataDir, customDir = '') {
  const candidates = []
  const custom = String(customDir || '').trim()
  if (custom) candidates.push(resolve(custom))
  candidates.push(join(PACKAGE_ROOT, '.models', 'streaming-en'))
  candidates.push(join(dataDir, 'models', 'streaming-en'))
  for (const candidate of candidates) {
    if (await hasAssets(candidate)) return candidate
  }
  return null
}

async function downloadFile(asset, destination, { signal, onBytes }) {
  const response = await fetch(BASE_URL + asset.remote, { signal })
  if (!response.ok || !response.body) throw new Error('流式模型下载失败 HTTP ' + response.status + '：' + asset.name)
  const temp = destination + '.part-' + process.pid
  const handle = await open(temp, 'w')
  let written = 0
  try {
    for await (const chunk of response.body) {
      signal?.throwIfAborted()
      await handle.write(chunk)
      written += chunk.length
      onBytes?.(written)
    }
  } finally {
    await handle.close()
  }
  if (written !== asset.bytes) {
    await rm(temp, { force: true })
    throw new Error('流式模型大小不符：' + asset.name + '（' + written + '/' + asset.bytes + '）')
  }
  const digest = await sha256File(temp)
  if (digest !== asset.sha256) {
    await rm(temp, { force: true })
    throw new Error('流式模型 SHA-256 校验失败：' + asset.name)
  }
  await rename(temp, destination)
}

/** Download and verify the streaming model into the plugin data directory. */
export async function ensureStreamingModel(dataDir, { signal, onProgress } = {}) {
  const target = join(dataDir, 'models', 'streaming-en')
  await mkdir(target, { recursive: true })
  const total = STREAMING_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0)
  let completed = 0
  for (const asset of STREAMING_ASSETS) {
    const destination = join(target, asset.name)
    let reusable = false
    try {
      const info = await stat(destination)
      if (info.size === asset.bytes) reusable = (await sha256File(destination)) === asset.sha256
    } catch {}
    if (reusable) {
      completed += asset.bytes
      onProgress?.(completed, total, asset.name)
      continue
    }
    await downloadFile(asset, destination, {
      signal,
      onBytes: (bytes) => onProgress?.(completed + bytes, total, asset.name),
    })
    completed += asset.bytes
    onProgress?.(completed, total, asset.name)
  }
  return target
}

/** Streaming text is uppercase from this model; make it readable without touching the final ASR. */
export function normalizeLiveText(text) {
  const value = String(text || '').trim()
  if (!value) return ''
  if (value !== value.toUpperCase()) return value
  const lower = value.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/**
 * Thin wrapper around sherpa-onnx OnlineRecognizer. One model, one stream per
 * track. The final transcript still comes from the offline Parakeet model.
 */
export class StreamingAsr {
  constructor({ dataDir, modelDir = '', log }) {
    this.dataDir = dataDir
    this.modelDir = modelDir
    this.log = log
    this.recognizer = null
    this.streams = { mic: null, system: null }
    this.loading = null
    this.directory = null
    this.failed = null
    this.lastText = { mic: '', system: '' }
  }

  get ready() {
    return Boolean(this.recognizer && this.streams.mic && this.streams.system)
  }

  async load() {
    if (this.ready) return true
    if (this.loading) return this.loading
    this.loading = (async () => {
      try {
        this.directory = await findStreamingModel(this.dataDir, this.modelDir)
        if (!this.directory) {
          this.failed = '流式模型未下载'
          return false
        }
        const imported = await import('sherpa-onnx-node')
        const sherpa = imported.OnlineRecognizer ? imported : imported.default
        if (typeof sherpa?.OnlineRecognizer !== 'function') throw new Error('sherpa-onnx-node 未提供 OnlineRecognizer')
        this.recognizer = new sherpa.OnlineRecognizer({
          featConfig: { sampleRate: 16000, featureDim: 80 },
          modelConfig: {
            transducer: {
              encoder: join(this.directory, 'encoder.int8.onnx'),
              decoder: join(this.directory, 'decoder.int8.onnx'),
              joiner: join(this.directory, 'joiner.int8.onnx'),
            },
            tokens: join(this.directory, 'tokens.txt'),
            numThreads: 2,
            provider: 'cpu',
            debug: 0,
          },
        })
        this.streams.mic = this.recognizer.createStream()
        this.streams.system = this.recognizer.createStream()
        this.failed = null
        this.log?.info('streaming model loaded:', this.directory)
        return true
      } catch (error) {
        this.failed = String(error?.message || error)
        this.log?.warn('streaming model load failed:', this.failed)
        return false
      } finally {
        this.loading = null
      }
    })()
    return this.loading
  }

  feed(track, samples) {
    const stream = this.streams[track === 'system' ? 'system' : 'mic']
    if (!stream || !samples?.length) return false
    try {
      stream.acceptWaveform({ sampleRate: 16000, samples })
      return true
    } catch (error) {
      this.failed = String(error?.message || error)
      return false
    }
  }

  poll(track) {
    const key = track === 'system' ? 'system' : 'mic'
    const stream = this.streams[key]
    if (!this.recognizer || !stream) return ''
    try {
      let guard = 0
      while (this.recognizer.isReady(stream) && guard < 20) {
        this.recognizer.decode(stream)
        guard += 1
      }
      const result = this.recognizer.getResult(stream)
      const text = normalizeLiveText(result?.text)
      if (text === this.lastText[key]) return ''
      this.lastText[key] = text
      return text
    } catch (error) {
      this.failed = String(error?.message || error)
      return ''
    }
  }

  reset(track) {
    const key = track === 'system' ? 'system' : 'mic'
    try {
      if (this.recognizer && this.streams[key]) this.recognizer.reset(this.streams[key])
    } catch {}
    this.lastText[key] = ''
  }

  dispose() {
    try { this.recognizer?.free?.() } catch {}
    this.recognizer = null
    this.streams = { mic: null, system: null }
  }
}
