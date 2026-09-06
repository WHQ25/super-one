import { expect, it } from 'vitest'
import { parsePreviewRoute } from './preview-route'

it('opens a known offline fixture with deterministic theme and harness', () => {
  expect(parsePreviewRoute('superone://native-preview?scenario=permission%2Fedit-diff&theme=dark&harness=codex')).toMatchObject({ kind: 'scenario', scenario: { id: 'permission/edit-diff' }, theme: 'dark', harness: 'codex' })
})

it('opens a named application-page fixture', () => {
  expect(parsePreviewRoute('superone://native-preview?page=New%20session&theme=light&harness=claude')).toEqual({ kind: 'shell', page: 'New session', theme: 'light', harness: 'claude' })
})

it('opens the tool catalog, so a screenshot run can address it directly', () => {
  expect(parsePreviewRoute('superone://native-preview?page=Tool%20catalog&theme=dark&harness=codex')).toEqual({ kind: 'shell', page: 'Tool catalog', theme: 'dark', harness: 'codex' })
})

it('ignores production links, unknown fixtures, ambiguous routes and invalid options', () => {
  for (const url of ['superone://pair?secret=not-a-preview', 'https://native-preview?scenario=plan/default', 'superone://native-preview?scenario=missing', 'superone://native-preview?page=Missing', 'superone://native-preview?scenario=plan/default&page=Chat', 'superone://native-preview?scenario=plan/default&harness=unknown', 'superone://native-preview?scenario=plan/default&theme=invalid']) {
    expect(parsePreviewRoute(url)).toBeNull()
  }
})

it('carries a known effort onto a shell page', () => {
  expect(parsePreviewRoute('superone://native-preview?page=Chat&harness=claude&theme=dark&effort=max'))
    .toMatchObject({ kind: 'shell', page: 'Chat', effort: 'max' })
})

it('leaves effort unset when the deep link omits it', () => {
  expect(parsePreviewRoute('superone://native-preview?page=Chat')).toMatchObject({ kind: 'shell', page: 'Chat', effort: undefined })
})

it('rejects an effort level no harness offers', () => {
  expect(parsePreviewRoute('superone://native-preview?page=Chat&effort=turbo')).toBeNull()
})
