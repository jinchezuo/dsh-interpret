import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import WordExtractor from 'word-extractor'

const execFileAsync = promisify(execFile)
const RENDER_SCRIPT = fileURLToPath(new URL('./readers/render.py', import.meta.url))
const DOC_FALLBACK_CSS = 'body{margin:0;padding:20px 22px 40px;background:#fff;color:#1f2328;font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}pre{white-space:pre-wrap;word-break:break-word;background:#f6f8fa;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}.meta{color:#6b7280;font-size:12px;margin-bottom:18px}@media(prefers-color-scheme:dark){body{background:#1b1f24;color:#e6e8eb}pre{background:#15191e;border-color:#30363d}}'
const ALLOWED = new Set(['pdf', 'doc', 'docx', 'xlsx', 'csv', 'md', 'pptx'])
const OFFICE = new Set(['doc', 'docx', 'xlsx', 'pptx'])
const MIME = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}
const MAX_BYTES = 100 * 1024 * 1024
const MAX_NAME = 180

function fail(message, code, status) {
  return Object.assign(new Error(message), { code, status })
}

function safeName(raw) {
  let name = basename(String(raw || 'file')).replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!name) name = 'file'
  if (name.length > MAX_NAME) {
    const ext = extname(name)
    name = name.slice(0, Math.max(1, MAX_NAME - ext.length)) + ext
  }
  return name
}

function extOf(name) {
  return extname(String(name || '')).slice(1).toLowerCase()
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

/** Local uploaded handouts for the in-panel reader. No arbitrary paths are read. */
export class ReaderService {
  constructor(dataDir) {
    this.root = join(dataDir, 'reader')
    this.ready = mkdir(this.root, { recursive: true }).catch(() => {})
    this.python = null
  }

  async list() {
    await this.ready
    let names = []
    try { names = await readdir(this.root) } catch { return [] }
    const items = []
    for (const name of names) {
      if (!/^[A-Za-z0-9-]{1,80}$/.test(name)) continue
      try {
        const meta = JSON.parse(await readFile(join(this.root, name, 'meta.json'), 'utf8'))
        if (meta && ALLOWED.has(String(meta.ext))) items.push(this.publicMeta(meta))
      } catch {}
    }
    return items.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 50)
  }

  async save(rawName, buffer) {
    await this.ready
    const name = safeName(rawName)
    const ext = extOf(name)
    if (!ALLOWED.has(ext)) throw fail('不支持的文件格式，仅支持 PDF、Word、Excel、CSV、Markdown、PowerPoint', 'UNSUPPORTED_FILE', 415)
    if (!buffer || !buffer.length) throw fail('文件为空', 'EMPTY_FILE', 400)
    if (buffer.length > MAX_BYTES) throw fail('文件超过 100MB 限制', 'FILE_TOO_LARGE', 413)
    const id = Date.now().toString(36) + '-' + randomUUID().slice(0, 8)
    const dir = join(this.root, id)
    await mkdir(dir, { recursive: true })
    const source = 'source.' + ext
    await writeFile(join(dir, source), buffer)
    const meta = {
      id,
      name,
      ext,
      size: buffer.length,
      mime: MIME[ext] || 'application/octet-stream',
      source,
      createdAt: Date.now(),
    }
    await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
    return this.publicMeta(meta)
  }

  async get(id) {
    await this.ready
    if (!/^[A-Za-z0-9-]{1,80}$/.test(String(id || ''))) throw fail('文件 id 不合法', 'INVALID_FILE_ID', 400)
    const dir = join(this.root, String(id))
    if (!resolve(dir).startsWith(resolve(this.root) + sep)) throw fail('文件路径不合法', 'INVALID_FILE_ID', 400)
    let meta
    try { meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) } catch {
      throw fail('文件不存在', 'FILE_NOT_FOUND', 404)
    }
    if (!meta || meta.id !== id || !ALLOWED.has(String(meta.ext))) throw fail('文件不存在', 'FILE_NOT_FOUND', 404)
    const sourcePath = join(dir, String(meta.source || ('source.' + meta.ext)))
    return { ...meta, dir, sourcePath }
  }

  async remove(id) {
    const meta = await this.get(id)
    await rm(meta.dir, { recursive: true, force: true })
    return this.publicMeta(meta)
  }

  async readRaw(id) {
    const meta = await this.get(id)
    return { meta, buffer: await readFile(meta.sourcePath) }
  }

  async renderWithPython(meta, cache) {
    const python = await this.findPython(meta.ext)
    const args = [RENDER_SCRIPT, '--input', meta.sourcePath, '--out', meta.dir, '--ext', meta.ext]
    await execFileAsync(python, args, { timeout: 90_000, maxBuffer: 8 * 1024 * 1024 })
    return { meta, html: await readFile(cache, 'utf8') }
  }

  async renderDocFallback(meta, cache) {
    const extractor = new WordExtractor()
    const document = await extractor.extract(meta.sourcePath)
    const text = String(document.getBody() || '').trim()
    if (!text) throw new Error('文档没有可提取的文字')
    const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>' + DOC_FALLBACK_CSS + '</style></head><body>' +
      '<div class="meta">本地讲义阅读器</div><pre>' + escapeHtml(text) + '</pre></body></html>'
    await writeFile(cache, html)
    return { meta, html }
  }

  async render(id) {
    const meta = await this.get(id)
    if (!OFFICE.has(meta.ext)) throw fail('该格式不需要 HTML 渲染', 'NOT_RENDERABLE', 415)
    const cache = join(meta.dir, 'render.html')
    try {
      return { meta, html: await readFile(cache, 'utf8') }
    } catch {}
    try {
      return await this.renderWithPython(meta, cache)
    } catch (error) {
      const detail = String(error?.stderr || error?.message || error).trim().slice(0, 1200)
      if (meta.ext === 'doc') {
        try {
          return await this.renderDocFallback(meta, cache)
        } catch (fallbackError) {
          throw fail('文档解析失败：' + detail + '；DOC 兜底也失败：' + String(fallbackError?.message || fallbackError), 'RENDER_FAILED', 422)
        }
      }
      throw fail('文档解析失败：' + detail, 'RENDER_FAILED', 422)
    }
  }

  async findPython(ext) {
    if (this.python) return this.python
    const home = String(process.env.DSH_HOME || '').trim() || join(process.env.USERPROFILE || process.env.HOME || homedir(), '.dsh')
    const bundled = []
    try {
      for (const name of await readdir(join(home, 'dsh-runtimes'))) {
        const root = join(home, 'dsh-runtimes', name, 'dependencies', 'python')
        bundled.push(
          join(root, 'bin', 'python3'),
          join(root, 'bin', 'python.exe'),
          join(root, 'bin', 'python3.exe'),
          join(root, 'python.exe'),
          join(root, 'python3'),
        )
      }
    } catch {}
    const candidates = [
      process.env.DSH_PYTHON,
      ...bundled,
      process.platform === 'win32' ? 'python' : 'python3',
      process.platform === 'win32' ? 'py' : 'python3',
      '/Library/Frameworks/Python.framework/Versions/3.14/bin/python3',
      '/usr/local/bin/python3',
      '/opt/homebrew/bin/python3',
      '/usr/bin/python3',
    ].filter(Boolean)
    for (const candidate of candidates) {
      try {
        await execFileAsync(candidate, ['-c', 'import sys; print(sys.version_info[0])'], { timeout: 5000 })
        this.python = candidate
        return candidate
      } catch {}
    }
    throw fail('找不到可用的 Python 解释器，无法解析 Office 文档', 'PYTHON_NOT_FOUND', 500)
  }

  mimeFor(meta) {
    return MIME[meta.ext] || 'application/octet-stream'
  }

  publicMeta(meta) {
    return {
      id: meta.id,
      name: meta.name,
      ext: meta.ext,
      size: meta.size,
      mime: meta.mime,
      createdAt: meta.createdAt,
    }
  }
}

export { MAX_BYTES, ALLOWED, MIME }

/** Send one local file with safe headers. */
export async function sendReaderFile(res, meta, contentType) {
  const info = await stat(meta.sourcePath)
  const filename = encodeURIComponent(meta.name).replace(/'/g, '%27')
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': info.size,
    'Content-Disposition': "inline; filename*=UTF-8''" + filename,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "frame-ancestors 'self'",
  })
  createReadStream(meta.sourcePath).pipe(res)
}
