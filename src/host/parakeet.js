import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const BASE_URL = 'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/main/'

/** Pinned English academic recognizer: Parakeet TDT 0.6B v2 (int8). */
export const PARAKEET_ID = 'parakeet-local'

const ASSETS = [
  { name: 'encoder.int8.onnx', bytes: 652282309, sha256: '92a10bd9c23936ea0566c29f963bc57c2a5df4261b6a8921c39abea66557ca8b' },
  { name: 'decoder.int8.onnx', bytes: 7257753, sha256: '4d097bae3bac5c96018d5293ba39f1b657296102b142affda40378f38b020f41' },
  { name: 'joiner.int8.onnx', bytes: 1739080, sha256: '77a29f3e5ac7d37074e0af465391b80f314015d5b97f0f90c6c7767f1d56f428' },
  { name: 'tokens.txt', bytes: 9384, sha256: 'ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d' },
]

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function hasAssets(dir) {
  for (const asset of ASSETS) {
    try {
      const info = await stat(join(dir, asset.name))
      if (!info.isFile() || info.size < asset.bytes * 0.9) return false
    } catch {
      return false
    }
  }
  return true
}

/** Model lifecycle plus lazy CPU inference for the English Parakeet recognizer. */
export class ParakeetClient {
  constructor({ dataDir, config, log }) {
    this.dataDir = dataDir
    this.config = config
    this.log = log
    this.downloadDir = join(dataDir, 'models', 'parakeet')
    this.modelDir = null
    this.state = { phase: 'unprepared' }
    this.listeners = new Set()
    this.recognizer = null
    this.loading = null
    this.controller = null
    this.prepareTask = null
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit() {
    for (const listener of this.listeners) {
      try { listener() } catch {}
    }
  }

  setState(state) {
    this.state = { ...state }
    this.emit()
  }

  async inspect() {
    const candidates = []
    const configured = String(this.config.asrModelDir || '').trim()
    if (configured) candidates.push(resolve(configured))
    candidates.push(join(PACKAGE_ROOT, '.models', 'parakeet'))
    candidates.push(this.downloadDir)
    for (const candidate of candidates) {
      if (await hasAssets(candidate)) {
        this.modelDir = candidate
        if (this.state.phase !== 'ready') this.setState({ phase: 'ready', directory: candidate })
        return this.state
      }
    }
    this.modelDir = null
    if (this.state.phase === 'downloading' || this.state.phase === 'loading') return this.state
    if (this.state.phase === 'failed') return this.state
    this.setState({ phase: 'unprepared' })
    return this.state
  }

  snapshot() {
    return this.state
  }

  async prepare() {
    if (this.prepareTask) return this.prepareTask
    this.prepareTask = (async () => {
      await this.inspect()
      if (this.state.phase === 'ready') return this.state
      const target = this.downloadDir
      await mkdir(target, { recursive: true })
      const controller = new AbortController()
      this.controller = controller
      try {
        let total = ASSETS.reduce((sum, asset) => sum + asset.bytes, 0)
        let completed = 0
        this.setState({ phase: 'checking', startedAt: Date.now() })
        for (const asset of ASSETS) {
          const destination = join(target, asset.name)
          if (await this.fileMatches(destination, asset)) {
            completed += asset.bytes
            this.progress(completed, total, asset.name)
            continue
          }
          this.setState({ phase: 'downloading', resource: asset.name, completedBytes: completed, totalBytes: total })
          await this.download(asset, destination, {
            signal: controller.signal,
            onBytes: (bytes) => this.progress(completed + bytes, total, asset.name),
          })
          completed += asset.bytes
          this.progress(completed, total, asset.name)
        }
        this.setState({ phase: 'loading', startedAt: Date.now() })
        this.modelDir = target
        await this.loadRecognizer()
        this.setState({ phase: 'ready', directory: target })
        return this.state
      } catch (error) {
        if (controller.signal.aborted) {
          this.setState({ phase: 'cancelled' })
        } else {
          this.log?.error('parakeet prepare failed:', error?.message || error)
          this.setState({ phase: 'failed', message: String(error?.message || error) })
        }
        return this.state
      } finally {
        this.controller = null
        this.prepareTask = null
      }
    })()
    return this.prepareTask
  }

  progress(completedBytes, totalBytes, resource) {
    this.setState({ phase: 'downloading', resource, completedBytes, totalBytes })
  }

  async cancel() {
    this.controller?.abort()
    await this.prepareTask?.catch(() => {})
  }

  async fileMatches(path, asset) {
    try {
      const info = await stat(path)
      if (info.size !== asset.bytes) return false
      return (await sha256File(path)) === asset.sha256
    } catch {
      return false
    }
  }

  async download(asset, destination, { signal, onBytes }) {
    const response = await fetch(BASE_URL + asset.name, { signal })
    if (!response.ok || !response.body) throw new Error('下载失败 HTTP ' + response.status + '：' + asset.name)
    const total = Number(response.headers.get('content-length')) || asset.bytes
    const temp = destination + '.part-' + process.pid
    const handle = await open(temp, 'w')
    let written = 0
    try {
      for await (const chunk of response.body) {
        signal.throwIfAborted()
        await handle.write(chunk)
        written += chunk.length
        onBytes?.(written)
      }
    } finally {
      await handle.close()
    }
    if (written !== asset.bytes) {
      await rm(temp, { force: true })
      throw new Error('文件大小不符：' + asset.name + '（' + written + '/' + asset.bytes + '）')
    }
    const digest = await sha256File(temp)
    if (digest !== asset.sha256) {
      await rm(temp, { force: true })
      throw new Error('SHA-256 校验失败：' + asset.name)
    }
    await rename(temp, destination)
    this.log?.info('parakeet asset ready:', asset.name, total)
  }

  async loadRecognizer() {
    if (this.recognizer) return this.recognizer
    if (this.loading) return this.loading
    this.loading = (async () => {
      if (!this.modelDir) {
        if (!(await hasAssets(this.downloadDir))) throw new Error('Parakeet 模型文件不存在')
        this.modelDir = this.downloadDir
      }
      const imported = await import('sherpa-onnx-node')
      const sherpa = imported.OfflineRecognizer ? imported : imported.default
      const OfflineRecognizer = sherpa?.OfflineRecognizer
      if (typeof OfflineRecognizer !== 'function') throw new Error('sherpa-onnx-node 未提供 OfflineRecognizer')
      this.recognizer = new OfflineRecognizer({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          transducer: {
            encoder: join(this.modelDir, 'encoder.int8.onnx'),
            decoder: join(this.modelDir, 'decoder.int8.onnx'),
            joiner: join(this.modelDir, 'joiner.int8.onnx'),
          },
          tokens: join(this.modelDir, 'tokens.txt'),
          numThreads: 4,
          provider: 'cpu',
          debug: 0,
        },
      })
      return this.recognizer
    })().finally(() => { this.loading = null })
    return this.loading
  }

  async transcribe(samples) {
    if (this.state.phase !== 'ready' && !this.recognizer) {
      await this.inspect()
      if (this.state.phase !== 'ready') throw Object.assign(new Error('Parakeet 模型尚未准备完成'), { code: 'ASR_NOT_READY' })
    }
    const recognizer = await this.loadRecognizer()
    const startedAt = Date.now()
    const stream = recognizer.createStream()
    try {
      stream.acceptWaveform({ sampleRate: 16000, samples })
      recognizer.decode(stream)
      const text = String(recognizer.getResult(stream).text || '').trim()
      return { text, ms: Date.now() - startedAt, provider: PARAKEET_ID }
    } finally {
      try { stream.free?.() } catch {}
    }
  }

  dispose() {
    this.controller?.abort()
    try { this.recognizer?.free?.() } catch {}
    this.recognizer = null
    this.listeners.clear()
  }
}
