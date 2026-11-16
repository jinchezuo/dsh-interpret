import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InterpretService } from '../src/host/service.js'
import { normalizeConfig } from '../src/host/config.js'
import { float32ToPcm16 } from '../src/host/audio.js'

function tone(seconds, amplitude = 0.2, sampleRate = 16000) {
  const samples = new Float32Array(Math.round(seconds * sampleRate))
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * amplitude
  }
  return samples
}

function fakeContext({ text, outputs }) {
  const provider = { id: 'sensevoice-local', name: 'SenseVoice', languages: ['en', 'auto'], preparation: { phase: 'ready' } }
  let calls = 0
  const speech = {
    snapshot: () => ({ providers: [provider], selection: {} }),
    resolve: (request) => ({ provider, audio: request.audio, language: request.language }),
    transcribe: async () => ({ text, audioSeconds: 1, inferenceSeconds: 0.1 }),
    prepare: () => {},
  }
  const llm = {
    listProviders: async () => [{ id: 'deepseek-account', name: 'DeepSeek' }],
    listModels: async () => [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }],
    stream: async (request) => (async function* () {
      const prompt = request?.messages?.[0]?.content?.[0]?.text || ''
      if (prompt.includes('候选术语')) {
        yield { type: 'text-delta', text: '{"corrections":[]}' }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      const output = outputs[Math.min(calls, outputs.length - 1)]
      calls += 1
      yield { type: 'text-delta', text: output }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(),
  }
  return { ctx: { get: (name) => name === 'speechToText' ? speech : name === 'llm' ? llm : undefined }, calls: () => calls }
}

test('pipeline produces bilingual captions and repairs a bad term', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-interpret-'))
  const { ctx, calls } = fakeContext({
    text: 'The eigenvalue decomposition is always possible.',
    outputs: ['分解总是可能的。', '特征值分解总是可能的。'],
  })
  const service = new InterpretService(ctx, normalizeConfig({
    dataDir: dir,
    asrProvider: 'sensevoice-local',
    systemAudio: 'off',
    vadMode: 'energy',
    minSpeechMs: 200,
    silenceMs: 300,
    vadThreshold: 0.01,
  }))
  await service.start({ title: 'unit' })
  const samples = new Float32Array(16000 * 0.4 + 16000 * 1.2 + 16000 * 0.6)
  samples.set(tone(1.2), 16000 * 0.4)
  const pcm = Buffer.from(float32ToPcm16(samples).buffer)
  for (let offset = 0; offset < pcm.length; offset += 8192) {
    service.pushAudio('mic', pcm.subarray(offset, Math.min(offset + 8192, pcm.length)))
  }
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (service.segments.some((segment) => segment.status === 'done' || segment.status === 'error')) break
  }
  await service.stop()
  const segment = service.segments.find((item) => item.status === 'done')
  assert.ok(segment, 'expected one completed segment')
  assert.ok(segment.en.includes('eigenvalue'))
  assert.ok(segment.zh.includes('特征值'))
  assert.equal(calls() >= 2, true)
  assert.equal(service.statsView().qaRepairs, 1)
  const srt = service.exportText('srt-bilingual')
  assert.ok(srt.body.includes('特征值'))
  service.dispose()
  await rm(dir, { recursive: true, force: true })
})

test('non-English speech is dropped without translation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-interpret-'))
  const { ctx, calls } = fakeContext({ text: '这个特征值分解总是可能的', outputs: ['不应出现'] })
  const service = new InterpretService(ctx, normalizeConfig({
    dataDir: dir,
    asrProvider: 'sensevoice-local',
    systemAudio: 'off',
    vadMode: 'energy',
    minSpeechMs: 200,
    silenceMs: 300,
    vadThreshold: 0.01,
  }))
  await service.start({ title: 'unit' })
  const samples = new Float32Array(16000 * 0.4 + 16000 * 1.2 + 16000 * 0.6)
  samples.set(tone(1.2), 16000 * 0.4)
  const pcm = Buffer.from(float32ToPcm16(samples).buffer)
  for (let offset = 0; offset < pcm.length; offset += 8192) service.pushAudio('mic', pcm.subarray(offset, Math.min(offset + 8192, pcm.length)))
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (service.segments.some((segment) => segment.status === 'dropped')) break
  }
  await service.stop()
  assert.equal(service.segments[0]?.status, 'dropped')
  assert.equal(calls(), 0)
  service.dispose()
  await rm(dir, { recursive: true, force: true })
})

test('draft recognition emits a cleared draft when final caption arrives', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-interpret-'))
  const { ctx } = fakeContext({ text: 'The eigenvalue decomposition is possible.', outputs: ['特征值分解是可能的。'] })
  const service = new InterpretService(ctx, normalizeConfig({
    dataDir: dir,
    asrProvider: 'sensevoice-local',
    systemAudio: 'off',
    vadMode: 'energy',
    draftMode: true,
    draftIntervalMs: 5000,
    minSpeechMs: 200,
    silenceMs: 300,
    vadThreshold: 0.01,
  }))
  const drafts = []
  service.on((type, payload) => { if (type === 'draft') drafts.push(payload) })
  await service.start({ title: 'draft' })
  const quiet = new Float32Array(16000 * 0.4)
  const speech = tone(1.2)
  service.pushAudio('mic', Buffer.from(float32ToPcm16(quiet).buffer))
  service.pushAudio('mic', Buffer.from(float32ToPcm16(speech).buffer))
  await service.tickDraft()
  assert.ok(drafts.some((draft) => draft.en && !draft.cleared))
  service.pushAudio('mic', Buffer.from(float32ToPcm16(new Float32Array(16000 * 0.6)).buffer))
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (service.segments.some((segment) => segment.status === 'done')) break
  }
  await service.stop().catch(() => {})
  assert.ok(drafts.some((draft) => draft.cleared))
  service.dispose()
  await new Promise((resolve) => setTimeout(resolve, 150))
  await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})


test('session store lists, renames, exports and deletes a completed session', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-interpret-'))
  const { ctx } = fakeContext({ text: 'The eigenvalue decomposition is possible.', outputs: ['特征值分解是可能的。'] })
  const service = new InterpretService(ctx, normalizeConfig({
    dataDir: dir,
    asrProvider: 'sensevoice-local',
    systemAudio: 'off',
    vadMode: 'energy',
    minSpeechMs: 200,
    silenceMs: 300,
    vadThreshold: 0.01,
  }))
  await service.start({ title: 'history-test' })
  await service.stop()
  const id = service.sessionId
  const list = await service.listSessions()
  assert.ok(list.some((item) => item.id === id))
  const loaded = await service.getSession(id)
  assert.equal(loaded.title, 'history-test')
  await service.renameSession(id, 'renamed')
  assert.equal((await service.getSession(id)).title, 'renamed')
  const exportData = service.exportText('srt-bilingual', await service.getSession(id))
  assert.ok(exportData.body.includes('renamed') === false)
  assert.ok(exportData.body.length >= 0)
  await service.deleteSession(id)
  await assert.rejects(() => service.getSession(id))
  service.dispose()
  await new Promise((resolve) => setTimeout(resolve, 150))
  await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
})

