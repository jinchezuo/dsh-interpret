import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileAtomic } from './util.js'

const SEED_PATH = fileURLToPath(new URL('../../assets/academic-glossary.json', import.meta.url))

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function levenshtein(a, b) {
  const left = String(a)
  const right = String(b)
  if (left === right) return 0
  if (!left.length) return right.length
  if (!right.length) return left.length
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[right.length]
}

function normalizeEntry(entry) {
  const source = String(entry?.source || '').trim()
  const target = String(entry?.target || '').trim()
  if (!source || !target) return null
  return {
    id: String(entry?.id || source),
    source,
    target,
    caseSensitive: entry?.caseSensitive === true,
    preferred: entry?.preferred !== false,
    forbidden: entry?.forbidden === true,
    domain: String(entry?.domain || ''),
    note: String(entry?.note || ''),
  }
}

/** Persistent academic glossary with longest-first, word-boundary matching. */
export class Glossary {
  constructor(dataDir) {
    this.path = join(dataDir, 'glossary.json')
    this.entries = []
    this.version = 0
  }

  async load() {
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8'))
      const list = Array.isArray(raw?.terms) ? raw.terms : Array.isArray(raw) ? raw : []
      this.entries = list.map(normalizeEntry).filter(Boolean)
      this.version = Number(raw?.version || 1)
    } catch {
      this.entries = []
      this.version = 0
    }
    if (!this.entries.length) {
      try {
        const seed = JSON.parse(await readFile(SEED_PATH, 'utf8'))
        this.entries = (Array.isArray(seed?.terms) ? seed.terms : []).map(normalizeEntry).filter(Boolean)
      } catch {}
    }
    return this.entries
  }

  async save(entries) {
    const normalized = (Array.isArray(entries) ? entries : []).map(normalizeEntry).filter(Boolean)
    this.entries = normalized
    this.version += 1
    await writeFileAtomic(this.path, JSON.stringify({ version: this.version, terms: normalized }, null, 2))
    return normalized
  }

  /** Return the terms present in one source segment, longest source first. */
  match(text, limit = 40) {
    const source = String(text || '')
    const hits = []
    const ordered = [...this.entries].sort((a, b) => b.source.length - a.source.length)
    for (const entry of ordered) {
      const flags = entry.caseSensitive ? '' : 'i'
      let regex
      try {
        regex = new RegExp('(^|[^A-Za-z0-9_])' + escapeRegExp(entry.source) + '($|[^A-Za-z0-9_])', flags)
      } catch {
        continue
      }
      if (regex.test(source)) hits.push(entry)
      if (hits.length >= limit) break
    }
    return hits
  }

  /** Repair likely ASR misspellings of curated terms without touching other words. */
  repairAsr(text) {
    const value = String(text || '')
    const repairs = []
    if (!value || !this.entries.length) return { text: value, repairs }
    const terms = [...this.entries]
      .filter((entry) => !entry.forbidden && entry.source.length >= 5 && /^[A-Za-z][A-Za-z-]+$/.test(entry.source))
      .sort((a, b) => b.source.length - a.source.length)
    const replaced = value.replace(/\b[A-Za-z][A-Za-z-]{3,}\b/g, (token) => {
      const lower = token.toLowerCase()
      const exact = terms.find((entry) => entry.source.toLowerCase() === lower)
      if (exact) return token
      for (const entry of terms) {
        const source = entry.source.toLowerCase()
        if (source[0] !== lower[0]) continue
        const withoutPlural = lower.endsWith('s') ? lower.slice(0, -1) : lower
        const distance = Math.min(levenshtein(lower, source), levenshtein(withoutPlural, source))
        const allowed = Math.max(1, Math.floor(source.length * 0.3))
        if (distance > 0 && distance <= allowed) {
          repairs.push({ from: token, to: entry.source })
          return entry.source
        }
      }
      return token
    })
    return { text: replaced, repairs }
  }

  /** Build the prompt block for one set of hits. */
  prompt(hits) {
    if (!hits?.length) return ''
    const usable = hits.filter((hit) => !hit.forbidden)
    const forbidden = hits.filter((hit) => hit.forbidden)
    const blocks = []
    if (usable.length) {
      blocks.push('必须使用以下术语译法：\n' + usable.map((hit) =>
        '- ' + hit.source + ' => ' + hit.target + (hit.preferred ? '（强制）' : '')).join('\n'))
    }
    if (forbidden.length) {
      blocks.push('以下译法禁止使用：\n' + forbidden.map((hit) => '- ' + hit.source + ' => ' + hit.target).join('\n'))
    }
    return blocks.join('\n\n')
  }

  async importText(text, format = 'csv') {
    const value = String(text || '')
    let entries = []
    if (format === 'json') {
      const raw = JSON.parse(value)
      entries = Array.isArray(raw) ? raw : raw?.terms || []
    } else if (format === 'tmx') {
      const blocks = value.match(/<tu[\s\S]*?<\/tu>/gi) || []
      for (const block of blocks) {
        const segs = [...block.matchAll(/<tuv[^>]*xml:lang="([^"]+)"[^>]*>[\s\S]*?<seg>([\s\S]*?)<\/seg>/gi)]
        const byLang = {}
        for (const match of segs) byLang[match[1].toLowerCase()] = match[2]
        const source = byLang.en || byLang['en-us'] || byLang['en-gb'] || ''
        const target = byLang.zh || byLang['zh-cn'] || byLang['zh-hans'] || ''
        if (source && target) entries.push({ source, target })
      }
    } else {
      const separator = format === 'tsv' ? '\t' : ','
      for (const line of value.split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith('#')) continue
        const cells = line.split(separator)
        if (cells.length < 2) continue
        entries.push({ source: cells[0], target: cells.slice(1).join(separator) })
      }
    }
    return entries.map(normalizeEntry).filter(Boolean)
  }
}
