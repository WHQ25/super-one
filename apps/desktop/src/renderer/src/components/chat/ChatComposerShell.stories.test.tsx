/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, expect, it } from 'vitest'
import i18n from 'i18next'

let stories: typeof import('./ChatComposerShell.stories')
beforeAll(async () => {
  // jsdom has no FontFaceSet; the editor waits for browser font metrics.
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
  stories = await import('./ChatComposerShell.stories')
  window.app.collaborationMailbox = { list: async () => [], onChanged: () => () => {} }
}, 60_000)

it.each([
  ['en', false, 'PasteOnlyDraft'],
  ['en', true, 'PasteOnlyDraftDark'],
  ['zh', false, 'PasteOnlyDraftChinese'],
  ['zh', true, 'PasteOnlyDraftNarrow'],
] as const)('restores a paste-only draft after reopening the composer (%s, dark=%s, %s)', async (locale, dark, name) => {
  const previousLocale = i18n.language
  const previousDark = document.documentElement.classList.contains('dark')
  await i18n.changeLanguage(locale)
  document.documentElement.classList.toggle('dark', dark)
  const view = render(stories[name].render!({ showTodoPopup: false }, {} as never))
  try {
    const expectPaste = () => expect(view.container.querySelector('[data-paste-chip]')).not.toBeNull()
    await waitFor(expectPaste)
    fireEvent.click(screen.getByRole('button', { name: 'Reopen composer' }))
    await waitFor(expectPaste)
  } finally {
    view.unmount()
    document.documentElement.classList.toggle('dark', previousDark)
    await i18n.changeLanguage(previousLocale)
  }
})
