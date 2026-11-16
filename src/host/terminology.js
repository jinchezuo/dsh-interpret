import { existsSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const STOPWORDS = new Set('a an the of and or to in on for with by from as at is are was were be been being this that these those it its their our your we you they he she i not no can may might will would should could do does did have has had than then so such into over under about'.split(' '))

export const DOMAIN_LABELS = {
  ai: '人工智能',
  math: '数学',
  statistics: '统计',
  biology: '生物',
  urban: '城市规划',
  architecture: '建筑',
  electronics: '电子信息',
  tech: '通用科技',
}

const DOMAIN_STRONG = {
  ai: ['language model', 'neural', 'transformer', 'llm', 'embedding', 'inference', 'prompt', 'generative', 'diffusion', 'training'],
  math: ['eigen', 'theorem', 'lemma', 'manifold', 'topology', 'polynomial', 'vector space'],
  statistics: ['regression', 'p-value', 'confidence interval', 'bayesian', 'likelihood', 'hypothesis', 'variance'],
  biology: ['organism', 'gene', 'protein', 'cell', 'species', 'dna', 'rna', 'enzyme', 'ecosystem', 'mutation'],
  urban: ['zoning', 'land use', 'transit', 'housing', 'urban planning', 'pedestrian'],
  architecture: ['facade', 'vault', 'cantilever', 'floor plan', 'structural'],
  electronics: ['transistor', 'circuit', 'capacitor', 'resistor', 'amplifier', 'fpga', 'modulation'],
  tech: ['algorithm', 'database', 'compiler', 'protocol', 'encryption', 'throughput'],
}

const DOMAIN_KEYWORDS = {
  ai: ['model', 'neural', 'transformer', 'attention', 'language model', 'llm', 'training', 'inference', 'embedding', 'token', 'prompt', 'agent', 'diffusion', 'classifier'],
  math: ['theorem', 'lemma', 'proof', 'matrix', 'eigen', 'integral', 'derivative', 'manifold', 'topology', 'polynomial', 'vector space', 'convergence'],
  statistics: ['probability', 'regression', 'distribution', 'variance', 'hypothesis', 'p-value', 'confidence', 'bayesian', 'likelihood', 'sampling'],
  biology: ['cell', 'gene', 'protein', 'enzyme', 'organism', 'species', 'dna', 'rna', 'mutation', 'ecosystem', 'evolution'],
  urban: ['zoning', 'land use', 'housing', 'transit', 'planning', 'density', 'urban', 'pedestrian', 'infrastructure'],
  architecture: ['facade', 'building', 'structure', 'arch', 'vault', 'column', 'beam', 'floor plan', 'elevation'],
  electronics: ['circuit', 'signal', 'transistor', 'capacitor', 'resistor', 'amplifier', 'bandwidth', 'modulation', 'fpga', 'pcb'],
  tech: ['algorithm', 'database', 'compiler', 'protocol', 'network', 'system', 'cloud', 'latency', 'throughput', 'encryption'],
}

export function tokenize(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 1 && !STOPWORDS.has(token)) || []
}

export function phoneticKey(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((word) => {
    let value = word
      .replace(/ph/g, 'f').replace(/th/g, '0').replace(/sh/g, 's').replace(/ch/g, 'c')
      .replace(/[aeiouy]+/g, 'a').replace(/[^a-z0-9]/g, '')
    value = value.replace(/[bfpv]/g, 'p').replace(/[cgjkqsxz]/g, 'k').replace(/[dt]/g, 't')
      .replace(/[mn]/g, 'n').replace(/[lr]/g, 'l').replace(/[hw]/g, 'w')
    return value.replace(/(.)\1+/g, '$1').slice(0, 10)
  }).join(' ')
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function escapeRegExp(value) {
  return String(value).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

/** Local hybrid retrieval over the bundled terminology corpus. */
export class Terminology {
  constructor({ dataDir, log } = {}) {
    this.dataDir = dataDir
    this.log = log
    this.terms = []
    this.ready = false
    this.manifest = null
    this.byPhrase = new Map()
    this.postings = new Map()
    this.docs = new Map()
    this.avgdl = 1
    this.confusions = []
    this.version = 0
  }

  async load() {
    if (this.ready) return true
    const candidates = [
      join(PACKAGE_ROOT, 'assets', 'terminology', 'terms.jsonl.gz'),
      this.dataDir ? join(this.dataDir, 'terminology', 'terms.jsonl.gz') : null,
    ].filter(Boolean)
    const path = candidates.find((candidate) => existsSync(candidate))
    if (!path) {
      this.ready = false
      return false
    }
    try {
      const text = gunzipSync(readFileSync(path)).toString('utf8')
      this.terms = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).filter((term) => term?.source)
      this.version = this.terms.length
      this.buildIndex()
      this.ready = true
      return true
    } catch (error) {
      this.log?.warn('terminology load failed:', error?.message || error)
      this.ready = false
      return false
    }
  }

  buildIndex() {
    this.byPhrase.clear()
    this.postings.clear()
    this.docs.clear()
    this.confusions = []
    let totalLength = 0
    for (const term of this.terms) {
      term._tokens = [...new Set(tokenize([term.source, ...(term.aliases || []), term.definition || ''].join(' ')))]
      this.docs.set(term.id || term.source, term._tokens)
      totalLength += term._tokens.length
      for (const token of term._tokens) {
        if (!this.postings.has(token)) this.postings.set(token, new Set())
        this.postings.get(token).add(term)
      }
      for (const phrase of [term.source, ...(term.aliases || [])]) {
        const key = normalize(phrase)
        if (!key) continue
        const existing = this.byPhrase.get(key)
        if (!existing || (term.priority || 0) > (existing.priority || 0)) this.byPhrase.set(key, term)
      }
      for (const phrase of term.confusions || []) {
        const key = normalize(phrase)
        if (key && key !== normalize(term.source)) this.confusions.push({ phrase: key, term })
      }
    }
    this.avgdl = Math.max(1, totalLength / Math.max(1, this.terms.length))
    this.confusions.sort((a, b) => b.phrase.length - a.phrase.length)
  }

  domainsFor(text, explicitDomains = []) {
    const hasKeyword = (lower, word) => {
      const value = String(word || '').toLowerCase()
      if (!value) return false
      if (value === 'eigen') return lower.includes('eigen')
      if (value.includes(' ')) return lower.includes(value)
      try { return new RegExp('\\b' + value.replace(/[.*+?^\$\{\}()|[\]\\]/g, '\\$&') + '\\b').test(lower) } catch { return lower.includes(value) }
    }
    const explicit = explicitDomains.filter(Boolean)
    if (explicit.length && !explicit.includes('auto')) {
      if (explicit.includes('all')) return Object.keys(DOMAIN_LABELS)
      return explicit
    }
    const lower = String(text || '').toLowerCase()
    const scored = Object.entries(DOMAIN_KEYWORDS).map(([domain, words]) => ({
      domain,
      score: words.reduce((sum, word) => sum + (hasKeyword(lower, word) ? 1 : 0), 0) +
        (DOMAIN_STRONG[domain] || []).reduce((sum, word) => sum + (hasKeyword(lower, word) ? 3 : 0), 0),
    })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score)
    return scored.slice(0, 2).map((item) => item.domain)
  }

  retrieve(text, { context = '', domains = [], topK = 30 } = {}) {
    if (!this.ready) return []
    const active = this.domainsFor([context, text].join(' '), domains)
    const queryTokens = [...new Set(tokenize([context, text, ...active.map((domain) => DOMAIN_KEYWORDS[domain]?.join(' ') || '')].join(' ')))]
    const candidates = new Map()
    const add = (term) => { if (term) candidates.set(term.id || term.source, term) }
    const normalizedText = ' ' + normalize(text) + ' '
    for (const [phrase, term] of this.byPhrase) {
      if (phrase.length >= 3 && normalizedText.includes(' ' + phrase + ' ')) add(term)
    }
    for (const token of queryTokens) {
      for (const term of this.postings.get(token) || []) add(term)
    }
    const phoneticQuery = new Set(phoneticKey(text).split(' '))
    const scored = []
    for (const term of candidates.values()) {
      const tokens = term._tokens || []
      let bm25 = 0
      for (const queryToken of queryTokens) {
        if (!tokens.includes(queryToken)) continue
        const df = this.postings.get(queryToken)?.size || 1
        const idf = Math.log(1 + (this.terms.length - df + 0.5) / (df + 0.5))
        bm25 += idf * (1.2 + 1) / (1 + 1.2 * (1 - 0.75) + 0.75 * tokens.length / this.avgdl)
      }
      const sourceKey = normalize(term.source)
      const exact = normalizedText.includes(' ' + sourceKey + ' ') ? 1 : 0
      const phonetic = (term.phoneticKey || '').split(' ').filter((key) => key && phoneticQuery.has(key)).length
      const domainHit = active.some((domain) => (term.domains || []).includes(domain)) ? 1 : 0
      if (bm25 <= 0 && !exact && phonetic === 0) continue
      const score = bm25 + exact * 5 + phonetic * 1.6 + domainHit * 1.5 + Math.min(2, (term.priority || 0) / 50)
      scored.push({ ...term, score, reasons: { bm25, exact, phonetic, domainHit } })
    }
    scored.sort((a, b) => b.score - a.score || a.source.length - b.source.length)
    return scored.slice(0, topK)
  }

  match(text, { domains = [] } = {}) {
    if (!this.ready) return []
    const haystack = ' ' + normalize(text) + ' '
    const active = this.domainsFor(text, domains)
    const found = []
    const ordered = [...this.byPhrase.entries()].sort((a, b) => b[0].length - a[0].length)
    for (const [phrase, term] of ordered) {
      if (phrase.length < 2 || !haystack.includes(' ' + phrase + ' ')) continue
      if (active.length && !active.some((domain) => (term.domains || []).includes(domain))) continue
      if (found.some((item) => normalize(item.source) === phrase)) continue
      found.push(term)
      if (found.length >= 12) break
    }
    return found
  }

  correctLive(text, explicitDomains = []) {
    if (!this.ready) return { text: String(text || ''), corrections: [] }
    const active = this.domainsFor(text, explicitDomains)
    if (!active.length) return { text: String(text || ''), corrections: [] }
    let value = String(text || '')
    const corrections = []
    for (const { phrase, term } of this.confusions) {
      if (corrections.length >= 2) break
      if (!(term.domains || []).some((domain) => active.includes(domain))) continue
      const regex = new RegExp('(^|[^A-Za-z0-9_])(' + escapeRegExp(phrase) + ')($|[^A-Za-z0-9_])', 'ig')
      if (!regex.test(value)) continue
      value = value.replace(regex, (match, before, _hit, after) => before + term.source + after)
      corrections.push({ from: phrase, to: term.source, termId: term.id, domains: term.domains })
    }
    return { text: value, corrections }
  }

  search(query, { domain = '', limit = 12 } = {}) {
    if (!this.ready) return []
    const value = String(query || '').trim()
    if (!value) return []
    const hits = this.retrieve(value, { domains: domain ? [domain] : [], topK: limit })
    return hits.map((term) => ({
      source: term.source,
      zh: term.zh || '',
      domains: term.domains || [],
      definition: term.definition || '',
      ipaUk: term.ipaUk || '',
      ipaUs: term.ipaUs || '',
      aliases: term.aliases || [],
      score: Math.round(term.score * 10) / 10,
    }))
  }

  promptBlock(hits, { includePronunciation = false } = {}) {
    const usable = (hits || []).filter((hit) => hit?.source)
    if (!usable.length) return ''
    const lines = usable.slice(0, 12).map((term) => {
      const zh = term.zh ? ' => ' + term.zh : '（中文译名按学科惯用译法）'
      const ipa = includePronunciation && (term.ipaUk || term.ipaUs) ? ' [UK ' + (term.ipaUk || '?') + ' / US ' + (term.ipaUs || '?') + ']' : ''
      return '- ' + term.source + zh + ipa
    })
    return '候选学科术语（ASR 可能误听；译文涉及这些概念时必须使用对应译名）：\n' + lines.join('\n')
  }

  stats() {
    return {
      ready: this.ready,
      count: this.terms.length,
      version: this.version,
      domains: this.terms.reduce((acc, term) => {
        for (const domain of term.domains || []) acc[domain] = (acc[domain] || 0) + 1
        return acc
      }, {}),
      zhCount: this.terms.filter((term) => term.zh).length,
      ipaCount: this.terms.filter((term) => term.ipaUk || term.ipaUs).length,
    }
  }
}
