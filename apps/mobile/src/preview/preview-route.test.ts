import { expect, it } from 'vitest'
import { parsePreviewRoute } from './preview-route'

it('opens a known offline fixture with deterministic theme and harness', () => {
  expect(parsePreviewRoute('superone://native-preview?scenario=permission%2Fedit-diff&theme=dark&harness=codex')).toMatchObject({ scenario: { id: 'permission/edit-diff' }, theme: 'dark', harness: 'codex' })
})

it('ignores production links, unknown fixtures and invalid theme/harness values', () => {
  for (const url of ['superone://pair?secret=not-a-preview', 'https://native-preview?scenario=plan/default', 'superone://native-preview?scenario=missing', 'superone://native-preview?scenario=plan/default&harness=unknown', 'superone://native-preview?scenario=plan/default&theme=invalid']) {
    expect(parsePreviewRoute(url)).toBeNull()
  }
})
