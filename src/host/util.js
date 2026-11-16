import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Send one JSON response and end it. */
export function sendJson(res, status, payload) {
  if (res.headersSent) return
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
}

/** Read a request body with a hard byte ceiling. */
export function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      req.removeListener('data', onData)
      req.removeListener('end', onEnd)
      req.removeListener('error', onError)
      req.resume()
      reject(error)
    }
    const onData = (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        fail(Object.assign(new Error('请求体过大'), { code: 'BODY_TOO_LARGE', status: 413 }))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    }
    const onError = (error) => fail(error)
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

/** Read a JSON body and fail with a stable error code. */
export async function readJson(req, maxBytes) {
  const raw = await readBody(req, maxBytes)
  try {
    return JSON.parse(raw.toString('utf8') || '{}')
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { code: 'INVALID_JSON', status: 400 })
  }
}

/** Write one file atomically (temp file + rename). */
export async function writeFileAtomic(path, data) {
  await mkdir(dirname(path), { recursive: true })
  const temp = path + '.tmp-' + process.pid + '-' + Date.now()
  await writeFile(temp, data)
  await rename(temp, path)
}

/** Append one JSON line; callers serialize their own writes. */
export function toJsonLine(value) {
  return JSON.stringify(value) + '\n'
}

/** Convert an unknown failure into a stable wire shape. */
export function errorPayload(error, fallbackCode = 'INTERNAL') {
  return {
    code: String(error?.code || fallbackCode),
    message: String(error?.message || error || '未知错误'),
  }
}

/** Log to the DSH console under one prefix without leaking audio. */
export function createLogger(scope) {
  const prefix = '[' + scope + ']'
  return {
    info: (...args) => console.log(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  }
}
