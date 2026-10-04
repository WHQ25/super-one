import type { ModDecoration } from '@superone/shared/mod-ui'

/**
 * The mounted composer of a session, for plugin requests that address the
 * caret or the editor's own drawing (`$.prompt.read` / `fill`). A session no
 * composer shows falls back to its stored draft.
 */
export interface ModComposer {
  caret(): number
  fill(text: string, mode: 'replace' | 'append' | 'insert', decorations: ModDecoration[] | undefined): void
}

const composers = new Map<string, ModComposer>()

export function registerModComposer(sessionId: string, composer: ModComposer): () => void {
  composers.set(sessionId, composer)
  return () => {
    if (composers.get(sessionId) === composer) composers.delete(sessionId)
  }
}

export function getModComposer(sessionId: string): ModComposer | undefined {
  return composers.get(sessionId)
}
