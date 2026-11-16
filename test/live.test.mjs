import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InterpretService } from '../src/host/service.js'
import { normalizeConfig } from '../src/host/config.js'
import { float32ToPcm16, decodeWav } from '../src/host/audio.js'

const FIXTURE = new URL('./fixtures/eigenvalue-voice.wav', import.meta.url)

function fakeContext() {
  const llm = {
    listProviders: async () => [{ id: 'deepseek-account', name: 'DeepSeek' }],
    listModels: async () => [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }],
    stream: async () => (async function* () {
      yield { type: 'text-delta', text: '特征值分解总是可能的。' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(),
  }
  return { get: (name) => name === 'llm' ? llm : undefined }
}

test('live captions update word by word and are replaced by the final caption', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-live-'))
  const service = new InterpretService(fakeContext(), normalizeConfig({
    dataDir: dir,
    asrProvider: 'parakeet-local',
    systemAudio: 'off',
    vadMode: 'energy',
    minSpeechMs: 200,
    silenceMs: 500,
    vadThreshold: 0.008,
    draftMode: false,
    streamingMode: 'auto',
    liveTranslate: true,
    liveTranslateIntervalMs: 700,
  }))
  t.after(async () => {
    service.dispose()
    await new Promise((resolve) => setTimeout(resolve, 150))
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  })
  const lives = []
  service.on((type, payload) => { if (type === 'live') lives.push(payload) })
  await service.start({ title: 'live-test' })
  if (!service.streamingReady) {
    t.skip('streaming model is not available')
    return
  }
  const wav = decodeWav(await readFile(FIXTURE))
  const chunk = 1600
  for (let offset = 0; offset < wav.samples.length; offset += chunk) {
    const part = wav.samples.subarray(offset, Math.min(offset + chunk, wav.samples.length))
    service.pushAudio('mic', Buffer.from(float32ToPcm16(part).buffer))
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  service.pushAudio('mic', Buffer.from(new Float32Array(16000 * 1.2).buffer))
  for (let i = 0; i < 80; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (service.segments.some((segment) => segment.status === 'done' || segment.status === 'error')) break
  }
  await service.stop()
  const partials = lives.filter((item) => !item.cleared)
  assert.ok(partials.length >= 8, 'expected many live updates, got ' + partials.length)
  assert.ok(partials.some((item) => /symmetric/i.test(item.en)), 'expected symmetric in a live partial')
  assert.ok(partials.some((item) => item.zh), 'expected a provisional Chinese translation')
  assert.ok(lives.some((item) => item.cleared), 'expected the live row to be cleared before the final caption')
  const final = service.segments.find((segment) => segment.status === 'done')
  assert.ok(final, 'expected a final caption')
  assert.ok(final.en.includes('eigenvalue'))
  assert.ok(final.zh.includes('特征值'))
  assert.match(partials[0].en, /^[A-Z]/, 'normalized live text should start with a capital letter')
  assert.equal(service.statsView().liveUpdates >= 8, true)
})
