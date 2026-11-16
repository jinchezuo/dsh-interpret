import { encodeWav } from './audio.js'
import { ParakeetClient, PARAKEET_ID } from './parakeet.js'

/** Thin adapter over the official ctx.speechToText registry plus the local Parakeet engine. */
export class AsrClient {
  constructor(ctx, config, log, dataDir) {
    this.ctx = ctx
    this.config = config
    this.log = log
    this.parakeet = new ParakeetClient({ dataDir, config, log })
    setTimeout(() => { this.parakeet.inspect().catch(() => {}) }, 0)
  }

  /** Local English engine exposed alongside the official providers. */
  parakeetProvider() {
    return {
      id: PARAKEET_ID,
      name: 'Parakeet TDT 0.6B v2 (EN, 学术/低延迟)',
      location: 'host-local',
      languages: ['en'],
      preparation: this.parakeet.snapshot(),
    }
  }

  service() {
    try {
      return this.ctx.get('speechToText') || null
    } catch {
      return null
    }
  }

  snapshot() {
    const service = this.service()
    if (!service) return null
    try {
      return service.snapshot()
    } catch {
      return null
    }
  }

  allProviders(snapshot = this.snapshot()) {
    const official = (snapshot?.providers || []).map((provider) => ({
      id: provider.id,
      name: provider.name,
      languages: provider.languages,
      preparation: provider.preparation,
    }))
    const local = this.parakeetProvider()
    return official.some((provider) => provider.id === local.id) ? official : [...official, local]
  }

  /** Prefer the configured provider; otherwise the first English-capable one. */
  pickProvider(snapshot = this.snapshot()) {
    const providers = this.allProviders(snapshot)
    const configured = this.config.asrProvider
    const wanted = providers.find((provider) => provider.id === configured)
    if (wanted) return wanted
    return providers.find((provider) =>
      Array.isArray(provider.languages) &&
      (provider.languages.includes('en') || provider.languages.includes('auto'))) || null
  }

  describe() {
    const snapshot = this.snapshot()
    const picked = this.pickProvider(snapshot)
    return {
      available: Boolean(this.service()) || Boolean(picked),
      picked: picked ? { id: picked.id, name: picked.name, preparation: picked.preparation } : null,
      providers: this.allProviders(snapshot),
    }
  }

  async prepare(providerId, options = {}) {
    const id = providerId || this.config.asrProvider
    if (id === PARAKEET_ID) {
      await this.parakeet.prepare()
      return this.parakeetProvider()
    }
    const service = this.service()
    if (!service) throw Object.assign(new Error('DSH 语音服务不可用'), { code: 'ASR_UNAVAILABLE' })
    service.prepare(id)
    return this.waitForReady(id, options)
  }

  /** Poll provider preparation until ready, failed, or timed out. */
  async waitForReady(providerId, { timeoutMs = 30 * 60 * 1000, onProgress } = {}) {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const snapshot = this.snapshot()
      const provider = (snapshot?.providers || []).find((item) => item.id === providerId) || this.pickProvider(snapshot)
      const phase = provider?.preparation?.phase
      onProgress?.(provider?.preparation || { phase: 'unknown' })
      if (phase === 'ready') return provider
      if (phase === 'failed') {
        throw Object.assign(new Error(provider.preparation.message || '模型准备失败'), { code: 'ASR_PREPARE_FAILED' })
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    throw Object.assign(new Error('模型准备超时'), { code: 'ASR_PREPARE_TIMEOUT' })
  }

  async transcribe(samples) {
    const snapshot = this.snapshot()
    const provider = this.pickProvider(snapshot)
    if (!provider) throw Object.assign(new Error('没有可用的语音识别模型'), { code: 'ASR_NO_PROVIDER' })
    if (provider.id === PARAKEET_ID) {
      return await this.parakeet.transcribe(samples)
    }
    const service = this.service()
    if (!service) throw Object.assign(new Error('DSH 语音服务不可用'), { code: 'ASR_UNAVAILABLE' })
    if (provider.preparation?.phase !== 'ready') {
      throw Object.assign(new Error('语音模型尚未准备完成'), { code: 'ASR_NOT_READY', provider: provider.id })
    }
    const language = provider.languages?.includes(this.config.language) ? this.config.language : 'en'
    const audio = encodeWav(samples)
    const startedAt = Date.now()
    try {
      const spec = service.resolve({ audio, providerId: provider.id, language })
      const result = await service.transcribe(spec, AbortSignal.timeout(30_000))
      return {
        text: String(result.text || '').trim(),
        provider: provider.id,
        ms: Date.now() - startedAt,
      }
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { code: error?.code || 'ASR_FAILED' })
    }
  }

  dispose() {
    this.parakeet.dispose()
  }
}
