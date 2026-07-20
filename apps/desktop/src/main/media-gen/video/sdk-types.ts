/**
 * The AI SDK exports its video specification under `Experimental_` names because the spec is still
 * unstable. Aliasing them in one place keeps that prefix — and the churn when it is dropped or the
 * version bumps to V5 — confined to a single file instead of every adapter.
 */
export type {
  Experimental_VideoModelV4 as VideoModelV4,
  Experimental_VideoModelV4CallOptions as VideoModelV4CallOptions,
  Experimental_VideoModelV4File as VideoModelV4File,
  Experimental_VideoModelV4FrameImage as VideoModelV4FrameImage,
  Experimental_VideoModelV4FrameType as VideoModelV4FrameType,
  Experimental_VideoModelV4Result as VideoModelV4Result,
  Experimental_VideoModelV4VideoData as VideoModelV4VideoData,
} from '@ai-sdk/provider'
