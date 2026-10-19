import { describe, expect, it } from 'vitest'
import type { SessionLoadResult } from '@superone/shared/environment'
import type { TranscriptWindowRequest, TranscriptWindowResult } from '@superone/shared/environment/transcript-window'
import { selectTranscriptWindow } from '@superone/shared/transcript-window/select-window'
import { conversation, textMessage, windowSource } from '@superone/shared/transcript-window/window-fixtures'
import {
  DESKTOP_WINDOW_BUDGET,
  loadRemoteTranscriptWindow,
  readDesktopSessionWindow,
} from './remote-transcript-window'

const cursor = { sequence: '1', epoch: 'e', version: 1 }

function windowResult(
  messages: ReturnType<typeof conversation>,
  request: TranscriptWindowRequest,
): TranscriptWindowResult {
  const source = windowSource(messages)
  const selected = selectTranscriptWindow(source, request, request.budget ?? DESKTOP_WINDOW_BUDGET)
  return {
    sessionId: request.sessionId,
    schema: 1,
    messages: selected.messages,
    older: selected.older,
    newer: selected.newer,
    total: messages.length,
    state: { status: 'idle' },
    cursor,
  }
}

describe('loadRemoteTranscriptWindow', () => {
  it('sends coverage on the way back to a held session', async () => {
    const messages = conversation(4)
    const requests: TranscriptWindowRequest[] = []
    const call = async (request: TranscriptWindowRequest & { holder: string }) => {
      requests.push(request)
      return windowResult(messages, request)
    }
    const first = await loadRemoteTranscriptWindow(call, null, { sessionId: 's' })
    const second = await loadRemoteTranscriptWindow(call, first.held, { sessionId: 's' })
    expect(requests[0].holder).toBe('desktop:s')
    expect(requests[0].have).toBeUndefined()
    expect(requests[1].have?.length).toBeGreaterThan(0)
    expect(requests[1].budget).toEqual(DESKTOP_WINDOW_BUDGET)
    expect(second.snapshot.messages.map((message) => message.id)).toEqual(first.snapshot.messages.map((message) => message.id))
    expect(second.snapshot.messages[0]?.content[0]).toMatchObject({ type: 'text' })
  })

  it('keeps an already paged prefix when the tail is read again', async () => {
    const messages = conversation(3)
    const full = windowResult(messages, { sessionId: 's' })
    const first = await loadRemoteTranscriptWindow(async () => full, null, { sessionId: 's' })
    const tail: TranscriptWindowResult = {
      ...full,
      messages: full.messages.slice(-1),
      older: { messageId: messages[2].id },
      newer: null,
    }
    const again = await loadRemoteTranscriptWindow(async () => tail, first.held, { sessionId: 's' })
    expect(again.snapshot.messages.map((message) => message.id)).toEqual(['m0', 'm1', 'm2'])
    expect(again.snapshot.transcriptWindow?.older).toBeNull()
  })

  it('joins an adjacent tail and replaces the held range across a gap', async () => {
    const messages = conversation(6)
    const full = windowResult(messages, { sessionId: 's' })
    const held = await loadRemoteTranscriptWindow(async () => ({ ...full, messages: full.messages.slice(0, 2), older: null, newer: null }), null, { sessionId: 's' })
    const adjacent = await loadRemoteTranscriptWindow(async () => ({ ...full, messages: full.messages.slice(2, 3), older: { messageId: 'm2' }, newer: null }), held.held, { sessionId: 's' })
    expect(adjacent.snapshot.messages.map((message) => message.id)).toEqual(['m0', 'm1', 'm2'])
    expect(adjacent.snapshot.transcriptWindow?.older).toBeNull()
    const gapped = await loadRemoteTranscriptWindow(async () => ({ ...full, messages: full.messages.slice(-1), older: { messageId: 'm5' }, newer: null }), held.held, { sessionId: 's' })
    expect(gapped.snapshot.messages.map((message) => message.id)).toEqual(['m5'])
    expect(gapped.snapshot.transcriptWindow?.older).toEqual({ messageId: 'm5' })
  })

  it('replaces a detached window with the live tail', async () => {
    const messages = conversation(3)
    const full = windowResult(messages, { sessionId: 's' })
    const detached: TranscriptWindowResult = {
      ...full,
      messages: full.messages.slice(0, 2),
      newer: { messageId: messages[1].id },
      older: null,
    }
    const held = await loadRemoteTranscriptWindow(async () => detached, null, { sessionId: 's' })
    const tail: TranscriptWindowResult = {
      ...full,
      messages: full.messages.slice(-1),
      older: { messageId: messages[2].id },
      newer: null,
    }
    const replaced = await loadRemoteTranscriptWindow(async () => tail, held.held, { sessionId: 's' })
    expect(replaced.snapshot.messages.map((message) => message.id)).toEqual(['m2'])
  })

  it('pages a long session back to its first message', async () => {
    const messages = conversation(300)
    let held = null as Awaited<ReturnType<typeof loadRemoteTranscriptWindow>>['held'] | null
    const read = () => loadRemoteTranscriptWindow(
      async (request) => windowResult(messages, request),
      held,
      held?.current.older
        ? { sessionId: 's', anchor: held.current.older, direction: 'before' as const }
        : { sessionId: 's' },
    )
    let loaded = await read()
    held = loaded.held
    expect(loaded.snapshot.messages[0]?.id).not.toBe('m0')
    expect(loaded.snapshot.transcriptWindow?.older).not.toBeNull()
    for (let i = 0; i < 4 && loaded.snapshot.transcriptWindow?.older; i++) {
      loaded = await read()
      held = loaded.held
    }
    expect(loaded.snapshot.messages[0]?.id).toBe('m0')
    expect(loaded.snapshot.transcriptWindow?.total).toBe(300)
  })
})

describe('readDesktopSessionWindow', () => {
  it('falls back to session.load when the host does not serve the window', async () => {
    const legacy: SessionLoadResult = {
      sessionId: 's',
      state: {},
      messages: [textMessage('a', 'user', 'hi')],
      before: null,
      cursor,
    }
    const loaded = await readDesktopSessionWindow({
      held: null,
      input: { sessionId: 's' },
      window: async () => {
        throw Object.assign(new Error('unknown method: session.transcriptWindow'), { code: 'not_found' })
      },
      load: async () => legacy,
    })
    expect(loaded.via).toBe('load')
    expect(loaded.held).toBeNull()
    expect(loaded.snapshot).toBe(legacy)
  })

  it('leaves other window failures to the caller', async () => {
    await expect(readDesktopSessionWindow({
      held: null,
      input: { sessionId: 's' },
      window: async () => { throw new Error('offline') },
      load: async () => { throw new Error('load should not run') },
    })).rejects.toThrow('offline')
  })
})
