import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StreamingAsr, findStreamingModel, normalizeLiveText } from '../src/host/streaming-asr.js'
import { decodeWav } from '../src/host/audio.js'

const FIXTURE = new URL('./fixtures/eigenvalue-voice.wav', import.meta.url)

test('long uppercase streaming text is converted to sentence case', () => {
  assert.equal(normalizeLiveText('THE EIGENVALUE DECOMPOSITION'), 'The eigenvalue decomposition')
  assert.equal(normalizeLiveText('The eigenvalue'), 'The eigenvalue')
  assert.equal(normalizeLiveText(''), '')
})

test('streaming model resolves from the development cache', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-streaming-'))
  try {
    const found = await findStreamingModel(dir)
    assert.ok(found, 'expected .models/streaming-en to be available')
    assert.ok(found.endsWith('streaming-en'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('streaming ASR emits word-level partials before the sentence ends', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-streaming-'))
  const asr = new StreamingAsr({ dataDir: dir })
  t.after(async () => {
    asr.dispose()
    await rm(dir, { recursive: true, force: true })
  })
  const loaded = await asr.load()
  if (!loaded) {
    t.skip('streaming model is not available')
    return
  }
  const wav = decodeWav(await readFile(FIXTURE))
  const chunk = 2560
  const partials = []
  let firstAt = null
  for (let offset = 0; offset < wav.samples.length; offset += chunk) {
    asr.feed('mic', wav.samples.subarray(offset, Math.min(offset + chunk, wav.samples.length)))
    const text = asr.poll('mic')
    if (text) {
      partials.push(text)
      if (firstAt === null) firstAt = offset / 16000
    }
  }
  assert.ok(partials.length >= 8, 'expected many incremental updates, got ' + partials.length)
  assert.ok(firstAt !== null && firstAt < 2.5, 'first partial should arrive before 2.5s, got ' + firstAt)
  assert.ok(partials.some((text) => /symmetric/i.test(text)), 'expected the spoken word symmetric')
  assert.ok(partials.some((text) => /hamiltonian/i.test(text)), 'expected the spoken word Hamiltonian')
  assert.notEqual(partials[0], partials[partials.length - 1], 'partial text should grow')
  asr.reset('mic')
  assert.equal(asr.poll('mic'), '', 'reset clears the live stream')
})
