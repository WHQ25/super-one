import { expect, test } from '@jest/globals'
import { screen } from '@testing-library/react-native'
import type { RemoteProviderOption } from '@superone/shared/agent-types'
import { renderWithTheme } from '../test-render'
import { ProviderSection } from './model-picker-sections'

const PROVIDERS: RemoteProviderOption[] = [
  { id: null, name: 'Claude', brand: 'claude' },
  { id: 'cred-kimi', name: 'Kimi', brand: 'kimi', keyName: 'work key' },
]

function section(props: { selected: string | null; expanded: boolean }) {
  return <ProviderSection providers={PROVIDERS} selected={props.selected} expanded={props.expanded}
    onExpand={() => {}} onSelect={() => {}} />
}

test('the collapsed row carries the same brand lockup the expanded list does', async () => {
  // The row used to fall back to plain text, so the menu showed a mark on every
  // provider except the one currently selected.
  await renderWithTheme(section({ selected: 'cred-kimi', expanded: false }))
  expect(screen.getByLabelText('Kimi')).toBeTruthy()
})

test('the key rides on the provider row rather than a second line', async () => {
  await renderWithTheme(section({ selected: 'cred-kimi', expanded: false }))
  // The disclosure row spells its own name out, and `description` is what the
  // second line would be built from — the key must not reach it.
  expect(screen.getByLabelText('Kimi, work key')).toBeTruthy()
  expect(screen.getByText('work key')).toBeTruthy()
})

test('a provider with no key gets no badge', async () => {
  await renderWithTheme(section({ selected: null, expanded: false }))
  // The row and its lockup both answer to the bare name once no key qualifies it.
  expect(screen.getAllByLabelText('Claude')).toHaveLength(2)
  expect(screen.queryByText('work key')).toBeNull()
})

test('the expanded list keeps the key beside its provider', async () => {
  await renderWithTheme(section({ selected: 'cred-kimi', expanded: true }))
  expect(screen.getByLabelText('Kimi, work key')).toBeTruthy()
  expect(screen.getByText('work key')).toBeTruthy()
})
