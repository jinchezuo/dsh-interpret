import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EnergySegmenter, pcm16ToFloat32 } from './audio.js'
import { AsrClient } from './asr.js'
import { Translator } from './translate.js'
import { Glossary } from './glossary.js'
import { qaTranslation, repairBlock } from './qa.js'
import { exportPayload } from './export.js'
import { SystemCapture } from './system-capture.js'
import { SileroSegmenter, ensureVadModel, resolveVadModel } from './silero-vad.js'
import { StreamingAsr, ensureStreamingModel, findStreamingModel, STREAMING_ASSETS } from './streaming-asr.js'
import { Terminology } from './terminology.js'
import { TermCorrector } from './term-corrector.js'
import { createLogger, errorPayload, toJsonLine, writeFileAtomic } from './util.js'
import { resolveDataDir } from './config.js'

const MAX_SEGMENTS_IN_MEMORY = 20000

function speechWords(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(Boolean)
}

/** Cheap near-duplicate test for the same utterance captured by both tracks. */
export function similarSpeech(a, b) {
  const left = speechWords(a)
  const right = speechWords(b)
  if (left.length < 3 || right.length < 3) return false
  const leftText = left.join(' ')
  const rightText = right.join(' ')
  if (leftText === rightText) return true
  if (leftText.length > 12 && rightText.length > 12 && (leftText.includes(rightText) || rightText.includes(leftText))) return true
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  let intersection = 0
  for (const word of leftSet) if (rightSet.has(word)) intersection += 1
  const union = leftSet.size + rightSet.size - intersection
  return union > 0 && intersection / union >= 0.8
}

function nowStamp() {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + '-' +
    pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds())
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Conservative English gate: reject CJK/Cyrillic output, fragments, repetition loops. */
export function isLikelyEnglish(text) {
  const value = String(text || '').trim()
  if (!value) return false
  const visible = [...value].filter((char) => /\S/.test(char))
  if (visible.length < 4) return false
  const latin = visible.filter((char) => /[A-Za-z]/.test(char)).length
  const cjk = visible.filter((char) => /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(char)).length
  if (cjk > 0 && cjk / visible.length > 0.1) return false
  if (latin / visible.length < 0.55) return false
  const words = value.split(/\s+/).filter(Boolean)
  if (words.length < 2) return false
  if (/(.)\1{5,}/.test(value.replace(/\s+/g, ''))) return false
  const compact = words.join(' ').toLowerCase()
  const repeated = /(\b\w+\b)( \1){3,}/.test(compact)
  if (repeated) return false
  return true
}

/** Partial streaming text is allowed to be one word; only reject obvious non-English. */
function isLiveEnglish(text) {
  const value = String(text || '').trim()
  if (!value) return false
  if (/[\u3400-\u9fff]/.test(value) && value.replace(/[^A-Za-z0-9\s'\-]/g, '').length < 4) return false
  const visible = value.replace(/\s+/g, '')
  const latin = (visible.match(/[A-Za-z0-9]/g) || []).length
  if (visible.length < 1 || latin / visible.length < 0.5) return false
  if (/(.)\1{5,}/.test(visible)) return false
  return true
}

/** One live interpretation session: audio ingest, ASR, translation, captions, persistence. */
export class InterpretService {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.log = createLogger('dsh-interpret')
    this.dataDir = resolveDataDir(config.dataDir)
    this.asr = new AsrClient(ctx, config, this.log, this.dataDir)
    this.translator = new Translator(ctx, config, this.log)
    this.glossary = new Glossary(this.dataDir)
    this.glossaryReady = this.glossary.load().catch(() => {})
    this.settingsPath = join(this.dataDir, 'settings.json')
    this.settingsReady = this.loadSettings()
    this.lastParakeetEmit = 0
    this.asr.parakeet.subscribe(() => this.onParakeetProgress())
    setTimeout(() => { this.ensureMtRoute().catch(() => {}) }, 0)
    this.listeners = new Set()
    this.segments = []
    this.seq = 0
    this.phase = 'idle'
    this.sessionId = null
    this.sessionDir = null
    this.title = ''
    this.startedAt = null
    this.endedAt = null
    this.lastAudioAt = null
    this.lastError = null
    this.stats = this.freshStats()
    this.tracks = { mic: false, system: false }
    this.queue = Promise.resolve()
    this.persistQueue = Promise.resolve()
    this.preparing = null
    this.segmenters = {
      mic: this.createSegmenter('mic'),
      system: this.createSegmenter('system'),
    }
    this.systemCapture = null
    this.idleTimer = null
    this.stopReason = null
    this.clientStatus = null
    this.clientEvents = []
    this.terminology = new Terminology({ dataDir: this.dataDir, log: this.log })
    this.terminologyReady = this.terminology.load().catch(() => false)
    this.termCorrector = new TermCorrector(ctx, config, this.log)
    this.activeTerminologyDomains = []
    this.streaming = new StreamingAsr({ dataDir: this.dataDir, modelDir: config.streamingModelDir, log: this.log })
    this.streamingProgress = null
    this.streamingController = null
    this.streamingReady = false
    this.live = { mic: null, system: null }
    this.liveTimer = null
    this.liveTranslateState = {
      mic: { at: 0, inflight: false, pendingText: '', controller: null },
      system: { at: 0, inflight: false, pendingText: '', controller: null },
    }
    if (config.streamingMode !== 'off') {
      setTimeout(() => {
        this.streaming.load().then((ready) => {
          if (ready) this.emit('state', this.describe())
        }).catch(() => {})
      }, 0)
    }
    this.draftTimer = null
    this.draftInFlight = false
    this.draftEpoch = 0
    this.lastDraft = {}
    this.disposed = false
  }

  async loadSettings() {
    try {
      const raw = JSON.parse(await readFile(this.settingsPath, 'utf8'))
      this.applySettings(raw)
    } catch {}
  }

  applySettings(patch = {}) {
    const allowed = ['asrProvider', 'asrModelDir', 'mtProvider', 'mtModel', 'autoTranslate', 'systemAudio', 'draftMode', 'draftIntervalMs', 'vadMode', 'brief', 'vadThreshold', 'minSpeechMs', 'silenceMs', 'maxSegmentMs', 'mtEffort', 'temperature', 'maxOutputTokens', 'streamingMode', 'streamingModelDir', 'liveTranslate', 'liveTranslateIntervalMs', 'terminologyMode', 'terminologyDomains', 'terminologyTopK', 'termCorrection', 'termCorrectionTimeoutMs', 'termCorrectionMaxEdits', 'showPronunciation']
    for (const key of allowed) {
      if (patch[key] === undefined) continue
      if (['autoTranslate', 'liveTranslate', 'termCorrection', 'showPronunciation'].includes(key)) this.config[key] = patch[key] !== false
      else if (['vadThreshold', 'temperature', 'maxOutputTokens', 'minSpeechMs', 'silenceMs', 'maxSegmentMs', 'liveTranslateIntervalMs', 'terminologyTopK', 'termCorrectionTimeoutMs', 'termCorrectionMaxEdits'].includes(key)) {
        const value = Number(patch[key])
        if (Number.isFinite(value)) this.config[key] = value
      } else this.config[key] = String(patch[key] || '')
    }
    this.config.language = 'en'
  }

  async saveSettings(patch) {
    this.applySettings(patch)
    await writeFileAtomic(this.settingsPath, JSON.stringify({
      asrProvider: this.config.asrProvider,
      asrModelDir: this.config.asrModelDir,
      mtProvider: this.config.mtProvider,
      mtModel: this.config.mtModel,
      autoTranslate: this.config.autoTranslate,
      systemAudio: this.config.systemAudio,
      draftMode: this.config.draftMode,
      draftIntervalMs: this.config.draftIntervalMs,
      streamingMode: this.config.streamingMode,
      streamingModelDir: this.config.streamingModelDir,
      liveTranslate: this.config.liveTranslate,
      liveTranslateIntervalMs: this.config.liveTranslateIntervalMs,
      terminologyMode: this.config.terminologyMode,
      terminologyDomains: this.config.terminologyDomains,
      terminologyTopK: this.config.terminologyTopK,
      termCorrection: this.config.termCorrection,
      termCorrectionTimeoutMs: this.config.termCorrectionTimeoutMs,
      termCorrectionMaxEdits: this.config.termCorrectionMaxEdits,
      showPronunciation: this.config.showPronunciation,
      vadMode: this.config.vadMode,
      brief: this.config.brief,
      vadThreshold: this.config.vadThreshold,
      minSpeechMs: this.config.minSpeechMs,
      silenceMs: this.config.silenceMs,
      maxSegmentMs: this.config.maxSegmentMs,
      mtEffort: this.config.mtEffort,
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxOutputTokens,
    }, null, 2))
    this.emit('state', this.describe())
    return this.describe().config
  }

  onParakeetProgress() {
    const now = Date.now()
    const preparation = this.asr.parakeet.snapshot()
    if (preparation.phase !== 'downloading' || now - this.lastParakeetEmit > 300) {
      this.lastParakeetEmit = now
      this.emit('model-progress', { providerId: 'parakeet-local', preparation })
      this.emit('state', this.describe())
    }
  }

  createSegmenter(track) {
    const onSegment = (segment) => this.enqueueSegment({ ...segment, track })
    if (this.config.vadMode !== 'energy') {
      try {
        return new SileroSegmenter({
          dataDir: this.dataDir,
          threshold: 0.5,
          minSpeechMs: this.config.minSpeechMs,
          silenceMs: this.config.silenceMs,
          maxSegmentMs: this.config.maxSegmentMs,
          onSegment,
        })
      } catch (error) {
        this.log.warn('Silero VAD unavailable, using energy VAD:', error?.message || error)
      }
    }
    return new EnergySegmenter({
      threshold: this.config.vadThreshold,
      minSpeechMs: this.config.minSpeechMs,
      silenceMs: this.config.silenceMs,
      maxSegmentMs: this.config.maxSegmentMs,
      onSegment,
    })
  }

  freshStats() {
    return {
      segments: 0,
      dropped: 0,
      errors: 0,
      asrCount: 0,
      asrMsTotal: 0,
      mtCount: 0,
      mtMsTotal: 0,
      firstTokenTotal: 0,
      firstTokenCount: 0,
      lastAsrMs: null,
      lastMtMs: null,
      qaRepairs: 0,
      termRepairs: 0,
      echoDropped: 0,
      liveUpdates: 0,
      liveTranslateCount: 0,
    }
  }

  on(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(type, payload) {
    for (const listener of this.listeners) {
      try {
        listener(type, payload)
      } catch (error) {
        this.log.warn('listener failed:', error?.message || error)
      }
    }
  }

  statsView() {
    const stats = this.stats
    return {
      segments: stats.segments,
      dropped: stats.dropped,
      errors: stats.errors,
      qaRepairs: stats.qaRepairs,
      termRepairs: stats.termRepairs,
      echoDropped: stats.echoDropped,
      liveUpdates: stats.liveUpdates,
      liveTranslateCount: stats.liveTranslateCount,
      lastAsrMs: stats.lastAsrMs,
      lastMtMs: stats.lastMtMs,
      avgAsrMs: stats.asrCount ? Math.round(stats.asrMsTotal / stats.asrCount) : null,
      avgMtMs: stats.mtCount ? Math.round(stats.mtMsTotal / stats.mtCount) : null,
      avgFirstTokenMs: stats.firstTokenCount ? Math.round(stats.firstTokenTotal / stats.firstTokenCount) : null,
    }
  }

  describe() {
    return {
      phase: this.phase,
      sessionId: this.sessionId,
      title: this.title,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      elapsedMs: this.startedAt ? (this.endedAt || Date.now()) - this.startedAt : 0,
      tracks: { ...this.tracks },
      lastAudioAt: this.lastAudioAt,
      idleMs: this.lastAudioAt ? Date.now() - this.lastAudioAt : 0,
      stopReason: this.stopReason,
      lastError: this.lastError,
      error: this.lastError,
      config: {
        asrProvider: this.config.asrProvider,
        asrModelDir: this.config.asrModelDir,
        language: this.config.language,
        temperature: this.config.temperature,
        brief: this.config.brief,
        autoTranslate: this.config.autoTranslate,
        systemAudio: this.config.systemAudio,
        draftMode: this.config.draftMode,
        draftIntervalMs: this.config.draftIntervalMs,
        streamingMode: this.config.streamingMode,
        streamingModelDir: this.config.streamingModelDir,
        liveTranslate: this.config.liveTranslate,
        liveTranslateIntervalMs: this.config.liveTranslateIntervalMs,
        terminologyMode: this.config.terminologyMode,
        terminologyDomains: this.config.terminologyDomains,
        terminologyTopK: this.config.terminologyTopK,
        termCorrection: this.config.termCorrection,
        termCorrectionTimeoutMs: this.config.termCorrectionTimeoutMs,
        termCorrectionMaxEdits: this.config.termCorrectionMaxEdits,
        showPronunciation: this.config.showPronunciation,
        vadMode: this.config.vadMode,
        mtProvider: this.config.mtProvider,
        mtModel: this.config.mtModel,
        mtEffort: this.config.mtEffort,
        vadMode: this.config.vadMode,
        vadThreshold: this.config.vadThreshold,
        minSpeechMs: this.config.minSpeechMs,
        silenceMs: this.config.silenceMs,
        maxSegmentMs: this.config.maxSegmentMs,
        dataDir: this.dataDir,
      },
      asr: this.asr.describe(),
      mt: this.mtRoute || null,
      glossary: { count: this.glossary.entries.length },
      stats: this.statsView(),
      segmentCount: this.segments.length,
      terminology: {
        ...this.terminology.stats(),
        mode: this.config.terminologyMode,
        activeDomains: this.activeTerminologyDomains,
        enabled: this.config.terminologyMode !== 'off' && this.terminology.ready,
      },
      live: { mic: this.live.mic, system: this.live.system },
      streaming: {
        mode: this.config.streamingMode,
        enabled: this.streamingReady,
        ready: this.streaming.ready,
        directory: this.streaming.directory,
        failed: this.streaming.failed,
        progress: this.streamingProgress,
      },
    }
  }

  recordError(error, extra = {}) {
    this.lastError = { ...errorPayload(error), at: Date.now(), ...extra }
    this.emit('error', this.lastError)
  }

  async start(options = {}) {
    await this.glossaryReady
    await this.settingsReady
    await this.terminologyReady
    await this.asr.parakeet.inspect().catch(() => {})
    if (this.phase === 'listening' || this.phase === 'stopping') {
      throw Object.assign(new Error('同传已在运行'), { code: 'ALREADY_RUNNING', status: 409 })
    }
    const provider = this.asr.pickProvider()
    if (!provider) throw Object.assign(new Error('没有可用的语音识别模型'), { code: 'ASR_NO_PROVIDER' })
    if (provider.preparation?.phase !== 'ready') {
      throw Object.assign(new Error('语音模型尚未准备完成，请先在面板中准备模型'), {
        code: 'ASR_NOT_READY',
        provider: provider.id,
        preparation: provider.preparation,
      })
    }
    let streamingReady = false
    if (this.config.streamingMode !== 'off') {
      streamingReady = await this.streaming.load().catch(() => false)
    }
    if (this.config.streamingMode === 'on' && !streamingReady) {
      throw Object.assign(new Error('逐词流式模型尚未准备，请先在设置中下载流式模型或把模式改为 auto'), {
        code: 'STREAMING_NOT_READY',
        detail: this.streaming.failed,
      })
    }
    this.streamingReady = streamingReady
    if (this.config.autoTranslate) {
      const route = await this.translator.pickRoute(true)
      if (!route) throw Object.assign(new Error('没有可用的翻译模型路由，请检查 DSH 模型配置'), { code: 'MT_NO_ROUTE' })
      this.mtRoute = { provider: route.provider, model: route.model }
    } else {
      this.mtRoute = null
    }
    await mkdir(this.dataDir, { recursive: true }).catch(() => {})
    this.sessionId = nowStamp() + '-' + randomUUID().slice(0, 8)
    this.sessionDir = join(this.dataDir, 'sessions', this.sessionId)
    await mkdir(this.sessionDir, { recursive: true }).catch(() => {})
    this.title = String(options.title || '').trim() || '同传会话 ' + nowStamp()
    this.segments = []
    this.seq = 0
    this.stats = this.freshStats()
    this.lastError = null
    this.stopReason = null
    this.tracks = { mic: true, system: false }
    this.startedAt = Date.now()
    this.endedAt = null
    this.lastAudioAt = Date.now()
    this.phase = 'listening'
    this.segmenters.mic.reset()
    this.segmenters.system.reset()
    this.live = { mic: null, system: null }
    this.liveTranslateState = {
      mic: { at: 0, inflight: false, pendingText: '', controller: null },
      system: { at: 0, inflight: false, pendingText: '', controller: null },
    }
    this.streaming.reset('mic')
    this.streaming.reset('system')
    this.refreshTerminologyDomains()
    await this.persistMeta()
    this.emit('state', this.describe())
    this.startIdleWatch()
    if (streamingReady) this.startLiveLoop()
    else this.startDraftLoop()
    if (this.config.systemAudio !== 'off') this.startSystemCapture()
    return this.describe()
  }

  startLiveLoop() {
    this.clearLiveLoop()
    this.liveTimer = setInterval(() => {
      try { this.tickLive() } catch (error) { this.log.warn('live tick failed:', error?.message || error) }
    }, 100)
    this.liveTimer.unref?.()
  }

  clearLiveLoop() {
    if (this.liveTimer) clearInterval(this.liveTimer)
    this.liveTimer = null
  }

  tickLive() {
    if (this.phase !== 'listening' || !this.streamingReady) return
    for (const track of ['mic', 'system']) {
      let text = this.streaming.poll(track)
      if (!text || !isLiveEnglish(text)) continue
      let corrections = []
      if (this.config.terminologyMode !== 'off' && this.terminology.ready && this.config.termCorrection && text.split(/\s+/).filter(Boolean).length >= 4) {
        this.refreshTerminologyDomains()
        const corrected = this.terminology.correctLive(text, this.terminologyGateDomains())
        if (corrected.text !== text) {
          text = corrected.text
          corrections = corrected.corrections
        }
      }
      const previous = this.live[track]
      if (previous?.en === text) continue
      const active = this.segmenters[track].active?.(8)
      this.live[track] = {
        track,
        startMs: active?.startMs ?? Math.max(0, Date.now() - (this.startedAt || Date.now())),
        en: text,
        zh: previous?.zh || '',
        provisional: true,
        termCorrections: corrections,
        at: Date.now(),
      }
      this.stats.liveUpdates = (this.stats.liveUpdates || 0) + 1
      this.emit('live', this.live[track])
      this.maybeTranslateLive(track)
    }
  }

  clearLive(track) {
    this.abortLiveTranslation(track)
    if (!this.live[track]) return
    this.live[track] = null
    this.emit('live', { track, cleared: true })
  }

  abortLiveTranslation(track) {
    const state = this.liveTranslateState[track]
    if (!state) return
    try { state.controller?.abort() } catch {}
    state.controller = null
    state.inflight = false
    state.pendingText = ''
    state.at = 0
  }

  maybeTranslateLive(track) {
    if (!this.config.liveTranslate || !this.config.autoTranslate || !this.mtRoute) return
    const live = this.live[track]
    if (!live?.en) return
    const words = live.en.split(/\s+/).filter(Boolean).length
    if (words < 3) return
    const state = this.liveTranslateState[track]
    if (!state) return
    if (state.inflight) {
      state.pendingText = live.en
      return
    }
    const now = Date.now()
    if (now - state.at < this.config.liveTranslateIntervalMs) return
    state.at = now
    state.inflight = true
    state.pendingText = ''
    const text = live.en
    const controller = new AbortController()
    state.controller = controller
    const hits = this.glossary.match(text)
    const ragHits = this.terminology.ready && this.config.terminologyMode !== 'off'
      ? this.terminology.match(text, { domains: this.activeTerminologyDomains })
      : []
    const options = {
      brief: this.config.brief || '',
      glossary: [this.glossary.prompt(hits), this.terminology.promptBlock(ragHits)].filter(Boolean).join('\n\n'),
      context: this.recentContext(),
      partial: true,
      signal: controller.signal,
      onDelta: (partial) => {
        if (this.live[track]?.en !== text) return
        this.live[track].zh = partial
        this.live[track].at = Date.now()
        this.emit('live', this.live[track])
      },
    }
    this.translator.translate(text, options)
      .then((result) => {
        if (this.live[track]?.en !== text) return
        this.live[track].zh = result.text
        this.live[track].at = Date.now()
        this.stats.liveTranslateCount = (this.stats.liveTranslateCount || 0) + 1
        this.emit('live', this.live[track])
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return
        this.log.warn('live translation failed:', error?.message || error)
      })
      .finally(() => {
        state.inflight = false
        state.controller = null
        const pending = state.pendingText
        state.pendingText = ''
        if (pending && this.phase === 'listening') {
          const fresh = this.live[track]
          if (fresh) {
            fresh.en = fresh.en || pending
            this.maybeTranslateLive(track)
          }
        }
      })
  }

  startIdleWatch() {
    this.clearIdleWatch()
    this.idleTimer = setInterval(() => {
      if (this.phase !== 'listening') return
      const idleMs = Date.now() - (this.lastAudioAt || Date.now())
      if (idleMs > 15_000) {
        this.log.info('no audio for 15s, stopping automatically')
        this.stop('idle').catch((error) => this.log.warn('idle stop failed:', error?.message || error))
      }
    }, 2000)
    this.idleTimer.unref?.()
  }

  clearIdleWatch() {
    if (this.idleTimer) clearInterval(this.idleTimer)
    this.idleTimer = null
  }

  startDraftLoop() {
    this.clearDraftLoop()
    this.draftEpoch += 1
    if (!this.config.draftMode) return
    this.draftTimer = setInterval(() => { this.tickDraft().catch(() => {}) }, this.config.draftIntervalMs)
    this.draftTimer.unref?.()
  }

  clearDraftLoop() {
    if (this.draftTimer) clearInterval(this.draftTimer)
    this.draftTimer = null
    this.draftInFlight = false
    this.lastDraft = {}
  }

  async tickDraft() {
    if (this.phase !== 'listening' || this.draftInFlight) return
    const track = this.segmenters.mic.active(8) ? 'mic' : (this.segmenters.system.active(8) ? 'system' : null)
    if (!track) return
    const active = this.segmenters[track].active(8)
    if (!active) return
    this.draftInFlight = true
    const epoch = this.draftEpoch
    try {
      const result = await this.asr.transcribe(active.samples)
      if (this.phase !== 'listening' || epoch !== this.draftEpoch) return
      const text = String(result.text || '').trim()
      if (!text) return
      this.lastDraft[track] = { en: text, at: Date.now() }
      this.emit('draft', {
        track,
        startMs: active.startMs,
        en: text,
        provider: result.provider,
        at: Date.now(),
      })
    } catch {
      // Draft recognition is best-effort; final recognition reports real errors.
    } finally {
      this.draftInFlight = false
    }
  }

  async stop(reason = 'manual') {
    this.stopReason = reason
    this.clearIdleWatch()
    this.clearDraftLoop()
    this.clearLiveLoop()
    this.clearLive('mic')
    this.clearLive('system')
    if (this.phase !== 'listening' && this.phase !== 'stopping') {
      return this.describe()
    }
    this.phase = 'stopping'
    this.stopReason = reason
    this.emit('state', this.describe())
    try {
      this.segmenters.mic.flush()
      this.segmenters.system.flush()
      await this.systemCapture?.stop().catch((error) => this.log.warn('system capture stop:', error?.message || error))
      this.systemCapture = null
      await withTimeout(this.queue, 20_000)
    } catch (error) {
      this.log.warn('flush failed:', error?.message || error)
    }
    this.phase = 'completed'
    this.endedAt = Date.now()
    await this.writeTranscript().catch((error) => this.recordError(error))
    this.emit('state', this.describe())
    return this.describe()
  }

  pushAudio(track, pcmBuffer) {
    if (this.phase !== 'listening') {
      return { accepted: false, reason: 'not-listening' }
    }
    if (!pcmBuffer || pcmBuffer.byteLength < 2) return { accepted: false, reason: 'empty' }
    const samples = pcm16ToFloat32(pcmBuffer)
    this.lastAudioAt = Date.now()
    const key = track === 'system' ? 'system' : 'mic'
    this.tracks[key] = true
    this.segmenters[key].push(samples)
    if (this.streamingReady) this.streaming.feed(key, samples)
    return { accepted: true, samples: samples.length }
  }

  ingestSystemSamples(samples) {
    if (this.phase !== 'listening' || !samples?.length) return
    this.lastAudioAt = Date.now()
    this.tracks.system = true
    this.segmenters.system.push(samples)
    if (this.streamingReady) this.streaming.feed('system', samples)
  }

  startSystemCapture() {
    if (this.systemCapture) return
    const capture = new SystemCapture({
      sessionDir: this.sessionDir,
      log: this.log,
      onSamples: (samples) => this.ingestSystemSamples(samples),
      onError: (error) => {
        this.tracks.system = false
        this.recordError(error, { track: 'system' })
        this.emit('state', this.describe())
      },
    })
    this.systemCapture = capture
    capture.start()
      .then(() => {
        this.tracks.system = true
        this.emit('state', this.describe())
      })
      .catch((error) => {
        this.systemCapture = null
        this.tracks.system = false
        this.recordError(error, { track: 'system' })
        this.emit('state', this.describe())
      })
  }

  enqueueSegment(segment) {
    this.queue = this.queue
      .then(() => this.processSegment(segment))
      .catch((error) => {
        this.log.error('segment pipeline failed:', error?.message || error)
        this.recordError(error)
      })
  }

  async processSegment(segment) {
    if (this.disposed) return
    const caption = {
      id: randomUUID(),
      seq: ++this.seq,
      track: segment.track || 'mic',
      tStartMs: segment.startMs,
      tEndMs: segment.endMs,
      en: '',
      zh: '',
      status: 'asr',
      createdAt: Date.now(),
      asrMs: null,
      mtMs: null,
      provider: null,
      error: null,
      qa: null,
      glossaryHits: 0,
    }
    this.segments.push(caption)
    if (this.segments.length > MAX_SEGMENTS_IN_MEMORY) this.segments.shift()
    this.draftEpoch += 1
    this.clearLive(caption.track)
    if (this.streamingReady) this.streaming.reset(caption.track)
    this.emit('draft', { track: caption.track, cleared: true })
    delete this.lastDraft[caption.track]
    this.emit('caption', caption)

    let text = ''
    try {
      const result = await this.asr.transcribe(segment.samples)
      text = result.text
      caption.asrMs = result.ms
      caption.provider = result.provider
      this.stats.asrCount += 1
      this.stats.asrMsTotal += result.ms
      this.stats.lastAsrMs = result.ms
    } catch (error) {
      caption.status = 'error'
      caption.error = errorPayload(error)
      this.stats.errors += 1
      this.emit('caption', caption)
      this.recordError(error, { segmentId: caption.id })
      this.persistSegment(caption)
      return
    }

    if (!text) {
      caption.status = 'dropped'
      caption.reason = 'empty'
      this.stats.dropped += 1
      this.emit('caption', caption)
      this.persistSegment(caption)
      this.emit('stats', this.statsView())
      return
    }
    if (!isLikelyEnglish(text)) {
      caption.status = 'dropped'
      caption.reason = 'non-english'
      caption.en = text
      this.stats.dropped += 1
      this.emit('caption', caption)
      this.persistSegment(caption)
      this.emit('stats', this.statsView())
      return
    }

    const echo = this.segments.find((other) => other.id !== caption.id && other.en &&
      other.track !== caption.track &&
      Math.abs((other.createdAt || 0) - caption.createdAt) < 3000 &&
      similarSpeech(other.en, text))
    if (echo) {
      if (caption.track === 'system' && echo.track === 'mic') {
        echo.status = 'dropped'
        echo.reason = 'echo-mic'
        this.stats.dropped += 1
        this.stats.echoDropped += 1
        this.emit('caption', echo)
      } else {
        caption.status = 'dropped'
        caption.reason = 'echo'
        caption.en = text
        this.stats.dropped += 1
        this.stats.echoDropped += 1
        this.emit('caption', caption)
        this.persistSegment(caption)
        this.emit('stats', this.statsView())
        return
      }
    }

    caption.asrRaw = text
    let terminologyCorrections = []
    if (this.config.terminologyMode !== 'off' && this.terminology.ready && this.config.termCorrection && this.mtRoute) {
      const context = this.segments.slice(-4).map((segment) => segment.en).filter(Boolean).join(' ')
      const hits = this.terminologyHits(text, context)
      if (hits.length && this.terminology.needsCorrection(text, hits)) {
        const corrected = await this.termCorrector.correct(text, {
          hits,
          context,
          route: this.mtRoute,
          domains: this.terminologyGateDomains(),
        })
        if (corrected.text && corrected.text !== text) {
          text = corrected.text
          terminologyCorrections = corrected.corrections
          caption.termCorrections = corrected.corrections
        }
      }
    }
    const repaired = this.glossary.repairAsr(text)
    if (repaired.repairs.length) {
      caption.asrRepairs = repaired.repairs
      text = repaired.text
      this.stats.termRepairs += repaired.repairs.length
    }
    caption.en = text
    caption.status = this.config.autoTranslate ? 'translating' : 'done'
    this.emit('caption', caption)
    this.emit('stats', this.statsView())

    if (this.config.autoTranslate) {
      let lastEmit = 0
      const hits = this.glossary.match(text)
      const ragMatches = this.config.terminologyMode === 'off' || !this.terminology.ready
        ? []
        : this.terminology.match(text, { domains: this.activeTerminologyDomains })
      const ragPrompt = this.terminology.promptBlock(ragMatches)
      caption.glossaryHits = hits.length + ragMatches.length
      caption.terminologyHits = ragMatches.map((term) => term.source)
      const promptOptions = {
        brief: this.config.brief || '',
        glossary: [this.glossary.prompt(hits), ragPrompt].filter(Boolean).join('\n\n'),
        context: this.recentContext(),
      }
      const onDelta = (partial) => {
        caption.zh = partial
        const now = Date.now()
        if (now - lastEmit >= 120) {
          lastEmit = now
          this.emit('caption', caption)
        }
      }
      try {
        let result = await this.translator.translate(text, { ...promptOptions, onDelta })
        let qa = qaTranslation(text, result.text, hits)
        if (!qa.ok) {
          this.stats.qaRepairs += 1
          this.log.info('QA repair for segment', caption.seq, qa.issues.map((issue) => issue.code).join(','))
          const repaired = await this.translator.translate(text, {
            ...promptOptions,
            repair: repairBlock(qa.issues),
            onDelta: () => {},
          })
          const repairedQa = qaTranslation(text, repaired.text, hits)
          result = repaired
          qa = repairedQa
        }
        caption.zh = result.text
        caption.mtMs = result.ms
        caption.status = 'done'
        caption.qa = qa.ok ? null : qa.issues
        this.stats.mtCount += 1
        this.stats.mtMsTotal += result.ms
        this.stats.lastMtMs = result.ms
        if (result.firstTokenMs !== null) {
          this.stats.firstTokenCount += 1
          this.stats.firstTokenTotal += result.firstTokenMs
        }
        this.stats.segments += 1
      } catch (error) {
        caption.status = 'error'
        caption.error = errorPayload(error)
        this.stats.errors += 1
        this.emit('caption', caption)
        this.recordError(error, { segmentId: caption.id })
        this.persistSegment(caption)
        this.emit('stats', this.statsView())
        return
      }
    } else {
      this.stats.segments += 1
    }

    this.emit('caption', caption)
    this.emit('stats', this.statsView())
    this.persistSegment(caption)
  }

  refreshTerminologyDomains() {
    if (this.config.terminologyMode === 'off' || !this.terminology.ready) {
      this.activeTerminologyDomains = []
      return []
    }
    const configured = String(this.config.terminologyDomains || 'auto').split(',').map((value) => value.trim()).filter(Boolean)
    if (configured.length && !configured.includes('auto')) {
      this.activeTerminologyDomains = configured.includes('all')
        ? ['ai', 'math', 'statistics', 'biology', 'urban', 'architecture', 'electronics', 'tech']
        : configured
      return this.activeTerminologyDomains
    }
    const context = [this.config.brief, this.title, ...this.segments.slice(-4).map((segment) => segment.en), this.live?.mic?.en, this.live?.system?.en]
      .filter(Boolean).join(' ')
    this.activeTerminologyDomains = this.terminology.domainsFor(context, ['auto'])
    return this.activeTerminologyDomains
  }

  terminologyGateDomains() {
    const configured = String(this.config.terminologyDomains || 'auto')
    if (configured === 'all' || configured.includes(',')) return this.activeTerminologyDomains
    if (configured !== 'auto') return this.activeTerminologyDomains
    return this.activeTerminologyDomains.slice(0, 1)
  }

  terminologyHits(text, context = '') {
    if (this.config.terminologyMode === 'off' || !this.terminology.ready) return []
    let domains = this.activeTerminologyDomains
    if (!domains.length) {
      domains = this.terminology.domainsFor([context, text].join(' '), ['auto'])
      this.activeTerminologyDomains = domains
    }
    return this.terminology.retrieve(text, { context, domains, topK: this.config.terminologyTopK })
  }

  recentContext(limit = 2) {
    const done = this.segments.filter((segment) => segment.status === 'done' && segment.en && segment.zh)
    return done.slice(-limit).map((segment) => 'EN: ' + segment.en + '\nZH: ' + segment.zh).join('\n')
  }

  persistMeta() {
    const meta = {
      schemaVersion: 1,
      id: this.sessionId,
      title: this.title,
      startedAt: this.startedAt,
      config: this.describe().config,
      asr: this.asr.describe().picked?.id || null,
      mt: this.mtRoute,
    }
    return writeFileAtomic(join(this.sessionDir, 'meta.json'), JSON.stringify(meta, null, 2)).catch(() => {})
  }

  persistSegment(segment) {
    if (!this.sessionDir) return
    this.persistQueue = this.persistQueue
      .then(() => appendFile(join(this.sessionDir, 'events.jsonl'), toJsonLine({ type: 'segment', segment })))
      .catch((error) => this.log.warn('persist failed:', error?.message || error))
  }

  async writeTranscript() {
    if (!this.sessionDir) return
    const transcript = {
      schemaVersion: 1,
      id: this.sessionId,
      title: this.title,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      config: this.describe().config,
      stats: this.statsView(),
      segments: this.segments,
    }
    await this.persistQueue.catch(() => {})
    await writeFileAtomic(join(this.sessionDir, 'transcript.json'), JSON.stringify(transcript, null, 2))
    await writeFileAtomic(join(this.sessionDir, 'transcript.jsonl'), this.segments.map(toJsonLine).join(''))
  }

  setClientStatus(status) {
    this.clientStatus = { ...status, at: Date.now() }
    return this.clientStatus
  }

  recordClientEvent(event) {
    const entry = { ...event, at: Date.now() }
    this.clientEvents.push(entry)
    if (this.clientEvents.length > 30) this.clientEvents.splice(0, this.clientEvents.length - 30)
    return entry
  }

  async prepare(providerId) {
    if (this.preparing) return this.preparing
    this.preparing = (async () => {
      try {
        this.emit('state', this.describe())
        const provider = await this.asr.prepare(providerId, {
          onProgress: (preparation) => this.emit('model-progress', {
            providerId: providerId || this.config.asrProvider,
            preparation,
          }),
        })
        this.emit('state', this.describe())
        return provider
      } catch (error) {
        this.recordError(error)
        throw error
      } finally {
        this.preparing = null
      }
    })()
    return this.preparing
  }

  async ensureMtRoute() {
    if (!this.config.autoTranslate) {
      this.mtRoute = null
      return null
    }
    if (this.mtRoute?.provider && this.mtRoute?.model) return this.mtRoute
    const route = await this.translator.pickRoute(true)
    this.mtRoute = route ? { provider: route.provider, model: route.model } : null
    this.emit('state', this.describe())
    return this.mtRoute
  }

  async listModels() {
    const snapshot = this.asr.snapshot()
    const parakeet = this.asr.parakeet.snapshot()
    return {
      dataDir: this.dataDir,
      parakeet: {
        id: 'parakeet-local',
        path: parakeet.directory || parakeet.path || null,
        preparation: parakeet,
        expectedBytes: 661534526,
      },
      providers: (snapshot?.providers || []).map((provider) => ({
        id: provider.id,
        name: provider.name,
        preparation: provider.preparation,
      })),
      vad: { mode: this.config.vadMode, path: resolveVadModel(this.dataDir), ready: Boolean(resolveVadModel(this.dataDir)) },
      streaming: {
        id: 'streaming-en',
        name: '英文逐词流式 Zipformer',
        ready: Boolean(await findStreamingModel(this.dataDir, this.config.streamingModelDir)),
        directory: await findStreamingModel(this.dataDir, this.config.streamingModelDir),
        expectedBytes: STREAMING_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0),
        failed: this.streaming.failed,
        progress: this.streamingProgress,
        mode: this.config.streamingMode,
        license: 'Apache-2.0',
      },
    }
  }

  async prepareStreaming() {
    this.streamingController?.abort()
    const controller = new AbortController()
    this.streamingController = controller
    this.streamingProgress = { phase: 'downloading', completedBytes: 0, totalBytes: 72654782 }
    this.emit('state', this.describe())
    try {
      const directory = await ensureStreamingModel(this.dataDir, {
        signal: controller.signal,
        onProgress: (completedBytes, totalBytes, resource) => {
          this.streamingProgress = { phase: 'downloading', completedBytes, totalBytes, resource }
          this.emit('model-progress', { providerId: 'streaming-en', preparation: this.streamingProgress })
          this.emit('state', this.describe())
        },
      })
      this.streamingProgress = { phase: 'loading' }
      this.emit('state', this.describe())
      const ready = await this.streaming.load()
      this.streamingProgress = null
      this.emit('state', this.describe())
      return { directory, ready, failed: this.streaming.failed }
    } catch (error) {
      this.streamingProgress = { phase: 'error', message: String(error?.message || error) }
      this.emit('state', this.describe())
      throw error
    } finally {
      this.streamingController = null
    }
  }

  async prepareVad(options = {}) {
    const path = await ensureVadModel(this.dataDir, {
      onProgress: (completedBytes, totalBytes) => this.emit('model-progress', {
        providerId: 'silero-vad',
        preparation: { phase: 'downloading', resource: 'silero_vad.onnx', completedBytes, totalBytes },
      }),
    })
    if (this.phase !== 'listening') {
      this.segmenters = { mic: this.createSegmenter('mic'), system: this.createSegmenter('system') }
    }
    this.emit('state', this.describe())
    return { path, ready: true }
  }

  async cancelPrepare(providerId) {
    const id = String(providerId || this.config.asrProvider)
    if (id === 'parakeet-local') {
      await this.asr.parakeet.cancel()
      return this.listModels()
    }
    if (id === 'streaming-en') {
      this.streamingController?.abort()
      this.streamingProgress = null
      this.emit('state', this.describe())
      return this.listModels()
    }
    const service = this.asr.service()
    if (service?.cancelPreparation) await service.cancelPreparation(id)
    return this.listModels()
  }

  async setGlossary(entries) {
    await this.glossary.save(entries)
    this.emit('state', this.describe())
    return this.glossary.entries
  }

  async importGlossary(text, format) {
    const entries = await this.glossary.importText(text, format)
    await this.glossary.save(entries)
    this.emit('state', this.describe())
    return this.glossary.entries
  }

  sessionsRoot() {
    return join(this.dataDir, 'sessions')
  }

  async listSessions() {
    let names = []
    try { names = await readdir(this.sessionsRoot()) } catch { return [] }
    const items = []
    for (const name of names) {
      if (!/^[A-Za-z0-9-]{1,80}$/.test(name)) continue
      const dir = join(this.sessionsRoot(), name)
      try {
        const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
        let transcript = null
        try { transcript = JSON.parse(await readFile(join(dir, 'transcript.json'), 'utf8')) } catch {}
        const segments = Array.isArray(transcript?.segments) ? transcript.segments : []
        items.push({
          id: name,
          title: String(meta.title || transcript?.title || name),
          startedAt: meta.startedAt || transcript?.startedAt || null,
          endedAt: meta.endedAt || transcript?.endedAt || null,
          segments: segments.filter((segment) => segment.status !== 'dropped').length,
          completed: Boolean(transcript),
        })
      } catch {}
    }
    return items.sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0)).slice(0, 50)
  }

  async getSession(id) {
    if (!/^[A-Za-z0-9-]{1,80}$/.test(String(id || ''))) {
      throw Object.assign(new Error('会话 id 不合法'), { code: 'INVALID_SESSION', status: 400 })
    }
    const dir = join(this.sessionsRoot(), String(id))
    let transcript = null
    try { transcript = JSON.parse(await readFile(join(dir, 'transcript.json'), 'utf8')) } catch {
      throw Object.assign(new Error('会话不存在或未完成'), { code: 'SESSION_NOT_FOUND', status: 404 })
    }
    return {
      id,
      title: transcript.title || id,
      startedAt: transcript.startedAt || null,
      endedAt: transcript.endedAt || null,
      stats: transcript.stats || null,
      segments: Array.isArray(transcript.segments) ? transcript.segments : [],
    }
  }

  async renameSession(id, title) {
    const clean = String(title || '').trim().slice(0, 200)
    if (!clean) throw Object.assign(new Error('标题不能为空'), { code: 'INVALID_TITLE', status: 400 })
    if (!/^[A-Za-z0-9-]{1,80}$/.test(String(id || ''))) {
      throw Object.assign(new Error('会话 id 不合法'), { code: 'INVALID_SESSION', status: 400 })
    }
    const dir = join(this.sessionsRoot(), String(id))
    let transcript
    try { transcript = JSON.parse(await readFile(join(dir, 'transcript.json'), 'utf8')) } catch {
      throw Object.assign(new Error('会话不存在或未完成'), { code: 'SESSION_NOT_FOUND', status: 404 })
    }
    transcript.title = clean
    await writeFileAtomic(join(dir, 'transcript.json'), JSON.stringify(transcript, null, 2))
    try {
      const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
      meta.title = clean
      await writeFileAtomic(join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
    } catch {}
    return { id, title: clean }
  }

  async deleteSession(id) {
    if (!/^[A-Za-z0-9-]{1,80}$/.test(String(id || ''))) {
      throw Object.assign(new Error('会话 id 不合法'), { code: 'INVALID_SESSION', status: 400 })
    }
    await rm(join(this.sessionsRoot(), String(id)), { recursive: true, force: true })
    return { id, deleted: true }
  }

  exportText(format, session = null) {
    if (session) {
      return exportPayload(format, session, session.segments)
    }
    return exportPayload(format, {
      title: this.title,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
    }, this.segments)
  }

  async translateText(text) {
    const route = await this.translator.pickRoute(true)
    this.mtRoute = route ? { provider: route.provider, model: route.model } : null
    return this.translator.translate(String(text || '').trim(), { route })
  }

  dispose() {
    this.disposed = true
    this.clearIdleWatch()
    this.clearDraftLoop()
    this.clearLiveLoop()
    this.abortLiveTranslation('mic')
    this.abortLiveTranslation('system')
    try { this.streaming.dispose() } catch {}
    try { this.asr.dispose() } catch {}
    this.systemCapture?.stop().catch(() => {})
    try {
      this.segmenters.mic.flush()
      this.segmenters.system.flush()
    } catch {}
    if (this.phase === 'listening') {
      this.stop().catch(() => {})
    }
    this.listeners.clear()
  }
}
