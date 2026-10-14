import { expect, test, type Page } from '@playwright/test'

// Start the desktop Storybook first; the fixture uses real chat stores/renderers.
const base = process.env.SUPERONE_STORYBOOK_URL ?? 'http://localhost:6107'
const viewport = '[data-radix-scroll-area-viewport]'
async function open(page: Page, story: string) {
  await page.goto(`${base}/iframe.html?id=chat-transcript-performance--${story}&viewMode=story&globals=theme:dark`)
  await page.locator('[data-message-id]').first().waitFor()
  await page.waitForTimeout(600)
}
// A reader leaves the live tail with an upward wheel; a bare offset write is layout to the chat.
const scrollToTop = (page: Page) => page.locator(viewport).evaluate(el => {
  el.dispatchEvent(new WheelEvent('wheel', { deltaY: -el.scrollHeight, bubbles: true }))
  el.scrollTop = 0
})
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
  // Long turns above a short final reply: their first measurement must not be
  // clamped by the room left below the viewport.
  { story: 'claude-tool-turns', narrow: false, tail: /^Paragraph 0:/, distance: 240 },
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

test('spaces a long turn as if its virtual chunks were absent', async ({ page }) => {
  for (const story of ['codex-reasoning-narration', 'codex-long-turn']) {
    await open(page, story)
    await scrollToTop(page)
    await page.waitForTimeout(600)
    const margins = await page.evaluate(() => {
      const reply = [...document.querySelectorAll('.assistant-reply')].find(el => el.querySelector('[data-virtual-segment]'))!
      const texts = [...reply.querySelectorAll<HTMLElement>('.chat-md')]
      texts.forEach((text, index) => { text.dataset.probe = String(index) })
      // The same segments as direct children of the reply, as shorter turns draw them.
      const flat = reply.cloneNode(true) as HTMLElement
      for (const chunk of [...flat.querySelectorAll('[data-virtual-segment]')]) chunk.replaceWith(...(chunk.firstElementChild?.children ?? []))
      reply.after(flat)
      return texts.map(text => [getComputedStyle(text).marginTop, getComputedStyle(flat.querySelector(`[data-probe="${text.dataset.probe}"]`)!).marginTop])
    })
    expect(margins.length).toBeGreaterThan(2)
    for (const [chunked, flat] of margins) expect(chunked).toBe(flat)
  }
})

test('caps every pinned narration under collapsed process in a long compact turn', async ({ page }) => {
  await open(page, 'codex-long-turn')
  await scrollToTop(page)
  await page.waitForTimeout(600)
  const margins = await page.locator('.assistant-reply .chat-md').evaluateAll(texts => texts.map(text => getComputedStyle(text).marginTop))
  expect(margins.length).toBeGreaterThan(2)
  expect(new Set(margins).size).toBe(1)
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
  await scrollToTop(page)
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
  await scrollToTop(page)
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

// The transcript's padding sits outside the virtual list, so a short upward
// scroll still looks like "at the end" to list-relative geometry.
test('stays paused after a short upward scroll while streaming', async ({ page }) => {
  await open(page, 'long-history')
  await page.locator('[data-perf-append-chunk]').click()
  await expect.poll(() => bottomDistance(page)).toBeLessThan(2)
  await page.locator(viewport).evaluate(el => {
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -20, bubbles: true }))
    el.scrollTop -= 20
  })
  for (let index = 0; index < 3; index++) {
    await page.locator('[data-perf-append-chunk]').click()
    await page.waitForTimeout(150)
  }
  expect(await bottomDistance(page)).toBeGreaterThan(100)
})

// A taller decision composer covers the tail instead of pushing history up, and
// its return reveals the tail in place.
test('keeps history still while a taller decision composer comes and goes at the bottom', async ({ page }) => {
  await open(page, 'long-history')
  await expect.poll(() => bottomDistance(page)).toBeLessThan(2)
  const anchorTop = () => page.locator('.chat-md p').last().evaluate(el => el.getBoundingClientRect().top)
  const slotTop = () => page.getByTestId('composer-slot').evaluate(el => el.getBoundingClientRect().top)
  const before = await anchorTop()
  const restingSlot = await slotTop()
  await page.locator('[data-perf-permission]').click()
  await expect.poll(slotTop).toBeLessThan(restingSlot - 50)
  await page.waitForTimeout(600)
  expect(Math.abs(await anchorTop() - before)).toBeLessThan(1)
  await page.locator('[data-perf-permission]').click()
  await expect.poll(slotTop).toBe(restingSlot)
  await page.waitForTimeout(400)
  expect(Math.abs(await anchorTop() - before)).toBeLessThan(1)
  expect(await bottomDistance(page)).toBeLessThan(2)
})

test('covers the tail instead of pushing history while the text composer grows with a draft', async ({ page }) => {
  await open(page, 'long-history')
  await expect.poll(() => bottomDistance(page)).toBeLessThan(2)
  const anchorTop = () => page.locator('.chat-md p').last().evaluate(el => el.getBoundingClientRect().top)
  const slotTop = () => page.getByTestId('composer-slot').evaluate(el => el.getBoundingClientRect().top)
  const before = await anchorTop()
  const restingSlot = await slotTop()
  await page.getByTestId('composer-slot').locator('[contenteditable=true]').first().click()
  for (let line = 0; line < 4; line++) {
    await page.keyboard.type(`draft line ${line}`)
    await page.keyboard.press('Shift+Enter')
  }
  await expect.poll(slotTop).toBeLessThan(restingSlot - 40)
  expect(Math.abs(await anchorTop() - before)).toBeLessThan(1)
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await expect.poll(slotTop).toBe(restingSlot)
  expect(Math.abs(await anchorTop() - before)).toBeLessThan(1)
})

test('keeps compacted history navigable without mounting the full suffix', async ({ page }) => {
  await open(page, 'compacted-history')
  expect(await page.locator('[data-message-id="perf-0"]').count()).toBe(0)
  await page.locator('[data-perf-jump-first]').click()
  await expect(page.locator('[data-message-id="perf-0"]')).toBeVisible()
  expect(await page.locator('[data-message-id]').count()).toBeLessThan(24)
})

test('places two compactions inside one reply without folding history and ticks each of them', async ({ page }) => {
  await page.goto(`${base}/iframe.html?id=chat-transcript-segmentation--multiple-compactions&viewMode=story`)
  await expect.poll(() => page.locator('[data-tick]').evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.tick)))
    .toEqual(['segmented-question', 'first-compact', 'second-compact'])
  await expect.poll(() => page.locator('[data-message-id]').evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.messageId)))
    .toEqual(['segmented-question', 'segmented-turn', 'first-compact', 'segmented-turn:after:first-compact', 'second-compact', 'segmented-turn:after:second-compact'])
  await expect(page.getByRole('button', { name: /Show history|Hide history/ })).toHaveCount(0)
  // A compaction tick previews the first reply text after it.
  await page.locator('[data-tick="first-compact"]').hover()
  await expect(page.getByRole('tooltip')).toContainText('Between both compactions.')
  await page.locator('[data-tick="second-compact"]').click()
  await expect(page.locator('[data-message-id="segmented-turn:after:second-compact"]')).toContainText('After the second compaction.')
})

test('keeps async answers between the preceding and resumed assistant segments in narrow chat', async ({ page }) => {
  await page.goto(`${base}/iframe.html?id=chat-transcript-segmentation--narrow-async-answer&viewMode=story&globals=theme:dark`)
  await expect(page.locator('[data-message-id="segmented-turn:after:codex_async_answer:question"]')).toBeVisible()
  // The answer is the only user message, so the rail stays hidden.
  await expect(page.locator('[data-tick]')).toHaveCount(0)
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
  // Compact mode folds the earlier activities under Detail. A DOM click keeps
  // the reading position; a pointer click would scroll the button into view.
  await page.locator('.turn-detail-section button').evaluate((button: HTMLButtonElement) => button.click())
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
  await scrollToTop(page)
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
  await scrollToTop(page)
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
  await scrollToTop(page)
  await expect(page.locator('[data-tool-use-id="command-0"]')).toBeVisible()
  expect(await page.locator('[data-chat-root] .tool-node').count()).toBeLessThan(40)
  await openContentBlockTurn(page, 'narrow')
  await page.locator('[data-perf-file-chip] [role="button"]').click()
  await expect.poll(() => page.locator('[data-perf-chat]').evaluate(el => el.clientWidth)).toBeLessThan(250)
  await expect(page.getByText('Latest reply in the long-running turn.')).toBeVisible()
  expect(await page.locator('[data-chat-root] .tool-node').count()).toBeLessThan(40)
})
