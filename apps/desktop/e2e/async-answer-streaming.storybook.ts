import { expect, test } from '@playwright/test'

const base = process.env.SUPERONE_STORYBOOK_URL ?? 'http://localhost:6107'

for (const narrow of [false, true]) {
  test(`keeps an async answer at the next block boundary while text streams (narrow=${narrow})`, async ({ page }) => {
    await page.goto(`${base}/iframe.html?id=chat-transcript-segmentation--${narrow ? 'narrow-' : ''}streaming-async-answer&viewMode=story&globals=theme:dark;locale:zh`)
    const source = page.locator('[data-message-id="streaming-async-turn"]')
    const answer = page.locator('[data-codex-async-answer]')
    await expect(source).toContainText('长消息顶部的“')
    await expect(answer).toBeVisible()
    await page.getByRole('button', { name: 'Continue stream' }).click()
    await expect(source).toContainText('更早部分”文字。我会去掉这些提示。')
    await expect(source.locator('.chat-md')).toHaveCount(1)
    await page.getByRole('button', { name: 'Continue stream' }).click()
    const continuation = page.locator('[data-message-id="streaming-async-turn:after:codex_async_answer:streaming-question"]')
    await expect(continuation).toContainText('明白，加载前后都不显示任何提示。')
    await expect(continuation).not.toContainText('更早部分')
    await expect.poll(() => page.locator('.chat-message-wrapper[data-message-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-message-id'))))
      .toEqual(['streaming-async-turn', 'codex_async_answer:streaming-question', 'streaming-async-turn:after:codex_async_answer:streaming-question'])
  })
}
