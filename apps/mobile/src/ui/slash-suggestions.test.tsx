import { expect, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import type { MatchedSlashCommand } from '../slash'
import { SlashSuggestions } from './composer-suggestions'

function command(name: string, extra: Partial<MatchedSlashCommand> = {}): MatchedSlashCommand {
  return { name, description: '', argumentHint: '', isSkill: false, matchIndices: [], score: 0, matched: true, ...extra }
}

test('splits commands from skills and counts each group', async () => {
  await renderWithTheme(
    <SlashSuggestions
      matches={[command('clear'), command('review'), command('tdd', { isSkill: true })]}
      onSelect={() => {}}
    />,
  )
  expect(screen.getByText('Commands')).toBeTruthy()
  expect(screen.getByText('Skills')).toBeTruthy()
  expect(screen.getAllByText('2')).toHaveLength(1)
  expect(screen.getAllByText('1')).toHaveLength(1)
})

test('leads with whichever group the matcher put first', async () => {
  // The matcher emits group-contiguous output; the renderer must follow it
  // rather than impose Commands-then-Skills.
  await renderWithTheme(
    <SlashSuggestions
      matches={[command('release', { isSkill: true }), command('create-release-notes')]}
      onSelect={() => {}}
    />,
  )
  expect(screen.getAllByRole('header').map((node) => node.props.children)).toEqual(['Skills', 'Commands'])
})

test('omits a group that has no rows', async () => {
  await renderWithTheme(<SlashSuggestions matches={[command('clear')]} onSelect={() => {}} />)
  expect(screen.queryByText('Skills')).toBeNull()
})

test('shows the argument hint and description a command declares', async () => {
  await renderWithTheme(
    <SlashSuggestions
      matches={[command('add-dir', { argumentHint: '[project|session] [dir]', description: 'Add a directory' })]}
      onSelect={() => {}}
    />,
  )
  expect(screen.getByText('[project|session] [dir]')).toBeTruthy()
  expect(screen.getByText('Add a directory')).toBeTruthy()
})

test('selects by command name, without the leading slash', async () => {
  const selected: string[] = []
  await renderWithTheme(<SlashSuggestions matches={[command('review')]} onSelect={(name) => selected.push(name)} />)
  fireEvent.press(screen.getByText('/review'))
  expect(selected).toEqual(['review'])
})

test('says the catalog is still loading rather than looking empty', async () => {
  // An empty overlay is indistinguishable from "this harness has no commands".
  await renderWithTheme(<SlashSuggestions matches={[]} status="loading" onSelect={() => {}} />)
  expect(screen.getByText('Loading commands…')).toBeTruthy()
})

test('keeps showing rows it already has while the catalog reloads', async () => {
  await renderWithTheme(<SlashSuggestions matches={[command('clear')]} status="loading" onSelect={() => {}} />)
  expect(screen.getByText('/clear')).toBeTruthy()
  expect(screen.getByText('Loading commands…')).toBeTruthy()
})

test('reports a catalog that failed to load', async () => {
  await renderWithTheme(<SlashSuggestions matches={[]} status="error" onSelect={() => {}} />)
  expect(screen.getByText('Could not load commands')).toBeTruthy()
})

test('offers a way out of the overlay', async () => {
  let dismissed = 0
  await renderWithTheme(
    <SlashSuggestions matches={[command('clear')]} onSelect={() => {}} onDismiss={() => { dismissed += 1 }} />,
  )
  fireEvent.press(screen.getByLabelText('Hide commands'))
  expect(dismissed).toBe(1)
})

test('renders nothing when a settled catalog has no matches', async () => {
  await renderWithTheme(<SlashSuggestions matches={[]} onSelect={() => {}} />)
  expect(screen.queryByTestId('slash-suggestions')).toBeNull()
})
