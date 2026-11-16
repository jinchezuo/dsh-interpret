/** 16 kHz mono capture through getUserMedia; posts Int16 frames to the host. */

function resample(input, inputRate, outputRate = 16000) {
  if (inputRate === outputRate || !input.length) return input
  const ratio = inputRate / outputRate
  const length = Math.max(1, Math.floor(input.length / ratio))
  const output = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio
    const index = Math.floor(position)
    const next = Math.min(index + 1, input.length - 1)
    const fraction = position - index
    output[i] = input[index] * (1 - fraction) + input[next] * fraction
  }
  return output
}

function toPcm16(samples) {
  const output = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]))
    output[i] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767)
  }
  return output
}

export class MicCapture {
  constructor({ onFrame, onLevel, onError }) {
    this.onFrame = onFrame
    this.onLevel = onLevel
    this.onError = onError
    this.stream = null
    this.ctx = null
    this.source = null
    this.processor = null
    this.gain = null
    this.active = false
  }

  async start(deviceId) {
    if (this.active) return
    const audio = {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true,
    }
    if (deviceId) audio.deviceId = { exact: deviceId }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio, video: false })
    try {
      this.ctx = new AudioContext({ sampleRate: 16000 })
    } catch {
      this.ctx = new AudioContext()
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1)
    this.processor.onaudioprocess = (event) => {
      try {
        const input = event.inputBuffer.getChannelData(0)
        const samples = this.ctx.sampleRate === 16000 ? input : resample(input, this.ctx.sampleRate)
        const pcm = toPcm16(samples)
        let sum = 0
        for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
        this.onLevel?.(Math.sqrt(sum / Math.max(1, samples.length)))
        this.onFrame?.(pcm.buffer)
      } catch (error) {
        this.onError?.(error)
      }
    }
    this.gain = this.ctx.createGain()
    this.gain.gain.value = 0
    this.source.connect(this.processor)
    this.processor.connect(this.gain)
    this.gain.connect(this.ctx.destination)
    this.active = true
  }

  stop() {
    this.active = false
    try { this.processor?.disconnect() } catch {}
    try { this.source?.disconnect() } catch {}
    try { this.gain?.disconnect() } catch {}
    this.processor = null
    this.source = null
    this.gain = null
    try { this.stream?.getTracks().forEach((track) => track.stop()) } catch {}
    this.stream = null
    try { this.ctx?.close() } catch {}
    this.ctx = null
    this.onLevel?.(0)
  }
}
