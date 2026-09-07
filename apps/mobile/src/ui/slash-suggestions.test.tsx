import { expect, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import type { SlashCommandMatch } from '../slash'
import { SlashSuggestions } from './composer-suggestions'

function match(name: string, extra: Partial<SlashCommandMatch['command']> = {}): SlashCommandMatch {
  return { command: { name, ...extra }, nameIndices: [], score: 0 }
}

test('splits commands from skills and counts each group', async () => {
  await renderWithTheme(
    <SlashSuggestions matches={[match('clear'), match('review'), match('tdd', { isSkill: true })]} onSelect={() => {}} />,
  )
  expect(screen.getByText('Commands')).toBeTruthy()
  expect(screen.getByText('Skills')).toBeTruthy()
  // Counts sit beside the header so an empty-looking group is still legible.
  expect(screen.getAllByText('2')).toHaveLength(1)
  expect(screen.getAllByText('1')).toHaveLength(1)
})

test('omits a group that has no rows', async () => {
  await renderWithTheme(<SlashSuggestions matches={[match('clear')]} onSelect={() => {}} />)
  expect(screen.queryByText('Skills')).toBeNull()
})

test('shows the argument hint and description a command declares', async () => {
  await renderWithTheme(
    <SlashSuggestions
      matches={[match('add-dir', { argumentHint: '[project|session] [dir]', description: 'Add a directory' })]}
      onSelect={() => {}}
    />,
  )
  expect(screen.getByText('[project|session] [dir]')).toBeTruthy()
  expect(screen.getByText('Add a directory')).toBeTruthy()
})

test('selects by command name, without the leading slash', async () => {
  const selected: string[] = []
  await renderWithTheme(<SlashSuggestions matches={[match('review')]} onSelect={(name) => selected.push(name)} />)
  fireEvent.press(screen.getByText('/review'))
  expect(selected).toEqual(['review'])
})

test('renders nothing when there are no matches', async () => {
  await renderWithTheme(<SlashSuggestions matches={[]} onSelect={() => {}} />)
  expect(screen.queryByTestId('slash-suggestions')).toBeNull()
})
