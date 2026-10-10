import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const option = (name: string, fallback: string) => args.includes(name) ? args[args.indexOf(name) + 1] ?? fallback : fallback
const base = option('--url', 'http://localhost:6107')
const output = option('--output', '/tmp/chat-transcript-performance.json')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
const cdp = await page.context().newCDPSession(page)
await cdp.send('Performance.enable')
const results = []
try {
  for (const story of ['short-history', 'long-history', 'huge-reply']) {
    await page.goto(`${base}/iframe.html?id=chat-transcript-performance--${story}&viewMode=story&globals=theme:dark`)
    await page.locator('[data-message-id]').first().waitFor()
    await page.waitForTimeout(1500)
    const tail = story === 'huge-reply' ? 359 : story === 'long-history' ? 59 : 0
    await page.getByText(new RegExp(`^Paragraph ${tail}:`)).last().waitFor({ state: 'visible' })
    const runs = []
    // Warm the lazy markdown renderers and layout before collecting comparable runs.
    await page.locator('[data-perf-toggle]').click()
    await page.waitForTimeout(500)
    await page.locator('[data-perf-toggle]').click()
    await page.waitForTimeout(500)
    for (let run = 0; run < 5; run++) {
      const before = await cdp.send('Performance.getMetrics')
      const frames = await page.evaluate(async () => {
        const intervals: number[] = []
        let raf = 0
        let previous: number | undefined
        const tick = (time: number) => {
          if (previous !== undefined) intervals.push(time - previous)
          previous = time
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        document.querySelector<HTMLButtonElement>('[data-perf-toggle]')!.click()
        await new Promise(resolve => setTimeout(resolve, 500))
        cancelAnimationFrame(raf)
        const viewport = document.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')!
        return {
          maxFrameMs: Math.max(...intervals),
          framesOver32ms: intervals.filter(time => time > 32).length,
          mountedMessages: document.querySelectorAll('[data-message-id]').length,
          nodes: document.querySelector('[data-chat-root]')!.querySelectorAll('*').length,
          renderedParagraphs: document.querySelectorAll('.chat-md p').length,
          bottomDistance: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
          chatWidth: document.querySelector('[data-perf-chat]')!.getBoundingClientRect().width,
        }
      })
      if (!Number.isFinite(frames.maxFrameMs) || frames.chatWidth > 450 || !frames.renderedParagraphs) throw new Error('Animation or visible content did not render')
      const after = await cdp.send('Performance.getMetrics')
      const metric = (name: string) => 1000 * (
        (after.metrics.find(metric => metric.name === name)?.value ?? 0)
        - (before.metrics.find(metric => metric.name === name)?.value ?? 0)
      )
      runs.push({ ...frames, layoutMs: metric('LayoutDuration'), styleMs: metric('RecalcStyleDuration'), scriptMs: metric('ScriptDuration'), taskMs: metric('TaskDuration') })
      await page.locator('[data-perf-toggle]').click()
      await page.waitForTimeout(500)
    }
    const median = (key: keyof typeof runs[number]) => runs.map(run => run[key]).sort((a, b) => a - b)[Math.floor(runs.length / 2)]
    const summary = { story, nodes: median('nodes'), mountedMessages: median('mountedMessages'), layoutMs: median('layoutMs'), styleMs: median('styleMs'), maxFrameMs: median('maxFrameMs'), framesOver32ms: median('framesOver32ms'), bottomDistance: median('bottomDistance') }
    results.push({ ...summary, runs })
    console.log(JSON.stringify(summary))
  }
  await Bun.write(output, JSON.stringify({ viewport: { width: 1280, height: 800 }, transitionMs: 300, repetitions: 5, results }, null, 2))
  console.log(`Saved ${output}`)
} finally {
  await browser.close()
}
