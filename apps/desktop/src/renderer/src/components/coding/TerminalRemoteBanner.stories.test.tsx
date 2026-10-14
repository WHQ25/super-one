/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, expect, it } from 'vitest'
import i18n from 'i18next'

let stories: typeof import('./TerminalRemoteBanner.stories')
beforeAll(async () => {
  stories = await import('./TerminalRemoteBanner.stories')
}, 60_000)

it.each(['en', 'zh'])("takes over a tab its node's window took back, in %s", async (locale) => {
  const previous = i18n.language
  await i18n.changeLanguage(locale)
  const Preview = stories.default.component
  const { unmount } = render(<Preview {...stories.Narrow.args!} />)
  try {
    const takeOver = screen.getByRole('button', { name: i18n.t('shell.terminal.takeOver') })
    expect(screen.getByText(/Build server in the third floor lab \(Mac Studio\)/)).toBeInTheDocument()
    fireEvent.click(takeOver)
    expect(screen.queryByText(/Build server in the third floor lab/)).toBeNull()
  } finally {
    unmount()
    await i18n.changeLanguage(previous)
  }
})

it('shows tabs other clients hold here as view-only', () => {
  const Preview = stories.default.component
  for (const story of [stories.HeldByPhone, stories.HeldByAnotherDesktop]) {
    const { unmount } = render(<Preview {...story.args!} />)
    expect(screen.getByText('View Only')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Take Over|Disconnect/ })).toBeNull()
    unmount()
  }
})
