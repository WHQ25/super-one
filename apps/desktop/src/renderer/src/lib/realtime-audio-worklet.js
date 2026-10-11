/** A bounded FIFO. Reads advance only when the output is actually playing. */
export class VoiceSampleQueue {
  constructor(limit) { this.limit = limit; this.chunks = []; this.head = 0; this.offset = 0; this.length = 0 }
  push(samples) {
    if (this.length + samples.length > this.limit) throw new Error('Voice pause buffer is full. End this call and start a new one.')
    this.chunks.push(samples.slice()); this.length += samples.length
  }
  read(output) {
    let written = 0
    while (written < output.length && this.head < this.chunks.length) {
      const chunk = this.chunks[this.head]
      const count = Math.min(output.length - written, chunk.length - this.offset)
      output.set(chunk.subarray(this.offset, this.offset + count), written)
      written += count; this.offset += count; this.length -= count
      if (this.offset === chunk.length) { this.head++; this.offset = 0 }
    }
    if (this.head > 1024 || this.head === this.chunks.length) { this.chunks = this.chunks.slice(this.head); this.head = 0 }
    return written
  }
}

// This file is loaded as an AudioWorklet module, and also imported by queue tests.
if (typeof registerProcessor === 'function') {
  class VoicePlaybackProcessor extends AudioWorkletProcessor {
    constructor() {
      super()
      this.paused = false
      this.failed = false
      this.queue = new VoiceSampleQueue(sampleRate * 300)
      this.consumed = 0
      this.port.onmessage = ({ data }) => {
        if (data.type === 'pause') this.paused = data.paused
        else if (data.type === 'samples' && !this.failed) {
          try { this.queue.push(data.samples) } catch (error) { this.fail(error) }
        }
      }
    }
    fail(error) { this.failed = true; this.port.postMessage({ type: 'error', message: error.message }) }
    process(inputs, outputs) {
      const output = outputs[0]?.[0]
      if (!output || this.failed) return !this.failed
      const input = inputs[0]?.[0]
      try {
        if (input) {
          // Preserve every paused sample. During replay, skip newly arriving
          // silence so the unheard queue can drain back to live speech.
          const audible = input.some(value => Math.abs(value) > 0.00001)
          if (this.paused || audible || this.queue.length === 0) this.queue.push(input)
        }
        if (!this.paused) {
          this.consumed += this.queue.read(output)
          if (this.consumed >= sampleRate / 10) {
            this.port.postMessage({ type: 'consumed', frames: this.consumed }); this.consumed = 0
          }
        }
      } catch (error) {
        this.fail(error)
      }
      return !this.failed
    }
  }
  registerProcessor('superone-voice-playback', VoicePlaybackProcessor)
}
