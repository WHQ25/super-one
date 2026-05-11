import type { MiniAppMediaKind } from './miniapp-types'

export interface MiniAppFrameAttrs {
  sandbox: string
  allow: string
}

export interface BuildMiniAppFrameAttrsOpts {
  grantedMedia?: MiniAppMediaKind[]
  storage?: boolean
}

const MEDIA_TO_FEATURE: Record<MiniAppMediaKind, string> = {
  microphone: 'microphone',
  camera: 'camera',
}

export function buildMiniAppFrameAttrs(opts: BuildMiniAppFrameAttrsOpts = {}): MiniAppFrameAttrs {
  const kinds = opts.grantedMedia ?? []
  const sandboxParts = ['allow-scripts']
  if (kinds.length > 0 || opts.storage) sandboxParts.push('allow-same-origin')
  const allowParts = kinds.map((k) => `${MEDIA_TO_FEATURE[k]} *`)
  return {
    sandbox: sandboxParts.join(' '),
    allow: allowParts.join('; '),
  }
}
