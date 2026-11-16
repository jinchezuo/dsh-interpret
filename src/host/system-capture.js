import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { decodeWav } from './audio.js'

const HELPER_RELATIVE = 'recording-helper/DSHASRRecordingHelper.app/Contents/Helpers/dsh-asr-capture-system'

/** Locate the signed ScreenCaptureKit helper shipped by @huliux/dsh-asr-plugin. */
export function findSystemCaptureHelper() {
  const candidates = []
  const profileDir = String(process.env.DSH_PROFILE_DIR || '').trim()
  if (profileDir) candidates.push(join(profileDir, 'node_modules', '@huliux', 'dsh-asr-plugin', 'dist', HELPER_RELATIVE))
  try {
    const require = createRequire(import.meta.url)
    const entry = require.resolve('@huliux/dsh-asr-plugin')
    candidates.push(join(dirname(entry), HELPER_RELATIVE))
  } catch {}
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { path: candidate, candidates }
  }
  return { path: null, candidates }
}

/**
 * Spawn the external capture helper and turn its 1-second WAV chunks into
 * Float32 samples. The helper is the only macOS path available to a DSH
 * plugin: the application window denies getDisplayMedia.
 */
export class SystemCapture {
  constructor({ sessionDir, log, onSamples, onError }) {
    this.sessionDir = sessionDir
    this.outputDir = join(sessionDir, 'system-audio')
    this.log = log
    this.onSamples = onSamples
    this.onError = onError
    this.child = null
    this.seen = new Set()
    this.sizes = new Map()
    this.timer = null
    this.scanning = false
    this.stderr = []
    this.started = false
    this.helperPath = null
  }

  async start() {
    if (this.started) return { started: true }
    const found = findSystemCaptureHelper()
    if (!found.path) {
      throw Object.assign(new Error('未找到 dsh-asr-plugin 的系统音频采集助手'), {
        code: 'SYSTEM_CAPTURE_UNAVAILABLE',
        candidates: found.candidates,
      })
    }
    this.helperPath = found.path
    await mkdir(this.outputDir, { recursive: true })
    const args = [
      '--mode', 'audio-capture',
      '--recording-source', 'system-audio',
      '--output-dir', this.outputDir,
      '--chunk-size', '1',
      '--sample-rate', '16000',
      '--bits-per-sample', '16',
      '--channels', '1',
    ]
    const child = spawn(found.path, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    this.child = child
    this.started = true
    child.stderr.on('data', (chunk) => {
      this.stderr.push(String(chunk))
      if (this.stderr.length > 40) this.stderr.shift()
    })
    child.on('exit', (code, signal) => {
      this.started = false
      this.child = null
      if (this.timer) clearInterval(this.timer)
      this.timer = null
      if (this.intentionalStop) return
      const detail = this.stderr.join('').slice(-1200)
      this.onError?.(Object.assign(new Error('系统音频采集助手退出（code=' + code + ', signal=' + signal + '）'), {
        code: 'SYSTEM_CAPTURE_EXITED',
        detail,
      }))
    })
    child.on('error', (error) => {
      this.onError?.(Object.assign(error, { code: 'SYSTEM_CAPTURE_FAILED' }))
    })
    await new Promise((resolve) => setTimeout(resolve, 900))
    this.timer = setInterval(() => { this.scan().catch(() => {}) }, 250)
    await this.scan()
    return { started: true, helper: found.path }
  }

  async scan() {
    if (this.scanning) return
    this.scanning = true
    try {
      let files = []
      try { files = await readdir(this.outputDir) } catch { return }
      const candidates = files.filter((name) => name.endsWith('-system.wav') && !this.seen.has(name)).sort()
      for (const name of candidates) {
        const path = join(this.outputDir, name)
        let info
        try { info = await stat(path) } catch { continue }
        const size = info.size
        if (this.sizes.get(name) !== size) {
          this.sizes.set(name, size)
          continue
        }
        if (Date.now() - info.mtimeMs < 200) continue
        this.seen.add(name)
        try {
          const buffer = await readFile(path)
          const decoded = decodeWav(buffer)
          if (decoded.samples.length) this.onSamples?.(decoded.samples)
          await rm(path, { force: true })
        } catch (error) {
          this.log?.warn('system chunk decode failed:', error?.message || error)
          this.seen.delete(name)
        }
      }
    } finally {
      this.scanning = false
    }
  }

  async stop() {
    this.intentionalStop = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const child = this.child
    if (child) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try { child.kill('SIGKILL') } catch {}
          resolve()
        }, 2500)
        child.once('exit', () => { clearTimeout(timer); resolve() })
        try { child.kill('SIGTERM') } catch { clearTimeout(timer); resolve() }
      })
    }
    this.child = null
    this.started = false
    await new Promise((resolve) => setTimeout(resolve, 300))
    // Process every remaining stable chunk before returning.
    try { this.sizes.clear(); await this.scan() } catch {}
    try { this.sizes.clear(); await this.scan() } catch {}
  }
}
