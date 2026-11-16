import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findSystemCaptureHelper, systemHelperCandidates } from '../src/host/system-capture.js'
import { resolveVadModel } from '../src/host/silero-vad.js'
import { AsrClient } from '../src/host/asr.js'
import { normalizeConfig } from '../src/host/config.js'

test('system audio helper is bundled inside the plugin', (t) => {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    t.skip('system audio helper is only bundled for macOS and Windows')
    return
  }
  const found = findSystemCaptureHelper()
  assert.ok(found.path, 'helper should be found')
  assert.ok(found.path.includes(join('assets', 'system-audio')), 'bundled helper must be preferred: ' + found.path)
  assert.ok(existsSync(found.path))
})

test('Windows helper path is platform-specific', () => {
  const windows = systemHelperCandidates('win32')
  assert.ok(windows.length === 1)
  assert.ok(windows[0].endsWith(join('system-audio', 'win32-x64', 'dsh-asr-capture-system.exe')), windows[0])
  assert.deepEqual(systemHelperCandidates('linux'), [])
})

test('Silero VAD model is bundled inside the plugin', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-standalone-'))
  const found = resolveVadModel(dir)
  assert.ok(found, 'bundled VAD should be found')
  assert.ok(found.includes(join('assets', 'models', 'silero_vad.onnx')), found)
  await rm(dir, { recursive: true, force: true })
})

test('local Parakeet is selected without an external speechToText service', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-standalone-'))
  const ctx = { get: () => undefined }
  const asr = new AsrClient(ctx, normalizeConfig({ dataDir: dir, asrProvider: 'parakeet-local', streamingMode: 'off' }), console, dir)
  const providers = asr.allProviders()
  assert.ok(providers.some((provider) => provider.id === 'parakeet-local'))
  assert.equal(asr.pickProvider()?.id, 'parakeet-local')
  await rm(dir, { recursive: true, force: true })
})
