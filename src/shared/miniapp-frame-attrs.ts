import type { MiniAppMediaKind } from './miniapp-types'

export interface MiniAppFrameAttrs {
  sandbox: string
  allow: string
}

const MEDIA_TO_FEATURE: Record<MiniAppMediaKind, string> = {
  microphone: 'microphone',
  camera: 'camera',
}

export function buildMiniAppFrameAttrs(grantedMedia: MiniAppMediaKind[] | undefined): MiniAppFrameAttrs {
  const kinds = grantedMedia ?? []
  const sandboxParts = ['allow-scripts']
  if (kinds.length > 0) sandboxParts.push('allow-same-origin')
  const allowParts = kinds.map((k) => `${MEDIA_TO_FEATURE[k]} *`)
  return {
    sandbox: sandboxParts.join(' '),
    allow: allowParts.join('; '),
  }
}
