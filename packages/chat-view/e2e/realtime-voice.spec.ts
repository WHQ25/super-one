import { expect, test, type Page } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import type { ChatMessage, RealtimeTimelineSegment } from '@superone/shared/agent-types'
import { mergeRealtimeTranscript } from '@superone/shared/realtime-transcript'

// The phone renders one merged list: `mobile-app.tsx` folds voice into the message
// projection before it reaches the WebView, so these specs feed the merged output.
const documentUrl = pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href
const send = (page: Page, value: unknown) => page.evaluate((envelope) => {
  (window as unknown as { __applyHost(value: unknown): void }).__applyHost(envelope)
}, value)

const at = (seconds: number) => new Date(Date.UTC(2026, 8, 8, 0, 0, seconds)).toISOString()
const ms = (seconds: number) => Date.UTC(2026, 8, 8, 0, 0, seconds)

const typed = (id: string, role: ChatMessage['role'], text: string, seconds: number): ChatMessage => ({
  id, role, content: [{ type: 'text', text }], providerId: 'codex',
  status: 'complete', createdAt: at(seconds),
})
const spoken = (
  id: string, role: 'user' | 'assistant', text: string, seconds: number,
): RealtimeTimelineSegment => ({
  id: `local-${id}`, sourceItemId: id, realtimeSessionId: 'rt-1', role, text, startedAtMs: ms(seconds),
})

const mixed = mergeRealtimeTranscript(
  [
    typed('u1', 'user', 'Typed question', 10),
    typed('a1', 'assistant', 'Typed answer', 20),
    typed('u2', 'user', 'Later typed question', 60),
    typed('a2', 'assistant', 'Later typed answer', 70),
  ],
  [
    spoken('item-1', 'user', 'Spoken question', 30),
    spoken('item-2', 'assistant', 'Spoken answer', 40),
  ],
)

test.beforeEach(async ({ page }) => {
  await page.context().setOffline(true)
  await page.goto(documentUrl)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
})

test('renders spoken turns in wall-clock order beside typed ones', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: mixed })
  await expect(page.locator('[data-turn-id]')).toHaveCount(6)
  expect(await page.locator('.chat-view-shell').innerText()).toContain('Spoken question')
  expect(await page.locator('[data-turn-id]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.turnId)))
    .toEqual(['u1', 'a1', 'codex-realtime-item-1', 'codex-realtime-item-2', 'u2', 'a2'])
})

test('gives every spoken user turn a scroll-rail tick', async ({ page }) => {
  await send(page, { type: 'hydrate', messages: mixed })
  const ticks = page.locator('.chat-scroll-tick')
  await expect(ticks).toHaveCount(3)
  expect(await ticks.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))))
    .toEqual(['Typed question', 'Spoken question', 'Later typed question'])
})

test('renders a voice-only session, which has no chat messages at all', async ({ page }) => {
  const voiceOnly = mergeRealtimeTranscript([], [
    spoken('item-1', 'user', 'First thing I said', 1),
    spoken('item-2', 'assistant', 'First reply', 2),
    spoken('item-3', 'user', 'Second thing I said', 3),
  ])
  await send(page, { type: 'hydrate', messages: voiceOnly })
  await expect(page.locator('[data-turn-id]')).toHaveCount(3)
  const shell = await page.locator('.chat-view-shell').innerText()
  expect(shell).toContain('First thing I said')
  expect(shell).toContain('Second thing I said')
  // Two spoken user turns is exactly the rail's threshold for existing at all.
  await expect(page.locator('.chat-scroll-tick')).toHaveCount(2)
})

test('leaves the live spinner on the streaming turn, not the spoken tail', async ({ page }) => {
  // A delegated Codex turn runs while the user keeps talking; the spoken reply lands
  // after it in wall-clock order but is complete the moment it is transcribed.
  const streaming: ChatMessage = {
    id: 'a-work', role: 'assistant', content: [{ type: 'text', text: 'Working on it' }],
    providerId: 'codex', status: 'streaming', createdAt: at(10),
    metadata: { codexTimeline: { provenance: 'realtime-delegated', turnId: 't1' } },
  } as ChatMessage
  await send(page, {
    type: 'hydrate',
    sessionStatus: 'streaming',
    messages: mergeRealtimeTranscript([streaming], [spoken('item-9', 'assistant', 'Still listening', 20)]),
  })
  await expect(page.locator('[data-turn-id="a-work"]')).toHaveAttribute('data-message-status', 'streaming')
  await expect(page.locator('[data-turn-id]')).toHaveCount(2)
})
