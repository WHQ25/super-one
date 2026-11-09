/** Posts about 100 ms of mono float audio. The renderer resamples it to 16 kHz. */
const BATCH_SECONDS = 0.1

class DoubaoCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.chunks = []
    this.frames = 0
    this.batch = Math.max(1, Math.round(sampleRate * BATCH_SECONDS))
  }

  flush() {
    const samples = new Float32Array(this.frames)
    let offset = 0
    for (const chunk of this.chunks) {
      samples.set(chunk, offset)
      offset += chunk.length
    }
    this.chunks = []
    this.frames = 0
    this.port.postMessage({ type: 'samples', samples })
  }

  process(inputs) {
    const input = inputs[0]?.[0]
    if (input && input.length) {
      this.chunks.push(input.slice())
      this.frames += input.length
      if (this.frames >= this.batch) this.flush()
    }
    return true
  }
}

if (typeof registerProcessor === 'function') {
  registerProcessor('superone-doubao-capture', DoubaoCaptureProcessor)
}
