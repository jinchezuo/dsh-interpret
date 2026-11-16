import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeWav } from './audio.js'

const HELPER_RELATIVE = 'recording-helper/DSHASRRecordingHelper.app/Contents/Helpers/dsh-asr-capture-system'
const WINDOWS_HELPER = ['assets', 'system-audio', 'win32-x64', 'dsh-asr-capture-system.exe']
const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const LOCAL_HELPER = join(PACKAGE_ROOT, 'assets', 'system-audio', HELPER_RELATIVE)

/** Candidate helper paths for the current platform, bundled first. */
export function systemHelperCandidates(platform = process.platform) {
  const candidates = []
  if (platform === 'win32') {
    candidates.push(join(PACKAGE_ROOT, ...WINDOWS_HELPER))
    return candidates
  }
  if (platform !== 'darwin') return candidates
  candidates.push(LOCAL_HELPER)
  const addProfile = (dir) => {
    if (dir) candidates.push(join(dir, 'node_modules', '@huliux', 'dsh-asr-plugin', 'dist', HELPER_RELATIVE))
  }
  addProfile(String(process.env.DSH_PROFILE_DIR || '').trim())
  const home = String(process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh')
  const profile = String(process.env.DSH_PROFILE || '').trim()
  if (profile) addProfile(join(home, 'profiles', profile))
  try {
    for (const name of readdirSync(join(home, 'profiles'))) addProfile(join(home, 'profiles', name))
  } catch {}
  addProfile(join(home, 'profiles', 'desktop'))
  try {
    const require = createRequire(import.meta.url)
    const entry = require.resolve('@huliux/dsh-asr-plugin')
    candidates.push(join(dirname(entry), HELPER_RELATIVE))
  } catch {}
  candidates.push(join(PACKAGE_ROOT, 'node_modules', '@huliux', 'dsh-asr-plugin', 'dist', HELPER_RELATIVE))
  return candidates
}

/** Locate the bundled helper for the current platform (macOS external fallback kept). */
export function findSystemCaptureHelper() {
  const unique = [...new Set(systemHelperCandidates())]
  for (const candidate of unique) {
    if (existsSync(candidate)) return { path: candidate, candidates: unique }
  }
  return { path: null, candidates: unique }
}


/**
 * Spawn the platform capture helper (ScreenCaptureKit on macOS, WASAPI
 * loopback on Windows) and turn its 1-second WAV chunks into Float32 samples.
 * The DSH application window denies getDisplayMedia on both platforms.
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
      const hint = process.platform === 'win32'
        ? '请安装 win32-x64 包，或运行 scripts/build-win-audio.ps1 生成 Windows helper'
        : '请确认插件资产完整'
      throw Object.assign(new Error('未找到内置的系统音频采集助手：' + hint), {
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
    const child = spawn(found.path, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
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
