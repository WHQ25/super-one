import type { ModHostReply, ModHostRequest } from '@superone/shared/mod-ui'
import type { ModComposer } from './composer-bridge'

/** What the desktop knows about a session when a plugin asks it to act. */
export interface HostRequestContext {
  draftText: string
  isIdle: boolean
  /** A permission, question or plan prompt holds the keys. */
  isDeciding: boolean
  /** The mounted composer showing the session, if any. */
  composer?: ModComposer
  setDraft(text: string): void
  suggest(text: string): void
  copy(text: string): Promise<boolean>
}

/**
 * The desktop's answer to a plugin's request (`$.prompt.*`, `$.ui.copy`).
 * Never throws: a request it cannot honour answers `false`, so the CLI never
 * waits out its timeout. `ctx` null: the session is not in this window.
 */
export async function replyToHostRequest(ctx: HostRequestContext | null, request: ModHostRequest): Promise<ModHostReply> {
  switch (request.kind) {
    case 'promptRead': {
      const text = ctx?.draftText ?? ''
      return { kind: 'promptRead', text, cursor: ctx?.composer?.caret() ?? text.length }
    }
    case 'promptFill': {
      if (!ctx || ctx.isDeciding) return { kind: 'promptFill', filled: false }
      if (ctx.composer) ctx.composer.fill(request.text, request.mode, request.decorations)
      // No composer shows the session: the caret is the draft's end.
      else ctx.setDraft(request.mode === 'replace' ? request.text : ctx.draftText + request.text)
      return { kind: 'promptFill', filled: true }
    }
    case 'promptSuggest': {
      if (!ctx || ctx.draftText.length > 0 || !ctx.isIdle) return { kind: 'promptSuggest', shown: false }
      ctx.suggest(request.text)
      return { kind: 'promptSuggest', shown: true }
    }
    case 'copy':
      return { kind: 'copy', copied: await ctx?.copy(request.text).catch(() => false) ?? false }
  }
}
