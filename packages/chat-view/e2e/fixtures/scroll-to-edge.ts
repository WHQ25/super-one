import type { Page } from '@playwright/test'

/** Reach a transcript edge, including a swipe when there is no scrollable content. */
export async function scrollToEdge(page: Page, edge: 'top' | 'bottom' = 'top') {
  await page.evaluate((edge) => {
    window.scrollTo({ top: edge === 'top' ? 0 : document.documentElement.scrollHeight, behavior: 'instant' })
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: edge === 'top' ? -100 : 100 }))
  }, edge)
}
