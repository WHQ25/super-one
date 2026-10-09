/** @vitest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react'
import { beforeAll, expect, it } from 'vitest'
import i18n from 'i18next'

let Preview: typeof import('./ProjectSidebarRow.stories')['default']['component']
beforeAll(async () => {
  Preview = (await import('./ProjectSidebarRow.stories')).default.component
}, 60_000)

it.each([
  { width: 280, locale: 'en', dark: false },
  { width: 220, locale: 'zh', dark: true },
])('shows the first child row nested after hydration at $width px in $locale', async ({ width, locale, dark }) => {
  const previousLocale = i18n.language
  document.documentElement.classList.toggle('dark', dark)
  await i18n.changeLanguage(locale)
  const { unmount } = render(<Preview width={width} />)
  const matchesTitle = (_text: string, element: Element | null) => element?.classList.contains('animated-title-inner') === true && !!element.textContent?.includes('M2-3')
  try {
    expect(screen.queryByText(matchesTitle)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Complete child hydration' }))
    const title = await screen.findByText(matchesTitle)
    const row = title.closest('.group\\/session')!
    expect(row).not.toBeNull()
    expect(row.querySelector('.lucide-corner-down-right')).not.toBeNull()
  } finally {
    unmount()
    document.documentElement.classList.remove('dark')
    await i18n.changeLanguage(previousLocale)
  }
})
