/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'

let stories: typeof import('./SuggestedTaskToolBlock.stories')
beforeAll(async () => { stories = await import('./SuggestedTaskToolBlock.stories') }, 60_000)

it.each(['en', 'zh'])('shows remote model names and per-model effort in %s', async locale => {
  const previous = i18n.language
  await i18n.changeLanguage(locale)
  document.documentElement.classList.toggle('dark', locale === 'zh')
  const view = render(stories.RemoteModels.render!({}, {} as never))
  try {
    expect(screen.getByText('Opus')).toBeVisible()
    await userEvent.click(screen.getByText('Node Model'))
    expect(await screen.findByRole('slider')).toHaveAttribute('max', '1')
    expect(screen.getAllByText('High').length).toBeGreaterThan(0)
  } finally {
    view.unmount()
    document.documentElement.classList.remove('dark')
    await i18n.changeLanguage(previous)
  }
})

it('keeps the reopened remote card launched with no Launch button', async () => {
  render(stories.RemoteLaunchedReopened.render!({}, {} as never))
  fireEvent.click(screen.getByRole('button', { name: 'Switch session' }))
  fireEvent.click(screen.getByRole('button', { name: 'Switch session' }))
  expect(await screen.findByText('Launched')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Launch' })).toBeNull()
})
