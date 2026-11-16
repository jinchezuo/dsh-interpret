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
  for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * amplitude
  return samples
}

function context() {
  const provider = { id: 'sensevoice-local', name: 'SenseVoice', languages: ['en'], preparation: { phase: 'ready' } }
  const speech = {
    snapshot: () => ({ providers: [provider] }),
    resolve: (request) => ({ provider, audio: request.audio, language: request.language }),
    transcribe: async () => ({ text: 'The laboratory model can generate text.', audioSeconds: 1, inferenceSeconds: 0.1 }),
    prepare: () => {},
  }
  const llm = {
    listProviders: async () => [{ id: 'deepseek-account', name: 'DeepSeek' }],
    listModels: async () => [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }],
    stream: async (request) => (async function* () {
      const prompt = request?.messages?.[0]?.content?.[0]?.text || ''
      const output = prompt.includes('候选术语')
        ? '{"corrections":[{"from":"laboratory model","to":"large language model","termId":"large-language-model","confidence":0.96}]}'
        : '大语言模型可以生成文本。'
      yield { type: 'text-delta', text: output }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(),
  }
  return { get: (name) => name === 'speechToText' ? speech : name === 'llm' ? llm : undefined }
}

test('final ASR is corrected by RAG before translation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-term-e2e-'))
  const service = new InterpretService(context(), normalizeConfig({
    dataDir: dir,
    asrProvider: 'sensevoice-local',
    systemAudio: 'off',
    vadMode: 'energy',
    minSpeechMs: 200,
    silenceMs: 300,
    vadThreshold: 0.01,
    streamingMode: 'off',
    draftMode: false,
    terminologyMode: 'auto',
    terminologyDomains: 'ai',
    termCorrection: true,
  }))
  try {
    await service.start({ title: 'term test' })
    const samples = new Float32Array(16000 * 0.4 + 16000 * 1.2 + 16000 * 0.6)
    samples.set(tone(1.2), 16000 * 0.4)
    service.pushAudio('mic', Buffer.from(float32ToPcm16(samples).buffer))
    for (let i = 0; i < 60; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      if (service.segments.some((segment) => segment.status === 'done' || segment.status === 'error')) break
    }
    await service.stop()
    const segment = service.segments.find((item) => item.status === 'done')
    assert.ok(segment, 'expected a finalized caption')
    assert.ok(segment.en.includes('large language model'), 'expected corrected English: ' + segment.en)
    assert.ok(!segment.en.includes('laboratory model'))
    assert.equal(segment.termCorrections?.[0]?.to, 'large language model')
    assert.ok(segment.zh.includes('大语言模型'))
  } finally {
    service.dispose()
    await new Promise((resolve) => setTimeout(resolve, 150))
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }
})
