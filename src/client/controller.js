import { MicCapture } from './audio.js'

const EMPTY = {
  status: 'loading',
  connection: 'connecting',
  state: null,
  segments: [],
  busy: false,
  error: null,
  modelProgress: null,
  elapsed: 0,
  testBusy: false,
  testResult: null,
  audioInfo: null,
  dock: { available: false, registered: false, reason: '右侧栏加载中…', mounted: false, expanded: false, open: false },
  draft: null,
  live: {},
  termSearch: { query: '', results: [], busy: false },
  glossary: null,
  history: null,
  historyView: null,
  models: null,
  glossaryBusy: false,
}

function messageOf(payload) {
  if (!payload) return '未知错误'
  if (typeof payload === 'string') return payload
  return String(payload.message || payload.error?.message || '未知错误')
}

/** Browser-side owner of the SSE subscription, the microphone and the caption store. */
export class Controller {
  constructor() {
    this.snapshot = { ...EMPTY }
    this.listeners = new Set()
    this.segmentMap = new Map()
    this.es = null
    this.timer = null
    this.capture = new MicCapture({
      onFrame: (buffer) => this.postFrame(buffer),
      onLevel: (level) => this.setLevel(level),
      onError: (error) => this.fail(error),
    })
    this.inFlight = 0
    this.lastReport = 0
    this.disposed = false
    this.resetting = false
    this.resetEpoch = 0
  }

  subscribe = (listener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.snapshot

  emit() {
    for (const listener of this.listeners) {
      try { listener() } catch {}
    }
  }

  update(patch) {
    this.snapshot = { ...this.snapshot, ...patch }
    this.emit()
  }

  setState(state, extra = {}) {
    this.update({ state, ...extra })
    this.syncTimer()
  }

  syncTimer() {
    const running = this.snapshot.state?.phase === 'listening'
    if (running && !this.timer) {
      this.timer = setInterval(() => {
        const startedAt = this.snapshot.state?.startedAt
        if (!startedAt) return
        this.update({ elapsed: Date.now() - startedAt })
      }, 1000)
    } else if (!running && this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  setLevel(level) {
    this.update({ level })
  }

  setDock(patch) {
    this.update({ dock: { ...(this.snapshot.dock || {}), ...patch } })
  }

  report(type, extra = {}) {
    const now = Date.now()
    if (now - this.lastReport < 350) return
    this.lastReport = now
    fetch('/interpret/api/client-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        connection: this.snapshot.connection,
        phase: this.snapshot.state?.phase || null,
        segments: this.snapshot.segments.length,
        draft: Boolean(this.snapshot.draft),
        error: this.snapshot.error || null,
        ...extra,
      }),
      cache: 'no-store',
    }).catch(() => {})
  }

  fail(error) {
    const message = error?.message ? messageOf(error) : messageOf(error)
    this.update({ error: message })
  }

  connect() {
    if (this.disposed || this.es) return
    this.update({ connection: 'connecting' })
    try {
      this.es = new EventSource('/interpret/api/events')
      this.es.onopen = () => {
        this.update({ connection: 'open' })
      }
      this.es.onerror = () => {
        this.update({ connection: 'closed' })
        this.startPolling()
      }
      this.es.onmessage = (event) => {
        let message
        try { message = JSON.parse(event.data) } catch { return }
        this.handleEvent(message?.type, message?.data)
      }
    } catch (error) {
      this.fail(error)
    }
    this.refresh()
    this.loadGlossary()
    this.loadSessions()
    this.loadModels()
    // Committed captions are authoritative in the host. A slow poll keeps the
    // list correct even if the SSE connection is open but silent after a reload.
    this.startPolling(1800)
  }

  handleEvent(type, data) {
    if (!type) return
    if (type === 'state') {
      this.setState(data, { status: 'ready', live: data?.live || this.snapshot.live })
      this.report('state')
      return
    }
    if (type === 'live') {
      const live = { ...this.snapshot.live }
      if (data?.cleared) delete live[data.track]
      else if (data?.track && data.en) live[data.track] = data
      this.update({ live })
      return
    }
    if (type === 'draft') {
      if (data?.cleared) {
        if (!this.snapshot.draft || this.snapshot.draft.track === data.track) this.update({ draft: null })
      } else if (data?.en) {
        this.update({ draft: data })
      }
      return
    }
    if (type === 'caption') {
      if (!data?.id) return
      if (this.snapshot.draft && this.snapshot.draft.track === data.track) this.update({ draft: null })
      if (this.snapshot.live[data.track]) {
        const live = { ...this.snapshot.live }
        delete live[data.track]
        this.update({ live })
      }
      this.segmentMap.set(data.id, data)
      const segments = [...this.segmentMap.values()].sort((a, b) => (a.seq || 0) - (b.seq || 0))
      if (segments.length > 800) {
        for (const segment of segments.slice(0, segments.length - 800)) this.segmentMap.delete(segment.id)
      }
      this.update({ segments: segments.slice(-800), status: 'ready' })
      this.report('caption', { segmentStatus: data.status })
      return
    }
    if (type === 'stats') {
      const state = this.snapshot.state
      if (state) this.update({ state: { ...state, stats: data } })
      return
    }
    if (type === 'model-progress') {
      this.update({ modelProgress: data })
      return
    }
    if (type === 'error') {
      this.update({ error: messageOf(data) })
      return
    }
  }

  startPolling(intervalMs = 1200) {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => { this.refresh() }, intervalMs)
  }

  stopPolling() {
    if (!this.pollTimer) return
    clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  async request(path, options = {}) {
    const response = await fetch('/interpret/api' + path, {
      method: options.method || 'GET',
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
    })
    let payload = null
    try { payload = await response.json() } catch {}
    if (!response.ok || payload?.ok === false) {
      const error = new Error(messageOf(payload?.error))
      error.code = payload?.error?.code || 'HTTP_' + response.status
      error.payload = payload
      throw error
    }
    return payload
  }

  async refresh() {
    if (this.refreshing || this.resetting) return
    this.refreshing = true
    const epoch = this.resetEpoch
    try {
      const payload = await this.request('/state')
      if (epoch !== this.resetEpoch) return
      const map = new Map()
      for (const segment of payload.segments || []) map.set(segment.id, segment)
      this.segmentMap = map
      this.report('refresh', { count: payload.segments?.length || 0 })
      this.setState(payload.data, {
        status: 'ready',
        segments: [...map.values()].sort((a, b) => (a.seq || 0) - (b.seq || 0)).slice(-800),
        error: payload.data?.error?.message || null,
        draft: null,
        live: payload.data?.live || {},
      })
    } catch (error) {
      this.update({ status: 'error', error: messageOf(error) })
    } finally {
      this.refreshing = false
    }
  }

  async start() {
    if (this.snapshot.busy) return
    if (this.snapshot.state?.phase === 'listening') return
    this.update({ busy: true, error: null })
    try {
      await this.capture.start(undefined, this.snapshot.state?.config?.audioProfile || 'auto')
      this.update({ audioInfo: { sampleRate: this.capture.sampleRate || 0, frames: this.capture.frames || 0 } })
      const payload = await this.request('/session/start', { method: 'POST', body: { title: '' } })
      this.segmentMap = new Map()
      this.setState(payload.data, { segments: [], draft: null, live: {}, error: null, status: 'ready' })
    } catch (error) {
      this.capture.stop()
      this.update({ error: messageOf(error) })
    } finally {
      this.update({ busy: false })
    }
  }

  async stop() {
    if (this.snapshot.busy) return
    this.update({ busy: true, error: null })
    this.capture.stop()
    try {
      const payload = await this.request('/session/stop', { method: 'POST' })
      this.setState(payload.data, { status: 'ready', live: {}, draft: null })
    } catch (error) {
      this.update({ error: messageOf(error) })
    } finally {
      this.update({ busy: false })
    }
  }

  async resetSession() {
    if (this.snapshot.busy) return
    if (this.snapshot.state?.phase !== 'completed') return
    this.update({ busy: true, error: null })
    this.resetting = true
    this.resetEpoch += 1
    try {
      const payload = await this.request('/session/reset', { method: 'POST' })
      this.segmentMap = new Map()
      this.setState(payload.data, {
        status: 'ready',
        segments: [],
        draft: null,
        live: {},
        historyView: null,
        error: null,
      })
      await this.loadSessions()
    } catch (error) {
      this.update({ error: messageOf(error) })
    } finally {
      this.resetting = false
      this.update({ busy: false })
    }
  }

  async prepare(providerId) {
    if (this.snapshot.busy) return
    this.update({ busy: true, error: null, modelProgress: { phase: 'starting' } })
    try {
      const payload = await this.request('/prepare', { method: 'POST', body: { providerId } })
      this.setState(payload.data, { modelProgress: null, error: null, status: 'ready' })
    } catch (error) {
      this.update({ error: messageOf(error) })
    } finally {
      this.update({ busy: false })
    }
  }

  async loadGlossary() {
    try {
      const payload = await this.request('/glossary')
      this.update({ glossary: payload.data })
      return payload.data
    } catch (error) {
      this.update({ glossary: { count: 0, entries: [], error: messageOf(error) } })
      return null
    }
  }

  async saveGlossary(entries) {
    this.update({ glossaryBusy: true })
    try {
      const payload = await this.request('/glossary', { method: 'POST', body: { entries } })
      this.update({ glossary: payload.data, error: null })
      return payload.data
    } catch (error) {
      this.update({ error: messageOf(error) })
      return null
    } finally {
      this.update({ glossaryBusy: false })
    }
  }

  async importGlossary(text, format) {
    this.update({ glossaryBusy: true })
    try {
      const payload = await this.request('/glossary', { method: 'POST', body: { text, format } })
      this.update({ glossary: payload.data, error: null })
      return payload.data
    } catch (error) {
      this.update({ error: messageOf(error) })
      return null
    } finally {
      this.update({ glossaryBusy: false })
    }
  }

  async saveConfig(patch) {
    try {
      const payload = await this.request('/config', { method: 'POST', body: patch })
      await this.refresh()
      return payload.data
    } catch (error) {
      this.update({ error: messageOf(error) })
      return null
    }
  }

  exportUrl(format, sessionId) {
    const suffix = sessionId ? '&session=' + encodeURIComponent(sessionId) : ''
    return '/interpret/api/export?format=' + encodeURIComponent(format) + suffix
  }

  async loadModels() {
    try {
      const payload = await this.request('/models')
      this.update({ models: payload.data })
      return payload.data
    } catch {
      return null
    }
  }

  async prepareVad() {
    try {
      await this.request('/models/vad/prepare', { method: 'POST', body: {} })
      await this.loadModels()
      await this.refresh()
    } catch (error) {
      this.update({ error: messageOf(error) })
    }
  }

  async searchTerminology(query, domain = '') {
    const value = String(query || '').trim()
    if (!value) {
      this.update({ termSearch: { query: '', results: [], busy: false } })
      return []
    }
    this.update({ termSearch: { ...this.snapshot.termSearch, query: value, busy: true } })
    try {
      const params = new URLSearchParams({ q: value, limit: '12' })
      if (domain && domain !== 'auto' && domain !== 'all') params.set('domain', domain)
      const payload = await this.request('/terminology/search?' + params.toString())
      const results = payload.data || []
      this.update({ termSearch: { query: value, results, busy: false } })
      return results
    } catch (error) {
      this.update({ termSearch: { query: value, results: [], busy: false }, error: messageOf(error) })
      return []
    }
  }

  async prepareStreaming() {
    try {
      await this.request('/models/streaming/prepare', { method: 'POST', body: {} })
      await this.loadModels()
      await this.refresh()
    } catch (error) {
      this.update({ error: messageOf(error) })
    }
  }

  async loadSessions() {
    try {
      const payload = await this.request('/sessions')
      this.update({ history: payload.data || [] })
      return payload.data
    } catch (error) {
      this.update({ history: [] })
      return null
    }
  }

  async openSession(id) {
    try {
      const payload = await this.request('/sessions/' + encodeURIComponent(id))
      this.update({ historyView: payload.data })
    } catch (error) {
      this.update({ error: messageOf(error) })
    }
  }

  closeSession() {
    this.update({ historyView: null })
  }

  async deleteSession(id) {
    try {
      await this.request('/sessions/' + encodeURIComponent(id) + '?confirm=1', { method: 'DELETE' })
      this.update({ historyView: null })
      await this.loadSessions()
    } catch (error) {
      this.update({ error: messageOf(error) })
    }
  }

  async renameSession(id, title) {
    try {
      await this.request('/sessions/' + encodeURIComponent(id), { method: 'PATCH', body: { title } })
      await this.loadSessions()
    } catch (error) {
      this.update({ error: messageOf(error) })
    }
  }

  async cancelPrepare(providerId) {
    try {
      await this.request('/prepare/cancel', { method: 'POST', body: { providerId } })
      await this.refresh()
    } catch (error) {
      this.update({ error: messageOf(error) })
    }
  }

  async translateTest(text) {
    const value = String(text || '').trim()
    if (!value || this.snapshot.testBusy) return
    this.update({ testBusy: true, testResult: null })
    try {
      const payload = await this.request('/translate', { method: 'POST', body: { text: value } })
      this.update({ testResult: { ok: true, ...payload.data } })
    } catch (error) {
      this.update({ testResult: { ok: false, message: messageOf(error) } })
    } finally {
      this.update({ testBusy: false })
    }
  }

  postFrame(buffer) {
    if (this.disposed || this.snapshot.state?.phase !== 'listening') return
    if (this.inFlight >= 3) return
    this.inFlight += 1
    fetch('/interpret/api/audio/mic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buffer,
      cache: 'no-store',
    }).catch(() => {}).finally(() => { this.inFlight -= 1 })
  }

  dispose() {
    this.disposed = true
    this.capture.stop()
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    try { this.es?.close() } catch {}
    this.es = null
    this.stopPolling()
    this.listeners.clear()
  }
}
