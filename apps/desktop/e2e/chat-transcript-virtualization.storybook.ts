import { expect, test, type Page } from '@playwright/test'

// Start the desktop Storybook first; the fixture uses real chat stores/renderers.
const base = process.env.SUPERONE_STORYBOOK_URL ?? 'http://localhost:6107'
const viewport = '[data-radix-scroll-area-viewport]'
async function open(page: Page, story: string) {
  await page.goto(`${base}/iframe.html?id=chat-transcript-performance--${story}&viewMode=story&globals=theme:dark`)
  await page.locator('[data-message-id]').first().waitFor()
  await page.waitForTimeout(600)
}
const bottomDistance = (page: Page) => page.locator(viewport).evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)

// Sample the reading anchor throughout each cold reveal, rather than accepting
// a jump that is corrected only after a later ResizeObserver/frame.
async function backwardScrollErrors(page: Page, distance = 120) {
  return page.locator(viewport).evaluate(async (el, distance) => {
    const errors: number[] = []
    for (let step = 0; step < 12; step++) {
      const bounds = el.getBoundingClientRect()
      const anchor = Array.from(el.querySelectorAll<HTMLElement>('.chat-md p, .chat-md pre, [data-tool-use-id]')).find(node => {
        const box = node.getBoundingClientRect()
        return box.bottom > bounds.top + 30 && box.top < bounds.bottom - 50
      })
      if (!anchor) throw new Error('No mounted reading anchor')
      const before = anchor.getBoundingClientRect().top
      const scrollTop = el.scrollTop
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: -distance, bubbles: true }))
      el.scrollTop = Math.max(0, scrollTop - distance)
      const expected = before + scrollTop - el.scrollTop
      await new Promise<void>((resolve, reject) => {
        let started: number | undefined
        const sample = (time: number) => {
          started ??= time
          if (!anchor.isConnected) { reject(new Error('Reading anchor evicted during one scroll step')); return }
          errors.push(Math.abs(anchor.getBoundingClientRect().top - expected))
          if (time - started < 180) requestAnimationFrame(sample)
          else resolve()
        }
        requestAnimationFrame(sample)
      })
    }
    return errors
  }, distance)
}

for (const scenario of [
  { story: 'long-history', narrow: true, tail: /^Paragraph 59:/, distance: 120 },
  { story: 'chinese-history', narrow: false, tail: /^段落 59：/, distance: 120 },
  { story: 'sparse-code-history', narrow: false, tail: /^Final reading anchor\./, distance: 480 },
  { story: 'codex-reasoning-narration', narrow: false, tail: /^Update 29:/, distance: 120 },
]) {
  test(`holds the reading anchor on first upward scroll in ${scenario.story}${scenario.narrow ? ' after narrowing' : ''}`, async ({ page }) => {
    await open(page, scenario.story)
    if (scenario.narrow) {
      await page.locator('[data-perf-toggle]').click()
      await expect.poll(() => page.locator('[data-perf-chat]').evaluate(el => el.clientWidth)).toBeLessThan(410)
      await expect.poll(() => page.locator('[data-perf-panel]').evaluate(el => el.getBoundingClientRect().width)).toBe(360)
    }
    await expect.poll(() => bottomDistance(page)).toBeLessThan(2)
    await page.getByText(scenario.tail).waitFor({ state: 'visible' })
    expect(Math.max(...await backwardScrollErrors(page, scenario.distance))).toBeLessThan(1)
    expect(await page.locator('[data-virtual-markdown-block] p').count()).toBeLessThan(30)

    await page.locator(viewport).evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect.poll(() => bottomDistance(page)).toBeLessThan(2)
    expect(Math.max(...await backwardScrollErrors(page, scenario.distance))).toBeLessThan(1)
  })
}

test('spaces narration under reasoning the same across virtual turn chunks', async ({ page }) => {
  await open(page, 'codex-reasoning-narration')
  const gaps = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.thinking-node, .after-thinking')]
    return nodes.flatMap((text, index) => {
      const reasoning = nodes[index - 1]
      if (!text.classList.contains('after-thinking') || !reasoning?.classList.contains('thinking-node')) return []
      const label = reasoning.firstElementChild!.getBoundingClientRect()
      const edge = reasoning.closest('[data-virtual-segment]') !== text.closest('[data-virtual-segment]')
      return [{ gap: Math.round((text.querySelector('p')!.getBoundingClientRect().top - label.bottom) * 10) / 10, edge }]
    })
  })
  expect(gaps.some(item => item.edge)).toBe(true)
  expect(new Set(gaps.map(item => item.gap)).size).toBe(1)
})

test('spaces virtual markdown blocks exactly like the unwrapped reply', async ({ page }) => {
  await open(page, 'long-history')
  const { virtual, plain } = await page.evaluate(() => {
    const markdown = [...document.querySelectorAll('.chat-md')].find(el => el.querySelector('[data-virtual-markdown-block] > *'))!
    const mounted = [...markdown.children].filter(el => el.matches('[data-virtual-markdown-block]') && el.firstElementChild)
    mounted.forEach((wrapper, index) => { (wrapper.firstElementChild as HTMLElement).dataset.k = String(index) })
    // The same blocks as direct children of the markdown root, as short replies draw them.
    const unwrapped = markdown.cloneNode(true) as HTMLElement
    for (const wrapper of [...unwrapped.children]) if (wrapper.matches('[data-virtual-markdown-block]')) wrapper.replaceWith(...wrapper.children)
    markdown.before(unwrapped)
    const gaps = (root: Element) => mounted.slice(1).map((_, index) => {
      const top = (k: number) => root.querySelector(`[data-k="${k}"]`)!.getBoundingClientRect()
      return Math.round((top(index + 1).top - top(index).bottom) * 10) / 10
    })
    return { virtual: gaps(markdown), plain: gaps(unwrapped) }
  })
  expect(virtual.length).toBeGreaterThan(3)
  expect(virtual).toEqual(plain)
})

async function jump(page: Page, id: string, atEnd = false) {
  await page.locator(`[data-tick="${id}"]`).evaluate((button: HTMLButtonElement) => button.click())
  await expect(page.locator(`[data-message-id="${id}"]`)).toBeVisible()
  await expect.poll(() => page.locator(`[data-message-id="${id}"]`).evaluate(el => {
    const viewport = el.closest('[data-radix-scroll-area-viewport]')!
    return Math.abs(el.getBoundingClientRect().top - viewport.getBoundingClientRect().top)
  })).toBeLessThan(atEnd ? 427 : 30)
}

test('bounds mounted history during distant jumps and keeps panel resizing pinned at the bottom', async ({ page }) => {
  await open(page, 'many-turns')
  await expect.poll(() => bottomDistance(page)).toBeLessThan(2)
  expect(await page.locator('[data-message-id]').count()).toBeLessThan(24)
  await jump(page, 'perf-1000')
  expect(await page.locator('[data-message-id]').count()).toBeLessThan(24)
  await page.locator('[data-perf-jump-first]').click()
  await expect(page.locator('[data-message-id="perf-0"]')).toBeVisible()
  expect(await page.locator('[data-message-id]').count()).toBeLessThan(24)

  await open(page, 'long-history')
  await page.locator('[data-perf-toggle]').click()
  await expect.poll(() => page.locator('[data-perf-chat]').evaluate(el => el.clientWidth)).toBeLessThan(410)
  await expect.poll(() => bottomDistance(page)).toBeLessThan(2)
  expect(await page.locator('[data-message-id]').count()).toBeLessThan(12)
})

test('bounds a single huge reply, reveals both ends and preserves an active selection', async ({ page }) => {
  await open(page, 'huge-reply')
  await expect(page.getByText(/^Paragraph 359:/)).toBeVisible()
  expect(await page.locator('[data-virtual-markdown-block] p').count()).toBeLessThan(30)
  const selected = await page.locator('[data-virtual-markdown-block] p').last().evaluate(el => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = document.getSelection()!
    selection.removeAllRanges(); selection.addRange(range)
    return selection.toString()
  })
  await page.waitForTimeout(100)
  await page.locator(viewport).evaluate(el => { el.scrollTop = 0 })
  await expect(page.getByText(/^Paragraph 0:/)).toBeVisible()
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe(selected)
  await page.evaluate(() => document.getSelection()?.removeAllRanges())
  await expect(page.getByText(/^Paragraph 359:/)).toHaveCount(0)
  expect(await page.locator('[data-virtual-markdown-block] p').count()).toBeLessThan(30)
})

test('retains a selected message outside the virtual range until selection is cleared', async ({ page }) => {
  await open(page, 'short-history')
  const selected = await page.locator('[data-message-id="perf-119"] .chat-md p').evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el)
    const selection = document.getSelection()!
    selection.removeAllRanges(); selection.addRange(range)
    return selection.toString()
  })
  await page.waitForTimeout(100)
  await page.locator(viewport).evaluate(el => { el.scrollTop = 0 })
  await expect(page.locator('[data-message-id="perf-0"]')).toBeVisible()
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe(selected)
  expect(await page.locator('[data-message-id]').count()).toBeLessThan(24)
  await page.evaluate(() => document.getSelection()?.removeAllRanges())
  await expect(page.locator('[data-message-id="perf-119"]')).toHaveCount(0)
})

test('keeps tool disclosure state after eviction and remount', async ({ page }) => {
  await open(page, 'stateful-tools')
  const tool = page.locator('[data-tool-use-id="bash-perf-119"]')
  await tool.locator(':scope > div').first().click()
  await expect(tool.getByText('output-perf-119', { exact: true })).toBeVisible()
  await jump(page, 'perf-0')
  await expect(tool).toHaveCount(0)
  await jump(page, 'perf-118', true)
  await expect(tool.getByText('output-perf-119', { exact: true })).toBeVisible()
})

test('follows streaming at the bottom and holds history when following is paused', async ({ page }) => {
  await open(page, 'long-history')
  for (let index = 0; index < 3; index++) {
    await page.locator('[data-perf-append-chunk]').click()
    await expect.poll(() => bottomDistance(page)).toBeLessThan(2)
  }
  await jump(page, 'perf-60')
  const before = await page.locator('[data-message-id="perf-60"]').evaluate(el => el.getBoundingClientRect().top)
  for (let index = 0; index < 3; index++) await page.locator('[data-perf-append-chunk]').click()
  await page.waitForTimeout(400)
  const after = await page.locator('[data-message-id="perf-60"]').evaluate(el => el.getBoundingClientRect().top)
  expect(Math.abs(after - before)).toBeLessThan(3)
  expect(await bottomDistance(page)).toBeGreaterThan(1000)
})

test('keeps compacted history navigable without mounting the full suffix', async ({ page }) => {
  await open(page, 'compacted-history')
  expect(await page.locator('[data-message-id="perf-0"]').count()).toBe(0)
  await page.locator('[data-perf-jump-first]').click()
  await expect(page.locator('[data-message-id="perf-0"]')).toBeVisible()
  expect(await page.locator('[data-message-id]').count()).toBeLessThan(24)
})

test('places two compactions inside one reply without folding history or adding compact ticks', async ({ page }) => {
  await page.goto(`${base}/iframe.html?id=chat-transcript-segmentation--multiple-compactions&viewMode=story`)
  await expect(page.locator('[data-tick]')).toHaveCount(3)
  await expect.poll(() => page.locator('[data-message-id]').evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.messageId)))
    .toEqual(['segmented-turn', 'first-compact', 'segmented-turn:after:first-compact', 'second-compact', 'segmented-turn:after:second-compact'])
  await expect(page.getByRole('button', { name: /Show history|Hide history/ })).toHaveCount(0)
  await page.locator('[data-tick="segmented-turn:after:first-compact"]').hover()
  await expect(page.getByRole('tooltip')).toContainText('Between both compactions.')
  await page.locator('[data-tick="segmented-turn:after:second-compact"]').click()
  await expect(page.locator('[data-message-id="segmented-turn:after:second-compact"]')).toContainText('After the second compaction.')
})

test('keeps async answers between the preceding and resumed assistant segments in narrow chat', async ({ page }) => {
  await page.goto(`${base}/iframe.html?id=chat-transcript-segmentation--narrow-async-answer&viewMode=story&globals=theme:dark`)
  await expect(page.locator('[data-tick="segmented-turn:after:codex_async_answer:question"]')).toBeVisible()
  const ids = await page.locator('[data-message-id]').evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.messageId))
  expect(ids.indexOf('codex_async_answer:question')).toBeGreaterThan(ids.indexOf('segmented-turn'))
  expect(ids.indexOf('segmented-turn:after:codex_async_answer:question')).toBeGreaterThan(ids.indexOf('codex_async_answer:question'))
  await expect(page.locator('[data-message-id="segmented-turn"]')).not.toContainText('After the answer')
  await expect(page.locator('[data-message-id="segmented-turn:after:codex_async_answer:question"]')).toContainText('After the answer')
  await expect(page.locator(viewport)).toBeVisible()
})

test('preserves reference definitions and semantic markdown around virtual block boundaries', async ({ page }) => {
  await open(page, 'semantic-markdown')
  await page.locator('[data-perf-jump-first]').click()
  await expect(page.getByRole('heading', { name: 'Semantic markdown' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Reference link' })).toHaveAttribute('href', 'https://example.com/docs')
  await expect(page.locator('li li')).toContainText('Nested child')
  await expect(page.locator('.chat-md table')).toContainText('Alpha')
  await expect(page.locator('.chat-md pre')).toContainText('const answer = 42')
  await expect(page.locator('.katex')).toBeVisible()
})

test('bounds a thousand Codex activities across content segments and preserves tool state', async ({ page }) => {
  await open(page, 'codex-long-turn')
  await expect(page.getByText('echo activity-799', { exact: true })).toBeVisible()
  expect(await page.locator('.tool-node').count()).toBeLessThan(40)
  expect(await page.locator('[data-chat-root] *').count()).toBeLessThan(4500)
  await page.locator('[data-perf-toggle]').click()
  await expect.poll(() => bottomDistance(page)).toBeLessThan(2)
  await expect(page.getByText('echo activity-799', { exact: true })).toBeVisible()
  expect(await page.locator('.tool-node').count()).toBeLessThan(40)

  // A nested tool's open state survives leaving the segment range.
  const last = page.locator('.tool-node').filter({ hasText: 'echo activity-799' })
  await last.locator(':scope > div').first().click()
  await expect(last.locator('.text-terminal-muted')).toBeVisible()
  await expect(last.locator('.text-terminal-muted')).toContainText('output-activity-799')
  await page.locator(viewport).evaluate(el => { el.scrollTop = 0 })
  await expect(page.getByText('echo activity-0', { exact: true })).toBeVisible()
  await expect(last).toHaveCount(0)
  await page.locator(viewport).evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect(last.locator('.text-terminal-muted')).toBeVisible()
  await expect(last.locator('.text-terminal-muted')).toContainText('output-activity-799')
  expect(await page.locator('.tool-node').count()).toBeLessThan(40)
})

async function openContentBlockTurn(page: Page, story = 'streaming', globals = 'theme:dark;locale:zh') {
  await page.goto(`${base}/iframe.html?id=chat-contentblock-turn-performance--${story}&viewMode=story&globals=${globals}`)
  await page.getByText('Latest reply in the long-running turn.').waitFor()
  await expect.poll(() => page.locator('[data-chat-root] .tool-node').count()).toBeLessThan(40)
}

test('bounds a live ContentBlock turn during file-chip opens and restores evicted tools', async ({ page }) => {
  await openContentBlockTurn(page)
  const last = page.locator('[data-tool-use-id="command-611"]')
  await last.locator(':scope > div').first().click()
  await expect(last.getByText('output-activity-611', { exact: true })).toBeVisible()
  await page.locator('[data-perf-file-chip] [role="button"]').click()
  await expect.poll(() => page.locator('[data-activity-outer]').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(399)
  await expect(page.getByRole('tabpanel', { name: 'preview.txt' })).toContainText('File preview is ready.')
  expect(await page.locator('[data-chat-root] .tool-node').count()).toBeLessThan(40)
  expect(await page.locator('[data-chat-root] *').count()).toBeLessThan(4000)
  await page.locator('[data-perf-append-chunk]').click()
  await expect(page.getByText('Newest streamed update.')).toBeVisible()
  await expect.poll(() => bottomDistance(page)).toBeLessThan(3)

  const selected = await page.getByText('Newest streamed update.').evaluate(el => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = document.getSelection()!
    selection.removeAllRanges(); selection.addRange(range)
    return selection.toString()
  })
  await page.locator(viewport).evaluate(el => { el.scrollTop = 0 })
  await expect(page.locator('[data-tool-use-id="command-0"]')).toBeVisible()
  expect(await page.evaluate(() => document.getSelection()?.toString())).toBe(selected)
  await page.evaluate(() => document.getSelection()?.removeAllRanges())
  await expect(last).toHaveCount(0)
  const before = await page.locator('[data-tool-use-id="command-0"]').evaluate(el => el.getBoundingClientRect().top)
  await page.locator('[data-perf-append-chunk]').click()
  await page.waitForTimeout(200)
  const after = await page.locator('[data-tool-use-id="command-0"]').evaluate(el => el.getBoundingClientRect().top)
  expect(Math.abs(after - before)).toBeLessThan(3)
  await page.locator(viewport).evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect(last.getByText('output-activity-611', { exact: true })).toBeVisible()
})

test('keeps completed ContentBlock details and narrow streaming turns bounded', async ({ page }) => {
  await openContentBlockTurn(page, 'completed-details', 'theme:light;locale:en')
  await page.locator(viewport).evaluate(el => { el.scrollTop = 0 })
  await expect(page.locator('[data-tool-use-id="command-0"]')).toBeVisible()
  expect(await page.locator('[data-chat-root] .tool-node').count()).toBeLessThan(40)
  await openContentBlockTurn(page, 'narrow')
  await page.locator('[data-perf-file-chip] [role="button"]').click()
  await expect.poll(() => page.locator('[data-perf-chat]').evaluate(el => el.clientWidth)).toBeLessThan(250)
  await expect(page.getByText('Latest reply in the long-running turn.')).toBeVisible()
  expect(await page.locator('[data-chat-root] .tool-node').count()).toBeLessThan(40)
})
