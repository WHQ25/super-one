/**
 * bun apps/desktop/scripts/benchmark-remote-tool-card.ts [--browser]
 * For A/B run this script in both checkouts. The optional Chromium pass uses
 * each checkout's production packages/chat-view/dist/index.html (vite build).
 * CHROME_PATH can point to a locally installed Chrome.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { processTurn } from '@superone/shared/transcript-window/window-fixtures'
import { planProcessFolds } from '@superone/chat-core/turn-process/process-folds'
import { toolDetail } from '@superone/runtime/stream/delivery/progressive-tools'
import { projectWindowMessage } from '@superone/runtime/stream/delivery/window-projection'
import type { Browser } from 'playwright'

const bytes = (data: unknown) => Buffer.byteLength(JSON.stringify(data))
const command = 'git diff -- ' + Array.from({ length: 16 }, (_, i) => `modules/component-${i}/src/index.ts`).join(' ')
const bash: ContentBlock = { type: 'tool_use', toolUseId: 't', toolName: 'Bash', status: 'complete',
  input: JSON.stringify({ command, description: 'Inspect modified modules', timeout: 60000 }) }
const sessions = Array.from({ length: 120 }, (_, i) => ({ id: `s${i}`, title: `Session ${i}` }))
const source: ChatMessage = { id: 'a', role: 'assistant', createdAt: '', status: 'complete', providerId: 'claude', content: [
  { type: 'tool_use', toolUseId: 'list', toolName: 'mcp__superone__session_list', input: '{"harness":"codex"}', status: 'complete' },
  { type: 'tool_result', toolUseId: 'list', summary: JSON.stringify({ count: sessions.length, sessions }) },
] }
const folded = processTurn('a', 120)
let edits = 0
for (const block of folded.content) {
  if ('toolName' in block && block.toolName === 'Edit') {
    block.input = JSON.stringify({ ...JSON.parse(block.input), file_path: `/packages/desktop/src/components/editor/long-name-${edits++}.ts` })
  }
}
const transcript = projectWindowMessage(source)
const detail = toolDetail(source, 'list')
console.log({ bashBytes: bytes(projectWindowMessage({ ...source, id: 'm', content: [bash] }).content[0]), archiveBytes: bytes(transcript),
  detailBytes: bytes(detail), foldBytes: bytes(planProcessFolds(folded).ranges[0].summary), edits })

async function measure(browser: Browser, delay: number) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, offline: true })
  try {
    await page.goto(pathToFileURL(resolve(import.meta.dirname, '../../../packages/chat-view/dist/index.html')).href)
    await page.waitForSelector('html[data-chat-view-ready="true"]')
    return await page.evaluate(async ({ transcript, detail, delay }) => {
      const host = window as unknown as { __applyHost: (message: unknown) => void; ReactNativeWebView: { postMessage(raw: string): void } }
      let subscriptions = 0
      host.ReactNativeWebView = { postMessage(raw) {
        const request = JSON.parse(raw)
        if (request.action !== 'subscribeDetail') return
        subscriptions++
        setTimeout(() => host.__applyHost({ type: 'nativeActionResult', requestId: request.requestId,
          result: { subscriptionId: request.payload.subscriptionId, revision: 0, offset: 0, text: detail } }), delay)
      } }
      host.__applyHost({ type: 'channelToken', token: 'card-benchmark' })
      const started = performance.now()
      host.__applyHost({ type: 'hydrate', sessionId: 'benchmark', sessionStatus: 'idle', messages: [transcript] })
      let firstRowMs: number | undefined
      do {
        await new Promise<void>(complete => requestAnimationFrame(() => complete()))
        const row = document.querySelector<HTMLElement>('article[data-turn-id="a"] .tool-node > div')
        if (!row || row.getBoundingClientRect().height === 0) continue
        const frameMs = performance.now() - started
        firstRowMs ??= frameMs
        if (/120 sessions/.test(row.innerText)) return { firstRowMs, correctHeaderMs: frameMs, subscriptions }
      } while (performance.now() - started < 3000)
      throw new Error('Archive header missing: ' + document.body.innerText.slice(0, 300))
    }, { transcript, detail, delay })
  } finally { await page.close() }
}

if (process.argv.includes('--browser')) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH })
  try {
    console.log({ chromium: browser.version(), viewport: '390x844', samples: 11 })
    const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
    for (const delay of [0, 80]) {
      await measure(browser, delay)
      const timings = []
      for (let sample = 0; sample < 11; sample++) timings.push(await measure(browser, delay))
      console.log({ detailDelayMs: delay, firstRowMedianMs: median(timings.map(t => t.firstRowMs)),
        correctHeaderMedianMs: median(timings.map(t => t.correctHeaderMs)), subscriptions: [...new Set(timings.map(t => t.subscriptions))] })
    }
  } finally { await browser.close() }
}
