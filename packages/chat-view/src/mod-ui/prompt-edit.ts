import type { ModUiRequest, ModUiResult } from '@superone/shared/mod-ui'
import type { ClientKeyEvent } from './client-frame'

export interface PromptBox {
  text: string
  cursor: number
}

type EditRequest = Omit<ModUiRequest<'promptEdit'>, 'surface' | 'clientId'>
export type PromptEditAnswer = ModUiResult<'promptEdit'>

export interface PromptEditRelayOptions {
  send: (request: EditRequest) => Promise<PromptEditAnswer | null>
  /** The composer as it is now. */
  current: () => PromptBox
  /** Shows a plugin's rewrite (text, caret, decoration runs). */
  apply: (answer: PromptEditAnswer) => void
}

/**
 * Relays composer edits to the CLI's `prompt.edit` chain (`ui_prompt_edit`),
 * one in flight: edits made meanwhile collapse into the newest, as the CLI
 * itself does. An answer is shown only while the composer still holds the box
 * it answers, so a plugin never overwrites typing it has not seen.
 */
export class PromptEditRelay {
  private inflight = false
  private queued: EditRequest | null = null

  constructor(private readonly opts: PromptEditRelayOptions) {}

  /** The person changed the box; `key` is the one key that did it, if any. */
  edit(box: PromptBox, key?: ClientKeyEvent): void {
    // Several edits in one request no longer come from a single key.
    const single = this.queued === null
    this.enqueue({ text: box.text, cursor: box.cursor, by: 'person', ...(key && single ? { key } : {}) })
  }

  /** SuperOne changed the box itself (fill, submit, restore): the CLI adopts it without raising a hook. */
  adopt(box: PromptBox): void {
    this.enqueue({ text: box.text, cursor: box.cursor, by: 'app' })
  }

  private enqueue(request: EditRequest): void {
    this.queued = request
    if (!this.inflight) void this.pump()
  }

  private async pump(): Promise<void> {
    this.inflight = true
    while (this.queued) {
      const request = this.queued
      this.queued = null
      const answer = await this.opts.send(request).catch(() => null)
      if (!answer || answer.superseded || request.by === 'app' || this.queued) continue
      const now = this.opts.current()
      if (now.text !== request.text || now.cursor !== request.cursor) continue
      if (answer.text !== now.text || answer.cursor !== now.cursor || answer.decorations?.length) this.opts.apply(answer)
    }
    this.inflight = false
  }
}
