export class VoiceSampleQueue {
  constructor(limit: number)
  readonly length: number
  push(samples: Float32Array): void
  read(output: Float32Array): number
}
