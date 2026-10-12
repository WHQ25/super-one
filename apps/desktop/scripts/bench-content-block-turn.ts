import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'

// Real transcripts stay in a private local file, never in a checked-in fixture.
const args = process.argv.slice(2)
const option = (name: string, fallback: string) => args.includes(name) ? args[args.indexOf(name) + 1] ?? fallback : fallback
const base = option('--url', 'http://localhost:6006')
const sample = option('--sample', '')
const output = option('--output', '/tmp/content-block-turn-performance.json')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const cdp = await page.context().newCDPSession(page)
  await page.goto(`${base}/iframe.html?id=chat-contentblock-turn-performance--streaming&viewMode=story&globals=theme:dark;locale:zh`)
  await page.locator('[data-message-id]').first().waitFor()
  const sampleInfo = sample ? await page.evaluate(async messages => {
    // Import the same HMR module instance as the story, rather than creating a
    // second store by dropping its version query parameter.
    const url = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(url => /\/stores\/chat\.ts(?:\?|$)/.test(url))!
    const { useChatStore } = await import(/* @vite-ignore */ url)
    const state = useChatStore.getState()
    const projectPath = state.activeProject
    const project = state.projectSessions[projectPath]
    const sessionId = project._activeSessionId
    const last = messages.at(-1)!
    const replay = [...messages.slice(0, -1), { ...last, status: 'streaming' }]
    useChatStore.setState({ projectSessions: { ...state.projectSessions, [projectPath]: {
      ...project, _sessions: { ...project._sessions, [sessionId]: {
        ...project._sessions[sessionId], status: 'streaming', messages: replay,
      } },
    } } })
    return { messages: messages.length, tailBlocks: last.content.length,
      tailTools: last.content.filter((block: { type: string }) => block.type === 'tool_use').length }
  }, JSON.parse(readFileSync(sample, 'utf8'))) : null
  await page.locator('[data-chat-root] .chat-md').last().waitFor({ state: 'visible' })
  await page.waitForTimeout(1500)
  await cdp.send('Performance.enable')
  const chip = page.locator('[data-perf-file-chip] [role="button"]')
  // Warm file preview/editor modules before comparing the layout work.
  await chip.click()
  await page.locator('[data-activity-outer]').evaluate(async element => {
    for (let index = 0; index < 100 && element.getBoundingClientRect().width < 399; index++) await new Promise(resolve => setTimeout(resolve, 30))
  })
  await page.waitForTimeout(800)
  await page.locator('[data-perf-close-panel]').click()
  await page.waitForTimeout(500)
  const runs = []
  for (let index = 0; index < 3; index++) {
    const before = await cdp.send('Performance.getMetrics')
    const frames = await page.evaluate(async () => {
      const intervals: number[] = []
      let previous = performance.now()
      let raf = 0
      const tick = (now: number) => { intervals.push(now - previous); previous = now; raf = requestAnimationFrame(tick) }
      raf = requestAnimationFrame(tick)
      const start = performance.now()
      document.querySelector<HTMLElement>('[data-perf-file-chip] [role="button"]')!.click()
      let firstFrameMs = 0
      requestAnimationFrame(() => { firstFrameMs = performance.now() - start })
      await new Promise(resolve => setTimeout(resolve, 800))
      await new Promise(requestAnimationFrame)
      cancelAnimationFrame(raf)
      const viewport = document.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')!
      return { firstFrameMs, maxFrameMs: Math.max(...intervals), frameSamples: intervals.length,
        framesOver32ms: intervals.filter(time => time > 32).length,
        chatDomNodes: document.querySelector('[data-chat-root]')!.querySelectorAll('*').length,
        mountedTools: document.querySelectorAll('[data-chat-root] .tool-node').length,
        renderedTextCharacters: [...document.querySelectorAll('[data-chat-root] .chat-md')].reduce((count, element) => count + (element.textContent?.length ?? 0), 0),
        virtualSegments: document.querySelectorAll('[data-virtual-segment]').length,
        bottomDistance: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
        panelWidth: document.querySelector('[data-activity-outer]')!.getBoundingClientRect().width }
    })
    if (!frames.frameSamples || !Number.isFinite(frames.maxFrameMs) || frames.panelWidth < 399 || !frames.renderedTextCharacters) throw new Error('Panel or visible reply did not render, or frame sampling failed')
    const after = await cdp.send('Performance.getMetrics')
    const metric = (name: string) => 1000 * ((after.metrics.find(metric => metric.name === name)?.value ?? 0) - (before.metrics.find(metric => metric.name === name)?.value ?? 0))
    runs.push({ ...frames, layoutMs: metric('LayoutDuration'), styleMs: metric('RecalcStyleDuration'), scriptMs: metric('ScriptDuration'), taskMs: metric('TaskDuration') })
    await page.locator('[data-perf-close-panel]').click()
    await page.waitForTimeout(500)
  }
  const summary = Object.fromEntries(Object.keys(runs[0]).map(key => [key, runs.map(run => run[key as keyof typeof run]).sort((a, b) => a - b)[1]]))
  const result = { environment: 'Isolated Chromium, production ChatContent/FileChip/ActivityPanel, local file IPC stubs', sampleInfo,
    replayStatus: 'streaming', repetitions: 3, method: 'Median of three warmed file-chip opens; first frame includes click-to-render stall', summary, runs }
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result.summary))
  console.log(`Saved ${output}`)
} finally {
  await browser.close()
}
