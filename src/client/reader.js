import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'

const ACCEPT = '.pdf,.doc,.docx,.xlsx,.csv,.md,.pptx'
const MAX_BYTES = 100 * 1024 * 1024
const LAST_KEY = 'dsh-interpret.reader.last'
const FENCE = String.fromCharCode(96, 96, 96)

function fmtSize(bytes) {
  const n = Number(bytes || 0)
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB'
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB'
  return n + ' B'
}

function isText(ext) {
  return ext === 'md' || ext === 'csv'
}

async function readJson(response) {
  let payload = null
  try { payload = await response.json() } catch {}
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error?.message || ('HTTP ' + response.status))
  }
  return payload?.data
}

async function readText(response) {
  const body = await response.text()
  if (!response.ok) {
    try {
      const payload = JSON.parse(body)
      throw new Error(payload?.error?.message || ('HTTP ' + response.status))
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('HTTP ' + response.status)
      throw error
    }
  }
  return body
}

function safeHref(url) {
  const value = String(url || '').trim()
  if (/^(https?:|mailto:|#|\/)/i.test(value)) return value
  return '#'
}

function renderInline(text, keyPrefix = 'i') {
  const source = String(text || '')
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\)|\x60[^\x60]+\x60)/g
  const nodes = []
  let last = 0
  let match
  let index = 0
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > last) nodes.push(source.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('**') || token.startsWith('__')) nodes.push(h('strong', { key: keyPrefix + index++ }, token.slice(2, -2)))
    else if (token.charCodeAt(0) === 96) nodes.push(h('code', { key: keyPrefix + index++ }, token.slice(1, -1)))
    else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      if (link) nodes.push(h('a', { key: keyPrefix + index++, href: safeHref(link[2]), target: '_blank', rel: 'noreferrer' }, link[1]))
      else nodes.push(token)
    } else nodes.push(h('em', { key: keyPrefix + index++ }, token.slice(1, -1)))
    last = pattern.lastIndex
  }
  if (last < source.length) nodes.push(source.slice(last))
  return nodes
}

function parseCsv(text) {
  const source = String(text || '')
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i += 1 }
      else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (char !== '\r') field += char
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

function CsvTable({ text }) {
  const rows = useMemo(() => parseCsv(text), [text])
  if (!rows.length) return h('div', { className: 'di-reader-state' }, 'CSV 没有内容。')
  const width = Math.min(80, Math.max(...rows.map((row) => row.length)))
  const header = rows[0]
  const body = rows.slice(1, 2001)
  const head = h('thead', null, h('tr', null, Array.from({ length: width }, (_, i) => h('th', { key: 'h' + i }, header[i] || ''))))
  const columnKeys = Array.from({ length: width }, (_, i) => i)
  const lines = body.map((row, r) => h('tr', { key: 'r' + r }, columnKeys.map((c) => h('td', { key: 'c' + c }, row[c] || ''))))
  const table = h('table', { className: 'di-reader-table' }, head, h('tbody', null, lines))
  return h('div', { className: 'di-reader-table-wrap' },
    rows.length > 2001 ? h('div', { className: 'di-reader-hint' }, '表格超过 2000 行，已截断。') : null,
    table)
}

function MarkdownView({ text }) {
  const nodes = useMemo(() => {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
    const result = []
    let i = 0
    let key = 0
    while (i < lines.length) {
      const line = lines[i]
      if (/^\s*$/.test(line)) { i += 1; continue }
      if (line.startsWith(FENCE)) {
        const code = []
        i += 1
        while (i < lines.length && !lines[i].startsWith(FENCE)) { code.push(lines[i]); i += 1 }
        i += 1
        result.push(h('pre', { key: 'p' + key++ }, h('code', null, code.join('\n'))))
        continue
      }
      const heading = /^(#{1,6})\s+(.*)$/.exec(line)
      if (heading) {
        const level = Math.min(6, heading[1].length)
        result.push(h('h' + level, { key: 'h' + key++ }, renderInline(heading[2], 'h' + key)))
        i += 1
        continue
      }
      if (/^>\s?/.test(line)) {
        const quote = []
        while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i += 1 }
        result.push(h('blockquote', { key: 'q' + key++ }, renderInline(quote.join(' '), 'q' + key)))
        continue
      }
      if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
        const ordered = /^\s*\d+\.\s+/.test(line)
        const items = []
        while (i < lines.length && (ordered ? /^\s*\d+\.\s+/.test(lines[i]) : /^\s*[-*+]\s+/.test(lines[i]))) {
          items.push(lines[i].replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/, ''))
          i += 1
        }
        result.push(h(ordered ? 'ol' : 'ul', { key: 'l' + key++ }, items.map((item, index) => h('li', { key: index }, renderInline(item, 'li' + key + index)))))
        continue
      }
      if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|/.test(lines[i + 1])) {
        const split = (row) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim())
        const header = split(line)
        i += 2
        const body = []
        while (i < lines.length && lines[i].includes('|')) { body.push(split(lines[i])); i += 1 }
        const head = h('thead', null, h('tr', null, header.map((cell, index) => h('th', { key: index }, renderInline(cell, 'th' + index)))))
        const bodyRows = body.map((row, rowIndex) => h('tr', { key: rowIndex }, row.map((cell, cellIndex) => h('td', { key: cellIndex }, renderInline(cell, 'td' + rowIndex + cellIndex)))))
        result.push(h('table', { key: 't' + key++, className: 'di-reader-table' }, head, h('tbody', null, bodyRows)))
        continue
      }
      const paragraph = [line]
      i += 1
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|>|\s*[-*+]\s+|\s*\d+\.\s+)/.test(lines[i]) && !lines[i].startsWith(FENCE) && !(lines[i].includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|/.test(lines[i + 1]))) {
        paragraph.push(lines[i]); i += 1
      }
      result.push(h('p', { key: 'p' + key++ }, renderInline(paragraph.join(' '), 'p' + key)))
    }
    return result
  }, [text])
  return h('div', { className: 'di-reader-markdown' }, nodes)
}

function Loading() {
  return h('div', { className: 'di-reader-state' }, h('span', { className: 'di-reader-spinner' }), h('span', null, '正在加载讲义…'))
}

export function ReaderPane({ onClose }) {
  const [files, setFiles] = useState([])
  const [currentId, setCurrentId] = useState(null)
  const [meta, setMeta] = useState(null)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [html, setHtml] = useState('')
  const [text, setText] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const inputRef = useRef(null)
  const objectUrlRef = useRef('')

  const choose = (next) => {
    setMeta(next || null)
    setCurrentId(next?.id || null)
    setError(null)
    try {
      if (next) localStorage.setItem(LAST_KEY, next.id)
      else localStorage.removeItem(LAST_KEY)
    } catch {}
  }

  const loadFiles = async () => {
    try {
      const response = await fetch('/interpret/api/reader/files', { cache: 'no-store' })
      const list = (await readJson(response)) || []
      setFiles(list)
      let saved = ''
      try { saved = localStorage.getItem(LAST_KEY) || '' } catch {}
      const next = list.find((item) => item.id === saved) || list[0] || null
      if (next) choose(next)
      return list
    } catch (err) {
      setError(String(err?.message || err))
      return []
    }
  }

  useEffect(() => { loadFiles() }, [])

  useEffect(() => {
    if (!meta) {
      setStatus('idle'); setHtml(''); setText(''); setPdfUrl('')
      return undefined
    }
    let cancelled = false
    let url = ''
    setStatus('loading')
    setError(null)
    setHtml('')
    setText('')
    setPdfUrl('')
    const run = async () => {
      try {
        if (meta.ext === 'pdf') {
          const response = await fetch('/interpret/api/reader/files/' + encodeURIComponent(meta.id) + '/raw', { cache: 'no-store' })
          if (!response.ok) throw new Error('PDF 加载失败：HTTP ' + response.status)
          const blob = await response.blob()
          url = URL.createObjectURL(blob)
          objectUrlRef.current = url
          if (!cancelled) { setPdfUrl(url); setStatus('ready') }
        } else if (isText(meta.ext)) {
          const response = await fetch('/interpret/api/reader/files/' + encodeURIComponent(meta.id) + '/raw', { cache: 'no-store' })
          const body = await readText(response)
          if (!cancelled) { setText(body); setStatus('ready') }
        } else {
          const response = await fetch('/interpret/api/reader/files/' + encodeURIComponent(meta.id) + '/html', { cache: 'no-store' })
          const body = await readText(response)
          if (!cancelled) { setHtml(body); setStatus('ready') }
        }
      } catch (err) {
        if (!cancelled) { setError(String(err?.message || err)); setStatus('error') }
      }
    }
    run()
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
      if (objectUrlRef.current === url) objectUrlRef.current = ''
    }
  }, [meta?.id, meta?.ext, reloadToken])

  const upload = async (file) => {
    if (!file || uploading) return
    if (file.size > MAX_BYTES) { setError('文件超过 100MB 限制'); return }
    setUploading(true)
    setError(null)
    try {
      const response = await fetch('/interpret/api/reader/files?name=' + encodeURIComponent(file.name), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: await file.arrayBuffer(),
      })
      const saved = await readJson(response)
      setFiles((previous) => [saved, ...previous.filter((item) => item.id !== saved.id)])
      choose(saved)
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const removeCurrent = async () => {
    if (!meta) return
    if (!window.confirm('删除这份讲义？')) return
    try {
      const response = await fetch('/interpret/api/reader/files/' + encodeURIComponent(meta.id), { method: 'DELETE' })
      await readJson(response)
      const next = files.filter((item) => item.id !== meta.id)
      setFiles(next)
      choose(next[0] || null)
    } catch (err) {
      setError(String(err?.message || err))
    }
  }

  const onDrop = (event) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer?.files?.[0]
    if (file) upload(file)
  }

  const title = meta?.name || '未选择文件'
  let content
  if (!meta) {
    content = h('div', { className: 'di-reader-empty' },
      h('strong', null, '打开讲义文件'),
      h('p', null, '支持 PDF、Word、Excel、PPT、CSV、Markdown。'),
      h('p', { className: 'di-reader-hint' }, '也可以把文件拖到这里，或点击右上角「打开文件」。'),
      h('button', { className: 'di-btn primary', onClick: () => inputRef.current?.click() }, '选择讲义'))
  } else if (status === 'loading') content = h(Loading)
  else if (status === 'error') content = h('div', { className: 'di-reader-state error' },
    h('span', null, error || '加载失败'),
    h('button', { className: 'di-btn', onClick: () => setReloadToken((value) => value + 1) }, '重试'))
  else if (meta.ext === 'pdf' && pdfUrl) content = h('iframe', { className: 'di-reader-frame', src: pdfUrl, title: meta.name })
  else if (html) content = h('iframe', { className: 'di-reader-frame', srcDoc: html, sandbox: '', title: meta.name })
  else if (meta.ext === 'md') content = h(MarkdownView, { text })
  else if (meta.ext === 'csv') content = h(CsvTable, { text })
  else content = h('div', { className: 'di-reader-state error' }, '没有可显示的内容。')

  return h('div', { className: 'di-reader' },
    h('input', {
      ref: inputRef,
      type: 'file',
      accept: ACCEPT,
      style: { display: 'none' },
      onChange: (event) => upload(event.target.files?.[0]),
    }),
    h('div', { className: 'di-reader-head' },
      h('div', { className: 'di-reader-title' }, h('strong', null, '讲义'), h('span', { className: 'di-reader-name', title }, title)),
      h('span', { className: 'di-reader-spacer' }),
      h('button', { className: 'di-btn ghost', disabled: uploading, onClick: () => inputRef.current?.click() }, uploading ? '上传中…' : '打开文件'),
      h('button', { className: 'di-btn ghost', onClick: () => onClose?.(true), title: '收起右栏' }, '收起')),
    h('div', { className: 'di-reader-tools' },
      files.length
        ? h('select', {
            className: 'di-select di-reader-select',
            value: currentId || '',
            onChange: (event) => choose(files.find((item) => item.id === event.target.value) || null),
          }, files.map((item) => h('option', { key: item.id, value: item.id }, item.name)))
        : h('span', { className: 'di-reader-hint' }, '支持 PDF、Word、Excel、PPT、CSV、Markdown'),
      h('span', { className: 'di-reader-spacer' }),
      meta ? h('span', { className: 'di-reader-meta' }, meta.ext.toUpperCase() + ' · ' + fmtSize(meta.size)) : null,
      meta ? h('button', { className: 'di-btn ghost', disabled: status === 'loading', onClick: () => setReloadToken((value) => value + 1), title: '重新加载' }, '重载') : null,
      meta ? h('button', { className: 'di-btn ghost', onClick: removeCurrent, title: '删除这份讲义' }, '删除') : null,
      pdfUrl ? h('a', { className: 'di-btn ghost', href: pdfUrl, target: '_blank', rel: 'noreferrer' }, '新标签') : null),
    h('div', {
      className: 'di-reader-body' + (dragging ? ' dragging' : ''),
      onDragOver: (event) => { event.preventDefault(); setDragging(true) },
      onDragLeave: () => setDragging(false),
      onDrop,
    }, content, error && status !== 'error' ? h('div', { className: 'di-reader-error' }, error) : null))
}
