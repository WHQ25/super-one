import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ChatMessage } from '@superone/shared/agent-types'
import { TranscriptDelivery } from '../../../apps/mobile/src/transcript-delivery'
import type { HostInbound } from '../src/protocol'

const documentUrl = pathToFileURL(resolve(import.meta.dirname, '../dist/index.html')).href
const answer = 'The answer arrived while the same session stayed open.'
const user: ChatMessage = {
  id: 'user-1', role: 'user', status: 'complete', providerId: 'local',
  createdAt: '2026-09-14T00:00:00Z', content: [{ type: 'text', text: 'Explain the result.' }],
}
const assistant: ChatMessage = {
  id: 'assistant-1', role: 'assistant', status: 'streaming', providerId: 'claude',
  createdAt: '2026-09-14T00:00:01Z', content: [{ type: 'thinking', thinking: 'Checking the result.' }],
}

/** Real mobile projection -> real chat document; only native bridge delivery is simulated. */
function mobileHost(page: Page) {
  const pendingPaints: HostInbound[] = []
  const delivery = new TranscriptDelivery(message => pendingPaints.push(message))
  const delivered: HostInbound[] = []
  return {
    delivered,
    dispose: () => delivery.dispose(),
    paint(messages: ChatMessage[], hydrate = false, sessionStatus: 'idle' | 'streaming' = 'streaming') {
      delivery.publish({ messages, sessionStatus }, hydrate)
    },
    async deliver(drop = false) {
      if (drop) {
        const paints = pendingPaints.splice(0)
        // Lose exactly the first assistant insertion at the RN -> WebView seam.
        expect(paints).toHaveLength(1)
        expect(paints[0]).toMatchObject({ type: 'applyReductionPatch', messageOrder: [user.id, assistant.id] })
        return
      }
      while (pendingPaints.length) {
        const envelope = pendingPaints.shift()!
        delivered.push(envelope)
        await page.evaluate((value) => {
          const host = globalThis as typeof globalThis & { __applyHost: (message: unknown) => void }
          host.__applyHost(value)
        }, envelope)
        const receipts = await page.evaluate(() => (globalThis as typeof globalThis & {
          transcriptReceipts: { channelId: string; sequence: number }[]
        }).transcriptReceipts.splice(0))
        for (const receipt of receipts) delivery.acknowledge(receipt.channelId, receipt.sequence)
      }
      await page.clock.runFor(34)
    },
  }
}

test.beforeEach(async ({ page }) => {
  await page.context().setOffline(true)
  await page.clock.install()
  await page.addInitScript(() => {
    const transcriptReceipts: { channelId: string; sequence: number }[] = []
    Object.assign(globalThis, { transcriptReceipts, ReactNativeWebView: { postMessage(raw: string) {
      const message = JSON.parse(raw)
      if (message.type === 'transcriptApplied') transcriptReceipts.push(message)
    } } })
  })
  await page.goto(documentUrl)
  await expect(page.locator('html')).toHaveAttribute('data-chat-view-ready', 'true')
  await page.clock.pauseAt(new Date(Date.now() + 1000))
})

for (const dropInsertion of [false, true]) {
  test(dropInsertion
    ? 'recovers later live content without switching sessions when one insertion paint is lost'
    : 'shows later live content while staying in one session when every paint arrives', async ({ page }) => {
    const host = mobileHost(page)
    try {
      host.paint([user], true)
      await host.deliver()
      await expect(page.getByText('Explain the result.', { exact: true })).toBeVisible()

      host.paint([user, assistant])
      await host.deliver(dropInsertion)
      let live = assistant
      let text = ''
      for (const chunk of ['The answer arrived ', 'while the same session stayed open.']) {
        text += chunk
        live = { ...live, content: [...assistant.content, { type: 'text', text }] }
        host.paint([user, live])
        await host.deliver()
      }
      live = { ...live, status: 'complete' }
      host.paint([user, live], false, 'idle')
      await host.deliver()

      // Pump only actual native deliveries, including timeout retries; never inject a rescue hydrate.
      await expect.poll(async () => {
        await host.deliver()
        return (await page.locator(`article[data-turn-id="${assistant.id}"]`).allTextContents()).join(' ')
      }).toContain(answer)
      // The final answer crossed the bridge; no reset, reload or second hydrate occurred.
      expect(host.delivered.at(-1)).toMatchObject({
        type: 'applyReductionPatch', messagePatches: [expect.objectContaining({
          id: assistant.id, content: expect.arrayContaining([{ type: 'text', text: answer }]),
        })],
      })
      expect(host.delivered.filter(envelope => envelope.type === 'hydrate')).toHaveLength(1)
      await expect(page.locator(`article[data-turn-id="${assistant.id}"]`)).toContainText(answer)

      if (dropInsertion) {
        // Session switching replaces the document baseline with a full hydrate.
        host.paint([], true, 'idle')
        await host.deliver()
        await expect(page.locator('article')).toHaveCount(0)
        host.paint([user, live], true, 'idle')
        await host.deliver()
        await expect(page.locator(`article[data-turn-id="${assistant.id}"]`)).toContainText(answer)
      }
    } finally { host.dispose() }
  })
}

test('retries a lost completed answer without waiting for another agent event', async ({ page }) => {
  const host = mobileHost(page)
  try {
    host.paint([user], true)
    await host.deliver()
    host.paint([user, { ...assistant, status: 'complete', content: [{ type: 'text', text: answer }] }], false, 'idle')
    await host.deliver(true)
    await expect.poll(async () => {
      await host.deliver()
      return (await page.locator(`article[data-turn-id="${assistant.id}"]`).allTextContents()).join(' ')
    }).toContain(answer)
    expect(host.delivered.filter(envelope => envelope.type === 'hydrate')).toHaveLength(1)
  } finally { host.dispose() }
})
