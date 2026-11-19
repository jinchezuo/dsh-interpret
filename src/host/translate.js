const ROUTE_TTL_MS = 30_000

/** Resolve the configured DSH LLM route and translate one English segment. */
export class Translator {
  constructor(ctx, config, log) {
    this.ctx = ctx
    this.config = config
    this.log = log
    this.cache = null
    this.cachedAt = 0
    this.lastWarning = ''
  }

  llm() {
    try {
      return this.ctx.get('llm') || null
    } catch {
      return null
    }
  }

  async listRoutes(force = false) {
    if (!force && this.cache && Date.now() - this.cachedAt < ROUTE_TTL_MS) return this.cache
    const llm = this.llm()
    if (!llm) return { routes: [], error: 'DSH LLM 服务不可用' }
    let providers = []
    try {
      providers = await llm.listProviders()
    } catch {
      providers = []
    }
    const routes = []
    for (const adapter of Array.isArray(providers) ? providers : []) {
      const id = String(adapter?.id || '').trim()
      if (!id || id === 'mock') continue
      let models = []
      try {
        models = await llm.listModels(id)
      } catch {
        models = []
      }
      routes.push({
        id,
        name: String(adapter?.name || id),
        models: (Array.isArray(models) ? models : []).map((model) => ({
          id: String(model?.id || ''),
          name: String(model?.name || model?.id || ''),
          description: String(model?.description || ''),
        })).filter((model) => model.id),
      })
    }
    this.cache = { routes, error: routes.some((route) => route.models.length) ? '' : '没有已配置的翻译模型路由' }
    this.cachedAt = Date.now()
    return this.cache
  }

  invalidate() {
    this.cache = null
    this.cachedAt = 0
    this.lastWarning = ''
  }

  /** Validate the saved provider/model pair against the routes DSH currently exposes. */
  findConfigured(routes) {
    const provider = String(this.config.mtProvider || '').trim()
    const model = String(this.config.mtModel || '').trim()
    if (!provider && !model) return null
    if (provider && model) {
      const route = routes.find((item) => item.id === provider)
      const found = route?.models.find((item) => item.id === model)
      return found ? { provider: route.id, model: found.id } : null
    }
    if (provider) {
      const route = routes.find((item) => item.id === provider)
      const found = route?.models[0]
      return found ? { provider: route.id, model: found.id } : null
    }
    for (const route of routes) {
      const found = route.models.find((item) => item.id === model)
      if (found) return { provider: route.id, model: found.id }
    }
    return null
  }

  /** Prefer a valid configured route, then a flash model, then the first usable pair. */
  async pickRoute(force = false, knownRoutes = null, knownError = '') {
    const { routes, error } = knownRoutes ? { routes: knownRoutes, error: knownError } : await this.listRoutes(force)
    this.lastWarning = ''
    const provider = String(this.config.mtProvider || '').trim()
    const model = String(this.config.mtModel || '').trim()
    if (provider || model) {
      const configured = this.findConfigured(routes)
      if (configured) return configured
      const requested = provider && model ? provider + ' / ' + model : (provider || model)
      this.lastWarning = '已保存的翻译模型「' + requested + '」不在当前 DSH 路由中，已自动切换。'
    }
    if (!routes.length) {
      this.lastWarning = error || '没有已配置的翻译模型路由'
      return null
    }
    const account = routes.find((route) => /account/i.test(route.id))
    if (account) {
      const flash = account.models.find((item) => /flash/i.test(item.id))
      if (flash) return { provider: account.id, model: flash.id }
      if (account.models.length) return { provider: account.id, model: account.models[0].id }
    }
    for (const route of routes) {
      const flash = route.models.find((item) => /flash/i.test(item.id))
      if (flash) return { provider: route.id, model: flash.id }
    }
    for (const route of routes) {
      if (route.models.length) return { provider: route.id, model: route.models[0].id }
    }
    this.lastWarning = error || '没有任何可用翻译路由'
    return null
  }

  async describe(force = false) {
    const { routes, error } = await this.listRoutes(force)
    const picked = await this.pickRoute(force, routes, error)
    return {
      routes,
      picked,
      requested: {
        provider: String(this.config.mtProvider || ''),
        model: String(this.config.mtModel || ''),
      },
      warning: this.lastWarning,
      error: picked ? '' : (this.lastWarning || error || '没有任何可用翻译路由'),
    }
  }

  buildPrompt(text, { brief = '', glossary = '', context = '', repair = '', partial = false } = {}) {
    const parts = []
    if (partial) parts.push('这是说话中的半句，只翻译已经出现的部分，不要补全，也不要输出解释。')
    if (brief) parts.push('场景说明：\n' + brief)
    if (repair) parts.push('上一次译文存在以下问题，本次必须修正：\n' + repair)
    if (glossary) parts.push('术语要求：\n' + glossary)
    if (context) parts.push('前文对照（仅供理解，不要重复翻译）：\n' + context)
    parts.push('待翻译英文原文：\n' + text)
    parts.push('请只输出对应的简体中文译文，不要加引号、说明或英文原文。')
    return parts.join('\n\n')
  }

  async translate(text, options = {}) {
    const llm = this.llm()
    if (!llm) throw Object.assign(new Error('DSH LLM 服务不可用'), { code: 'MT_UNAVAILABLE' })
    const route = options.route || await this.pickRoute()
    if (!route) throw Object.assign(new Error('没有可用的翻译模型路由'), { code: 'MT_NO_ROUTE' })
    const startedAt = Date.now()
    let firstTokenMs = null
    let output = ''
    const system = '你是学术讲座与会议的同声传译译员。把英文原文翻译成自然、准确、书面化的简体中文。' +
      '保留数字、百分比、单位、公式、缩写与专有名词；使用给定术语；原文可能包含语音识别造成的拼写误差，请结合术语表与上下文纠正后再译；不添加解释、不省略信息、不输出原文或任何前后缀。'
    const messages = [{ role: 'user', content: [{ type: 'text', text: this.buildPrompt(text, options) }] }]
    const effort = String(this.config.mtEffort || '').trim()
    const request = {
      provider: route.provider,
      model: route.model,
      system,
      messages,
      temperature: this.config.temperature,
      maxTokens: this.config.maxOutputTokens,
      signal: options.signal,
    }
    if (['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) request.reasoningEffort = effort
    const stream = await llm.stream(request)
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta') {
        if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt
        output += String(chunk.text || '')
        options.onDelta?.(output)
      } else if (chunk?.type === 'finish') {
        const kind = chunk.reason?.kind
        if (kind && kind !== 'stop' && !output.trim()) {
          const failure = chunk.reason?.failure || {}
          throw Object.assign(new Error(failure.message || '翻译模型未完成'), { code: failure.code || 'MT_FAILED' })
        }
        break
      }
    }
    const cleaned = output.trim().replace(/^["“”'']+|["“”'']+$/g, '').trim()
    if (!cleaned) throw Object.assign(new Error('翻译结果为空'), { code: 'MT_EMPTY' })
    return { text: cleaned, provider: route.provider, model: route.model, ms: Date.now() - startedAt, firstTokenMs }
  }
}
