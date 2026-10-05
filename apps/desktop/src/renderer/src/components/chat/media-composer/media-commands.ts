import type { MediaComposerKind } from '@superone/shared/media-composer'
export function mediaSlashCommand(text: string): { kind: MediaComposerKind; prompt: string } | null {
  const match = text.match(/^\/(image|video)(?:\s+([\s\S]*))?$/)
  return match ? { kind: match[1] as MediaComposerKind, prompt: match[2]?.trim() ?? '' } : null
}
