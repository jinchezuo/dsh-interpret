import { randomUUID } from 'node:crypto'

const SYSTEM = '你是学术讲座与会议的同声传译 ASR 术语校对器。输入是一句英文 ASR 原文和候选学科术语。' +
  '只修正术语级的误听（尤其是发音相近、被拆错词或漏词的术语），不润色、不补全、不改写句法、不改变事实、不改数字。' +
  '只能把原文片段替换成候选术语的 source 或 alias；候选之外的词一律不得替换。不确定时不要改。' +
  '必须只输出 JSON，不要 markdown，不要解释。'

function tokens(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9]+/g) || []
}

function digitString(text) {
  return (String(text || '').match(/\d+(?:[.,]\d+)?/g) || []).join(',')
}

function candidateKeys(hits) {
  const map = new Map()
  for (const term of hits || []) {
    for (const value of [term.source, ...(term.aliases || [])]) {
      const key = String(value || '').trim().toLowerCase()
      if (key) map.set(key, term)
    }
  }
  return map
}

function buildPrompt(text, hits, context, domains = []) {
  const lines = []
  if (domains.length) lines.push('当前学科上下文：' + domains.join(', '))
  if (context) lines.push('前文（仅供理解，不要翻译或修改）：\n' + String(context).slice(0, 800))
  lines.push('候选术语：')
  for (const term of (hits || []).slice(0, 20)) {
    const aliases = (term.aliases || []).slice(0, 5).join(', ')
    const confusions = (term.confusions || []).slice(0, 5).join(', ')
    const ipa = [term.ipaUk && ('UK ' + term.ipaUk), term.ipaUs && ('US ' + term.ipaUs)].filter(Boolean).join(' / ')
    lines.push('- ' + term.source + (term.zh ? ' => ' + term.zh : '') + (ipa ? ' [' + ipa + ']' : '') +
      (aliases ? '；别名: ' + aliases : '') + (confusions ? '；常见误听: ' + confusions : '') +
      (term.definition ? '；释义: ' + String(term.definition).slice(0, 180) : ''))
  }
  lines.push('ASR 原文：\n' + text)
  lines.push('如果有术语误听，输出：{"corrections":[{"from":"原文片段","to":"候选术语","termId":"...","confidence":0.0}]}。' +
    '如果没有，输出：{"corrections":[]}。')
  return lines.join('\n\n')
}

function extractJson(value) {
  const text = String(value || '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return null }
}

/** Validate and apply only candidate-backed, low-risk edits. */
export function applyCorrections(text, corrections, hits, maxEdits = 5, domains = []) {
  const source = String(text || '')
  const keys = candidateKeys(hits)
  const usable = []
  for (const item of Array.isArray(corrections) ? corrections : []) {
    const from = String(item?.from || '').trim()
    const to = String(item?.to || '').trim()
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) continue
    const target = keys.get(to.toLowerCase())
    if (!target) continue
    if (domains.length && !domains.some((domain) => (target.domains || []).includes(domain))) continue
    const index = source.toLowerCase().indexOf(from.toLowerCase())
    if (index < 0) continue
    const before = index === 0 ? '' : source[index - 1]
    const after = source[index + from.length] || ''
    if (/[A-Za-z0-9_]/.test(before) || /[A-Za-z0-9_]/.test(after)) continue
    if (usable.some((entry) => {
      const start = entry.index
      const end = start + entry.from.length
      return index < end && index + from.length > start
    })) continue
    usable.push({ from, to, term: target, index, confidence: Number(item.confidence) || 0 })
    if (usable.length >= maxEdits) break
  }
  if (!usable.length) return { text: source, corrections: [] }
  let output = source
  for (const entry of [...usable].sort((a, b) => b.index - a.index)) {
    output = output.slice(0, entry.index) + entry.to + output.slice(entry.index + entry.from.length)
  }
  if (digitString(output) !== digitString(source)) return { text: source, corrections: [] }
  const before = tokens(source)
  const after = tokens(output)
  const changed = Math.max(before.length, after.length) - Math.min(before.length, after.length)
  if (changed > Math.max(3, Math.ceil(before.length * 0.3))) return { text: source, corrections: [] }
  return {
    text: output,
    corrections: usable.map((entry) => ({
      from: entry.from,
      to: entry.to,
      termId: entry.term.id,
      source: entry.term.source,
      zh: entry.term.zh || '',
      confidence: entry.confidence,
    })),
  }
}

/** LLM-backed RAG term corrector with timeout and offline fallback. */
export class TermCorrector {
  constructor(ctx, config, log) {
    this.ctx = ctx
    this.config = config
    this.log = log
    this.cache = new Map()
  }

  llm() {
    try { return this.ctx.get('llm') || null } catch { return null }
  }

  async correct(text, { hits = [], context = '', route = null, signal = null, domains = [] } = {}) {
    const raw = String(text || '')
    if (!raw || !hits?.length || !route || this.config.termCorrection === false) {
      return { text: raw, corrections: [] }
    }
    const key = raw.toLowerCase()
    if (this.cache.has(key)) return this.cache.get(key)
    const llm = this.llm()
    if (!llm) return { text: raw, corrections: [] }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Math.max(300, Number(this.config.termCorrectionTimeoutMs) || 1000))
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const stream = await llm.stream({
        provider: route.provider,
        model: route.model,
        system: SYSTEM,
        messages: [{ role: 'user', content: [{ type: 'text', text: buildPrompt(raw, hits, context, domains) }] }],
        temperature: 0,
        maxTokens: 360,
        reasoningEffort: 'low',
        signal: controller.signal,
      })
      let output = ''
      for await (const chunk of stream) {
        if (chunk?.type === 'text-delta') output += String(chunk.text || '')
        if (chunk?.type === 'finish') break
      }
      const payload = extractJson(output)
      if (!payload) {
        const result = { text: raw, corrections: [] }
        this.remember(key, result)
        return result
      }
      const result = applyCorrections(raw, payload.corrections, hits, Number(this.config.termCorrectionMaxEdits) || 5, domains)
      this.remember(key, result)
      if (result.corrections.length) {
        this.log?.info('term correction:', result.corrections.map((item) => item.from + ' -> ' + item.to).join('; '))
      }
      return result
    } catch (error) {
      if (error?.name !== 'AbortError') this.log?.warn('term correction failed:', error?.message || error)
      const result = { text: raw, corrections: [] }
      this.remember(key, result)
      return result
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  remember(key, value) {
    this.cache.set(key, value)
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value)
  }

  clear() {
    this.cache.clear()
  }
}
