/** Continuous linear resampling, retaining the boundary sample between frames. */
export class VoiceResampler {
  private previous?: number
  private position = 0
  constructor(private readonly sourceRate: number, private readonly targetRate: number) {}
  convert(input: Float32Array): Float32Array {
    if (this.sourceRate === this.targetRate || !input.length) return input
    const samples = this.previous === undefined ? input : new Float32Array([this.previous, ...input])
    const step = this.sourceRate / this.targetRate
    const count = Math.max(0, Math.ceil((samples.length - 1 - this.position) / step))
    const output = new Float32Array(count)
    for (let n = 0; n < count; n++, this.position += step) {
      const index = Math.floor(this.position); const fraction = this.position - index
      output[n] = samples[index]! * (1 - fraction) + samples[index + 1]! * fraction
    }
    this.position -= samples.length - 1; this.previous = input[input.length - 1]
    return output
  }
}
