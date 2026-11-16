import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createGunzip, gzipSync } from 'node:zlib'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const OUT = join(ROOT, 'assets', 'terminology')
const CACHE = join(ROOT, '.cache', 'terminology')
const API = 'https://en.wikipedia.org/w/api.php'
const UA = 'dsh-interpret-terminology-builder/1.0 (local research; contact: local)'

const PAGES = [
  { page: 'Glossary_of_artificial_intelligence', domains: ['ai'] },
  { page: 'Glossary_of_biology', domains: ['biology'] },
  { page: 'Glossary_of_architecture', domains: ['architecture'] },
  { page: 'Glossary_of_electrical_and_electronics_engineering', domains: ['electronics'] },
  { page: 'Glossary_of_mathematical_jargon', domains: ['math'] },
  { page: 'Glossary_of_probability_and_statistics', domains: ['statistics'] },
  { page: 'Glossary_of_engineering', domains: ['tech'] },
  { page: 'Glossary_of_physics', domains: ['tech'] },
]
const CATEGORIES = [
  { category: 'Category:Artificial intelligence', domains: ['ai'] },
  { category: 'Category:Mathematical terminology', domains: ['math'] },
  { category: 'Category:Statistical terminology', domains: ['statistics'] },
  { category: 'Category:Biological terminology', domains: ['biology'] },
  { category: 'Category:Urban planning', domains: ['urban'] },
  { category: 'Category:Architectural terminology', domains: ['architecture'] },
  { category: 'Category:Electronic engineering', domains: ['electronics'] },
  { category: 'Category:Engineering', domains: ['tech'] },
]

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function api(params, attempt = 0) {
  const url = new URL(API)
  for (const [key, value] of Object.entries({ format: 'json', formatversion: '2', ...params })) url.searchParams.set(key, value)
  const response = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } })
  if (response.status === 429 && attempt < 6) {
    const retry = Number(response.headers.get('retry-after') || 0) * 1000 || 3000 * (attempt + 1)
    console.log('429, waiting', retry, 'ms')
    await sleep(retry)
    return api(params, attempt + 1)
  }
  if (!response.ok) throw new Error('Wikipedia HTTP ' + response.status + ' for ' + url)
  const data = await response.json()
  if (data?.error) {
    if (attempt < 3) { await sleep(800 * (attempt + 1)); return api(params, attempt + 1) }
    throw new Error('Wikipedia API: ' + JSON.stringify(data.error))
  }
  return data
}

async function loadCached(name, download) {
  await mkdir(CACHE, { recursive: true })
  const path = join(CACHE, name)
  if (!existsSync(path)) {
    console.log('download', name)
    await download(path)
  }
  return path
}

async function downloadBritfone(path) {
  const response = await fetch('https://codeload.github.com/loveencounterflow/Britfone/tar.gz/refs/heads/master')
  if (!response.ok) throw new Error('Britfone download failed')
  const chunks = []
  for await (const chunk of response.body) chunks.push(chunk)
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const archive = join(CACHE, 'britfone.tar.gz')
  await writeFile(archive, Buffer.concat(chunks))
  await run('tar', ['-xzf', archive, '-C', CACHE])
  const dir = join(CACHE, 'Britfone-master')
  const files = await readdir(dir)
  const main = files.find((file) => /britfone\.main.*\.csv$/.test(file))
  if (!main) throw new Error('Britfone main csv not found')
  await writeFile(path, await readFile(join(dir, main)))
}

async function downloadCmu(path) {
  const response = await fetch('https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict')
  if (!response.ok) throw new Error('CMUdict download failed')
  await writeFile(path, Buffer.from(await response.arrayBuffer()))
}

const ARPABET_IPA = {
  AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', B: 'b', CH: 'tʃ', D: 'd', DH: 'ð',
  EH: 'ɛ', ER: 'ɝ', EY: 'eɪ', F: 'f', G: 'ɡ', HH: 'h', IH: 'ɪ', IY: 'i', JH: 'dʒ', K: 'k', L: 'l',
  M: 'm', N: 'n', NG: 'ŋ', OW: 'oʊ', OY: 'ɔɪ', P: 'p', R: 'ɹ', S: 's', SH: 'ʃ', T: 't', TH: 'θ',
  UH: 'ʊ', UW: 'u', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
}

function loadBritfone(text) {
  const map = new Map()
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf(',')
    if (index <= 0) continue
    let word = line.slice(0, index).trim().toLowerCase().replace(/\(\d+\)$/, '')
    word = word.replace(/_/g, ' ').trim()
    if (!word) continue
    const ipa = line.slice(index + 1).trim().replace(/\s+/g, ' ')
    if (!map.has(word) && ipa) map.set(word, '/' + ipa + '/')
  }
  return map
}

function loadCmu(text) {
  const map = new Map()
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith(';;;')) continue
    const [raw, ...phones] = line.trim().split(/\s+/)
    if (!raw || !phones.length) continue
    const word = raw.toLowerCase().replace(/\(\d+\)$/, '')
    if (!map.has(word)) map.set(word, phones.join(' '))
  }
  return map
}

function arpabetToIpa(phones) {
  return '/' + phones.split(/\s+/).map((phone) => ARPABET_IPA[phone.replace(/\d/g, '')] || '').join('').replace(/^\//, '') + '/'
}

function phraseLookup(phrase, brit, cmu) {
  const lower = phrase.toLowerCase().trim()
  if (brit.has(lower) || cmu.has(lower)) {
    return { ipaUk: brit.get(lower) || null, ipaUs: cmu.has(lower) ? arpabetToIpa(cmu.get(lower)) : null, arpabetUs: cmu.get(lower) || null }
  }
  const words = lower.split(/\s+/).filter(Boolean)
  if (!words.length) return { ipaUk: null, ipaUs: null, arpabetUs: null }
  let uk = []
  let us = []
  let arp = []
  for (const word of words) {
    if (!brit.has(word) || !cmu.has(word)) return { ipaUk: null, ipaUs: null, arpabetUs: null }
    uk.push(brit.get(word).replace(/^\/|\/$/g, ''))
    us.push(arpabetToIpa(cmu.get(word)).replace(/^\/|\/$/g, ''))
    arp.push(cmu.get(word))
  }
  return { ipaUk: '/' + uk.join(' ') + '/', ipaUs: '/' + us.join(' ') + '/', arpabetUs: arp.join(' | ') }
}

function phoneticKey(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((word) => {
    let value = word
      .replace(/ph/g, 'f').replace(/th/g, '0').replace(/sh/g, 's').replace(/ch/g, 'c')
      .replace(/[aeiouy]+/g, 'a').replace(/[^a-z0-9]/g, '')
    value = value.replace(/[bfpv]/g, 'p').replace(/[cgjkqsxz]/g, 'k').replace(/[dt]/g, 't')
      .replace(/[mn]/g, 'n').replace(/[lr]/g, 'l').replace(/[hw]/g, 'w')
    return value.replace(/(.)\1+/g, '$1').slice(0, 10)
  }).join(' ')
}

function stripWiki(value) {
  let text = String(value || '')
  text = text.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
  text = text.replace(/<ref[^>]*\/>/gi, '')
  text = text.replace(/\{\{[^{}]*\}\}/g, '')
  for (let i = 0; i < 3; i += 1) text = text.replace(/\{\{[^{}]*\}\}/g, '')
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
  text = text.replace(/\[\[([^\]]+)\]\]/g, '$1')
  text = text.replace(/\[https?:\/\/[^\s\]]+\s*([^\]]*)\]/g, '$1')
  text = text.replace(/'''?/g, '').replace(/<[^>]+>/g, '')
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  return text.replace(/\s+/g, ' ').trim()
}

function cleanTerm(value) {
  let text = stripWiki(value)
  text = text.replace(/\s*\([^)]*\)\s*$/, '').trim()
  text = text.replace(/^the\s+/i, '').trim()
  text = text.replace(/[,;:]+$/, '').trim()
  return text
}

function parseGlossary(wikitext, domains) {
  const records = []
  const matches = [...wikitext.matchAll(/\{\{term\|([^}]*)\}\}/gi)]
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const source = cleanTerm(match[1])
    if (!source || source.length < 2 || source.length > 70) continue
    const words = source.split(/\s+/).filter(Boolean)
    if (words.length > 6) continue
    const start = match.index + match[0].length
    const end = matches[index + 1]?.index ?? wikitext.length
    const block = wikitext.slice(start, end)
    const defMatch = block.match(/\{\{defn\|([\s\S]*)$/i)
    const definition = cleanTerm(defMatch ? defMatch[1] : block).slice(0, 500)
    const link = match[1].match(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/)
    records.push({ source, definition, domains, page: link ? link[1].trim() : null, sourceType: 'wikipedia-glossary' })
  }
  return records
}

async function fetchWikitext(page) {
  const data = await api({ action: 'parse', page, prop: 'wikitext', redirects: '1' })
  return data?.parse?.wikitext || ''
}

async function fetchLanglinks(titles) {
  const map = new Map()
  for (let offset = 0; offset < titles.length; offset += 25) {
    const batch = titles.slice(offset, offset + 25)
    const data = await api({ action: 'query', titles: batch.join('|'), prop: 'langlinks', lllang: 'zh', lllimit: 'max', redirects: '1' })
    for (const page of data?.query?.pages || []) {
      const title = page.title
      const zh = page.langlinks?.[0]?.title
      if (title && zh) map.set(title, zh)
    }
    await sleep(450)
  }
  return map
}

async function fetchCategory(category, domains) {
  const data = await api({ action: 'query', list: 'categorymembers', cmtitle: category, cmtype: 'page', cmlimit: '500' })
  const titles = (data?.query?.categorymembers || []).map((item) => item.title).filter(Boolean)
  const records = []
  for (let offset = 0; offset < titles.length; offset += 25) {
    const batch = titles.slice(offset, offset + 25)
    const extracts = await api({ action: 'query', titles: batch.join('|'), prop: 'extracts', exintro: '1', explaintext: '1', redirects: '1' })
    for (const page of extracts?.query?.pages || []) {
      const title = stripWiki(String(page.title || '').replace(/\s*\([^)]*\)\s*$/, '')).trim()
      if (!title || title.length < 3 || title.length > 60) continue
      const words = title.split(/\s+/).filter(Boolean)
      if (words.length > 5) continue
      const definition = stripWiki(page.extract || '').split(/(?<=[.!?])\s+/)[0]?.slice(0, 400) || ''
      if (!definition) continue
      records.push({ source: title, definition, domains, page: page.title, sourceType: 'wikipedia-category' })
    }
    await sleep(450)
  }
  return records
}

async function main() {
  await mkdir(OUT, { recursive: true })
  await mkdir(CACHE, { recursive: true })
  const britPath = await loadCached('britfone.main.csv', downloadBritfone)
  const cmuPath = await loadCached('cmudict.dict', downloadCmu)
  const brit = loadBritfone(await readFile(britPath, 'utf8'))
  const cmu = loadCmu(await readFile(cmuPath, 'utf8'))
  const curatedMain = JSON.parse(await readFile(join(ROOT, 'assets', 'terminology', 'curated.json'), 'utf8')).terms
  let curatedExtra = []
  try {
    curatedExtra = JSON.parse(await readFile(join(ROOT, 'assets', 'terminology', 'curated-extra.json'), 'utf8')).terms
  } catch {}
  const curated = [...curatedMain, ...curatedExtra]
  const records = []
  for (const item of curated) {
    records.push({
      source: item.source,
      definition: item.definition || '',
      domains: item.domains || ['tech'],
      aliases: item.aliases || [],
      confusions: item.confusions || [],
      zh: item.zh || '',
      priority: 100,
      sourceType: 'curated',
    })
  }
  for (const spec of PAGES) {
    console.log('glossary', spec.page)
    try {
      const wikitext = await fetchWikitext(spec.page)
      const parsed = parseGlossary(wikitext, spec.domains)
      console.log('  ', parsed.length)
      records.push(...parsed)
    } catch (error) { console.warn('  failed:', error.message) }
  }
  for (const spec of CATEGORIES) {
    if (process.env.EXPAND_CATEGORIES !== '1') break
    console.log('category', spec.category)
    try {
      const parsed = await fetchCategory(spec.category, spec.domains)
      console.log('  ', parsed.length)
      records.push(...parsed)
    } catch (error) { console.warn('  failed:', error.message) }
  }
  // Chinese names for records with a linked article.
  const pageTitles = [...new Set(records.map((item) => item.page).filter(Boolean))]
  console.log('langlinks for', pageTitles.length, 'pages')
  const zhMap = process.env.FETCH_LANG === '1' ? await fetchLanglinks(pageTitles) : new Map()
  const merged = new Map()
  for (const item of records) {
    const source = cleanTerm(item.source)
    if (!source) continue
    const key = source.toLowerCase()
    const existing = merged.get(key)
    const zh = item.zh || (item.page ? zhMap.get(item.page) : '') || ''
    if (!existing) {
      merged.set(key, { ...item, source, zh, aliases: [...(item.aliases || [])], confusions: [...(item.confusions || [])], domains: [...new Set(item.domains || ['tech'])] })
      continue
    }
    existing.domains = [...new Set([...existing.domains, ...(item.domains || [])])]
    existing.aliases = [...new Set([...existing.aliases, ...(item.aliases || [])])]
    existing.confusions = [...new Set([...existing.confusions, ...(item.confusions || [])])]
    if (!existing.zh && zh) existing.zh = zh
    if (!existing.definition && item.definition) existing.definition = item.definition
    if ((item.priority || 0) > (existing.priority || 0)) existing.priority = item.priority
  }
  const terms = [...merged.values()]
    .filter((item) => item.source && item.source.length <= 70 && !/^(list of|outline of|index of)/i.test(item.source))
    .map((item, index) => {
      const pron = phraseLookup(item.source, brit, cmu)
      return {
        id: item.source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'term-' + index,
        source: item.source,
        aliases: [...new Set((item.aliases || []).map((alias) => String(alias).trim()).filter(Boolean))].slice(0, 12),
        zh: item.zh || '',
        domains: item.domains,
        definition: (item.definition || '').slice(0, 500),
        ipaUk: pron.ipaUk,
        ipaUs: pron.ipaUs,
        arpabetUs: pron.arpabetUs,
        phoneticKey: phoneticKey(item.source),
        confusions: [...new Set((item.confusions || []).map((value) => String(value).trim()).filter(Boolean))].slice(0, 12),
        sources: [item.sourceType],
        priority: item.priority || 10,
        license: item.sourceType === 'curated' ? 'project' : 'CC-BY-SA-4.0',
      }
    })
  terms.sort((a, b) => (b.priority - a.priority) || a.source.localeCompare(b.source))
  const jsonl = terms.map((term) => JSON.stringify(term)).join('\n') + '\n'
  const compressed = gzipSync(Buffer.from(jsonl), { level: 9 })
  await writeFile(join(OUT, 'terms.jsonl.gz'), compressed)
  const domains = {}
  for (const term of terms) for (const domain of term.domains) domains[domain] = (domains[domain] || 0) + 1
  const manifest = {
    version: new Date().toISOString().slice(0, 10),
    count: terms.length,
    domains,
    zhCount: terms.filter((term) => term.zh).length,
    ipaCount: terms.filter((term) => term.ipaUk || term.ipaUs).length,
    sources: ['Wikipedia glossaries (CC BY-SA 4.0)', 'Britfone (MIT)', 'CMUdict (BSD-2-Clause)', 'project curated core'],
    sha256: createHash('sha256').update(compressed).digest('hex'),
    bytes: compressed.length,
  }
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log('built', manifest)
}

main().catch((error) => { console.error(error); process.exit(1) })
