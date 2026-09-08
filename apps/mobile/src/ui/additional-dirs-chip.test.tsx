import { expect, jest, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { AdditionalDirsChip, AdditionalDirsMenu } from './additional-dirs-chip'

const PROJECT = ['/Users/dev/work/design-system']
const SESSION = ['/tmp/scratch']

function chip(props: { projectDirs?: string[]; sessionDirs?: string[]; onManage?: () => void } = {}) {
  // `MobileThemeProvider` carries the `MenuHost` this anchors into.
  return <AdditionalDirsChip projectDirs={props.projectDirs ?? PROJECT} sessionDirs={props.sessionDirs ?? []}
    onManage={props.onManage ?? (() => {})} />
}

test('the status row shows a count, not a list of names', async () => {
  // The row is already spending its width on a model name; the names are one
  // tap away, in the popover that can afford their full paths.
  await renderWithTheme(chip({ projectDirs: PROJECT, sessionDirs: SESSION }))

  expect(screen.getByLabelText('Additional folders: 2')).toBeTruthy()
  expect(screen.queryByText('design-system')).toBeNull()
})

test('the count spans both scopes, because the agent sees both', async () => {
  await renderWithTheme(chip({ projectDirs: ['/a', '/b'], sessionDirs: ['/c'] }))

  expect(screen.getByLabelText('Additional folders: 3')).toBeTruthy()
})

test('nothing is drawn when there are no extra folders', async () => {
  // A folder glyph reading zero is a permanent piece of furniture saying
  // nothing; `/add-dir` is still the way to the page. This is also how the
  // caller retires the chip once the session is running — it empties both lists
  // rather than the chip learning what a session is.
  await renderWithTheme(chip({ projectDirs: [], sessionDirs: [] }))

  expect(screen.queryByLabelText(/Additional folders/)).toBeNull()
})

function menu(props: { projectDirs?: string[]; sessionDirs?: string[]; onManage?: () => void } = {}) {
  return <AdditionalDirsMenu projectDirs={props.projectDirs ?? PROJECT} sessionDirs={props.sessionDirs ?? SESSION}
    onManage={props.onManage ?? (() => {})} />
}

test('the popover names each folder and spells out where it is', async () => {
  await renderWithTheme(menu())

  expect(screen.getByText('design-system')).toBeTruthy()
  expect(screen.getByText('/Users/dev/work/design-system')).toBeTruthy()
  expect(screen.getByText('scratch')).toBeTruthy()
  expect(screen.getByText('/tmp/scratch')).toBeTruthy()
})

test('the popover says which scope each folder belongs to', async () => {
  await renderWithTheme(menu())

  expect(screen.getByText('PROJECT')).toBeTruthy()
  expect(screen.getByText('SESSION')).toBeTruthy()
})

test('an empty scope is left out rather than labelled — this is a readout', async () => {
  await renderWithTheme(menu({ sessionDirs: [] }))

  expect(screen.getByText('PROJECT')).toBeTruthy()
  expect(screen.queryByText('SESSION')).toBeNull()
})

test('the path wraps, since it is what tells two folders of one name apart', async () => {
  const long = '/Users/dev/Developer/Projects/super-one/packages/shared/design-system'
  await renderWithTheme(menu({ projectDirs: [long] }))

  expect(screen.getByText(long).props.numberOfLines).toBeUndefined()
})

test('the popover ends in the way to change any of it', async () => {
  const onManage = jest.fn()
  await renderWithTheme(menu({ onManage }))

  fireEvent.press(screen.getByLabelText('Manage folders'))
  expect(onManage).toHaveBeenCalled()
})
