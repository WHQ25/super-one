import type { ImageAttachment } from '@superone/shared/agent-types'
import {
  EMPTY_COMPOSER_DRAFT,
  type ComposerDraftSnapshot,
} from './composer-draft-state'

/** Unsent composer contents keyed by the session they were typed in. */
export type SessionComposerSnapshot = ComposerDraftSnapshot & {
  attachments: ImageAttachment[]
}

export const EMPTY_SESSION_COMPOSER: SessionComposerSnapshot = {
  ...EMPTY_COMPOSER_DRAFT,
  attachments: [],
}

/**
 * Pairing + project + session. New-session landing uses `new` so it does not
 * collide with a live id, and a reconnect to the same desktop can find it again.
 */
export function composerDraftKey(
  pairingId: string | null,
  projectPath: string | undefined,
  sessionId: string | null,
): string {
  return `${pairingId ?? ''}\n${projectPath ?? ''}\n${sessionId ?? 'new'}`
}

function cloneSnapshot(snapshot: SessionComposerSnapshot): SessionComposerSnapshot {
  return {
    text: snapshot.text,
    document: snapshot.document.map((segment) => (
      'text' in segment ? { text: segment.text } : { mention: { ...segment.mention } }
    )),
    insertions: snapshot.insertions.map((insertion) => ({
      text: insertion.text,
      mention: { ...insertion.mention },
    })),
    attachments: snapshot.attachments.slice(),
  }
}

function isEmpty(snapshot: SessionComposerSnapshot): boolean {
  return !snapshot.text && snapshot.attachments.length === 0 && snapshot.document.length === 0
}

/** In-memory per-session composer drafts for the life of the app process. */
export class SessionComposerDrafts {
  private readonly drafts = new Map<string, SessionComposerSnapshot>()

  stash(key: string, snapshot: SessionComposerSnapshot): void {
    if (isEmpty(snapshot)) {
      this.drafts.delete(key)
      return
    }
    this.drafts.set(key, cloneSnapshot(snapshot))
  }

  load(key: string): SessionComposerSnapshot {
    return cloneSnapshot(this.drafts.get(key) ?? EMPTY_SESSION_COMPOSER)
  }
}
