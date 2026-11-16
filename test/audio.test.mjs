import test from 'node:test'
import assert from 'node:assert/strict'
import { EnergySegmenter, encodeWav, decodeWav, float32ToPcm16, pcm16ToFloat32, rms } from '../src/host/audio.js'

function tone(seconds, amplitude = 0.2, sampleRate = 16000) {
  const samples = new Float32Array(Math.round(seconds * sampleRate))
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * amplitude
  }
  return samples
}

test('energy segmenter emits one segment for speech surrounded by silence', () => {
  const segments = []
  const segmenter = new EnergySegmenter({
    threshold: 0.01,
    minSpeechMs: 200,
    silenceMs: 300,
    onSegment: (segment) => segments.push(segment),
  })
  segmenter.push(new Float32Array(16000 * 0.4))
  segmenter.push(tone(1.2))
  segmenter.push(new Float32Array(16000 * 0.6))
  segmenter.flush()
  assert.equal(segments.length, 1)
  const [segment] = segments
  assert.ok(segment.startMs >= 0 && segment.startMs <= 250)
  assert.ok(segment.endMs >= 1300 && segment.endMs <= 1700)
  assert.ok(segment.samples.length > 16000)
})

test('energy segmenter drops noise-only input', () => {
  const segments = []
  const segmenter = new EnergySegmenter({ threshold: 0.05, minSpeechMs: 100, silenceMs: 200, onSegment: (segment) => segments.push(segment) })
  segmenter.push(tone(1, 0.001))
  segmenter.flush()
  assert.equal(segments.length, 0)
})

test('PCM16 and WAV round-trip preserve mono 16 kHz audio', () => {
  const samples = tone(0.5, 0.5)
  const pcm = float32ToPcm16(samples)
  const wav = encodeWav(samples)
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.readUInt32LE(24), 16000)
  const decoded = decodeWav(wav)
  assert.equal(decoded.sampleRate, 16000)
  assert.equal(decoded.samples.length, samples.length)
  const back = pcm16ToFloat32(Buffer.from(pcm.buffer))
  assert.ok(Math.abs(back[100] - samples[100]) < 0.001)
  assert.ok(rms(samples) > 0.2)
})
