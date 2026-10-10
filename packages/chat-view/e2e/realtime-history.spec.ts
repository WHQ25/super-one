import { expect, test } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import type { ChatMessage } from '@superone/shared/agent-types'
import { projectRealtimeTranscript } from '@superone/shared/realtime-transcript-projection'

test('voice history pins live work, opens its backing row and settles beside the originating speech', async ({ page }, info) => {
  await page.context().setOffline(true)
  await page.addInitScript(() => {
    const host = globalThis as typeof globalThis & { __requests: unknown[]; ReactNativeWebView: { postMessage(raw: string): void } }
    host.__requests = []
    host.ReactNativeWebView = { postMessage(raw) { host.__requests.push(JSON.parse(raw)) } }
  })
  await page.goto(pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
  const send = async (message: unknown) => page.evaluate(value => {
    (globalThis as typeof globalThis & { __applyHost?: (value: unknown) => void }).__applyHost?.(value)
  }, message)
  await send({ type: 'channelToken', token: 'offline-test' })
  await send({ type: 'setTheme', scheme: 'dark' })
  await send({ type: 'setViewport', locale: 'zh' })
  const work: ChatMessage = { id: 'task', role: 'assistant', status: 'streaming', providerId: 'codex',
    content: [{ type: 'text', text: 'Inspecting the authentication handlers' }], createdAt: new Date(Date.now() - 12_000).toISOString(),
    metadata: { codexTimeline: { provenance: 'realtime-delegated', localOrder: 3, turnId: 'task-turn' } } }
  const input = { messages: [work], segments: [
    { id: 'u', realtimeSessionId: 'rt', role: 'user' as const, text: 'Check sign-in', localOrder: 1 },
    { id: 'a', realtimeSessionId: 'rt', role: 'assistant' as const, text: 'Checking now', localOrder: 2 },
    { id: 'u2', realtimeSessionId: 'rt', role: 'user' as const, text: 'Any news?', localOrder: 10 },
  ], liveSegments: [], sessionStatus: 'streaming' as const, needsDecision: false }
  const voice = projectRealtimeTranscript(input)
  await send({ type: 'hydrate', messages: voice.messages, realtimeActivities: voice.activities })
  const row = page.getByTestId('realtime-delegation-row')
  await expect(row).toHaveAttribute('data-activity-status', 'working')
  await expect(page.getByText('Inspecting the authentication handlers')).toHaveCount(0)
  await expect(page.getByTestId('realtime-delegation-status')).not.toHaveText('chat.compactMode.workingFor')
  const speechBox = await page.locator('[data-turn-id="codex-realtime-u2"]').boundingBox()
  const rowBox = await row.boundingBox()
  expect(rowBox!.y).toBeGreaterThan(speechBox!.y)
  await page.screenshot({ path: info.outputPath('voice-working.png') })
  await row.getByRole('button').click()
  await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & { __requests: { action?: string; payload?: unknown }[] }).__requests
    .find(request => request.action === 'openRealtimeThread')?.payload)).toEqual({ messageId: 'task' })
  await send({ type: 'hydrate', messages: [work], realtimeActivities: [] })
  await expect(page.getByText('Inspecting the authentication handlers')).toBeVisible()
  await expect(row).toHaveCount(0)
  const done = projectRealtimeTranscript({ ...input, messages: [{ ...work, status: 'complete' }], sessionStatus: 'idle' })
  await send({ type: 'hydrate', messages: done.messages, realtimeActivities: done.activities })
  await expect(row).toHaveAttribute('data-activity-status', 'completed')
  const completedBox = await row.boundingBox()
  const followupBox = await page.locator('[data-turn-id="codex-realtime-u2"]').boundingBox()
  expect(completedBox!.y).toBeLessThan(followupBox!.y)
})
