import type { IosSimulatorFrame, IosSimulatorPreviewMode } from '@superone/shared/ios-simulator'

export function preferredIosSimulatorPreviewMode(): IosSimulatorPreviewMode {
  return typeof VideoDecoder === 'undefined' ? 'native-framebuffer' : 'native-h264'
}

export class IosSimulatorFrameRenderer {
  private decoder: VideoDecoder | null = null
  private waitingForKeyframe = true
  private lastTimestampUs = -1
  private pngGeneration = 0
  private closed = false

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onFirstFrame: () => void,
    private readonly onError: (error: Error) => void,
  ) {}

  push(frame: IosSimulatorFrame): void {
    if (this.closed) return
    if (frame.mimeType === 'image/png') {
      void this.drawPng(frame)
      return
    }
    if (frame.codecConfig) {
      this.configure(frame)
      return
    }
    // Read off the decoder rather than a flag beside it: a decoder that hit an error
    // closes itself, which a shadow copy of "did configure() succeed" cannot see.
    if (this.decoder?.state !== 'configured') return
    if (this.waitingForKeyframe && !frame.keyframe) return
    if (this.decoder.decodeQueueSize > 6) {
      this.waitingForKeyframe = true
      return
    }
    if (frame.keyframe) this.waitingForKeyframe = false
    const timestamp = Math.max(
      this.lastTimestampUs + 1,
      frame.timestampUs ?? frame.timestampMs * 1_000,
    )
    this.lastTimestampUs = timestamp
    try {
      this.decoder.decode(new EncodedVideoChunk({
        type: frame.keyframe ? 'key' : 'delta',
        timestamp,
        data: frame.data,
      }))
    } catch (cause) {
      this.reportError(cause)
    }
  }

  private configure(frame: IosSimulatorFrame): void {
    if (typeof VideoDecoder === 'undefined' || !frame.codec) {
      this.reportError(new Error('WebCodecs H.264 decoding is unavailable.'))
      return
    }
    this.decoder?.close()
    this.decoder = new VideoDecoder({
      output: (videoFrame) => this.drawVideoFrame(videoFrame),
      error: (error) => this.reportError(error),
    })
    try {
      this.decoder.configure({
        codec: frame.codec,
        codedWidth: frame.codedWidth,
        codedHeight: frame.codedHeight,
        hardwareAcceleration: 'prefer-hardware',
        optimizeForLatency: true,
      })
      this.waitingForKeyframe = true
      this.lastTimestampUs = -1
    } catch (cause) {
      this.reportError(cause)
    }
  }

  private drawVideoFrame(frame: VideoFrame): void {
    if (this.closed) { frame.close(); return }
    const width = frame.displayWidth || frame.codedWidth
    const height = frame.displayHeight || frame.codedHeight
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
    const context = this.canvas.getContext('2d', { alpha: false })
    if (context) context.drawImage(frame, 0, 0, width, height)
    frame.close()
    if (context) this.onFirstFrame()
  }

  private async drawPng(frame: IosSimulatorFrame): Promise<void> {
    const generation = ++this.pngGeneration
    try {
      // The view, never `frame.data.buffer` — the payload sits 16 bytes into its
      // record, so handing over the whole buffer would prepend the frame header to
      // the PNG. The cast is only TS 5.7's `ArrayBufferLike` default; a frame that
      // arrived by structured clone is always plain-`ArrayBuffer` backed.
      const png = frame.data as unknown as ArrayBufferView<ArrayBuffer>
      const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }))
      if (this.closed || generation !== this.pngGeneration) { bitmap.close(); return }
      if (this.canvas.width !== bitmap.width) this.canvas.width = bitmap.width
      if (this.canvas.height !== bitmap.height) this.canvas.height = bitmap.height
      const context = this.canvas.getContext('2d', { alpha: false })
      if (context) context.drawImage(bitmap, 0, 0)
      bitmap.close()
      if (context) this.onFirstFrame()
    } catch (cause) {
      this.reportError(cause)
    }
  }

  private reportError(cause: unknown): void {
    if (this.closed) return
    this.onError(cause instanceof Error ? cause : new Error(String(cause)))
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.waitingForKeyframe = true
    this.pngGeneration += 1
    if (this.decoder?.state !== 'closed') this.decoder?.close()
    this.decoder = null
  }
}
