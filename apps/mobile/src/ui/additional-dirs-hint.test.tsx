import { expect, jest, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { AdditionalDirsHint } from './additional-dirs-hint'

function hint(dirs: string[], onPress: () => void = () => {}) {
  return <AdditionalDirsHint dirs={dirs} onPress={onPress} />
}

test('names each folder by its basename, the way desktop and Flutter do', async () => {
  // The row used to read `+2 directories`, which said how many folders a session
  // had and never which ones — the only thing that tells two of them apart.
  await renderWithTheme(hint(['/Users/dev/work/design-system', '/Users/dev/work/protocol']))

  expect(screen.getByText('Additional folder:')).toBeTruthy()
  expect(screen.getByText('design-system')).toBeTruthy()
  expect(screen.getByText('protocol')).toBeTruthy()
})

test('a trailing separator does not empty the chip', async () => {
  await renderWithTheme(hint(['/Users/dev/work/design-system/']))

  expect(screen.getByLabelText('Additional folder: design-system')).toBeTruthy()
})

test('tapping a chip opens the panel that shows and edits the full paths', async () => {
  // The chip used to dead-end in a path tooltip. Seeing and changing now share
  // one entry point, the same panel `/add-dir` opens.
  const onPress = jest.fn()
  await renderWithTheme(hint(['/Users/dev/work/design-system'], onPress))

  fireEvent.press(screen.getByLabelText('Additional folder: design-system'))
  expect(onPress).toHaveBeenCalled()
})

test('renders nothing at all when the session has no extra folders', async () => {
  await renderWithTheme(hint([]))

  expect(screen.queryByText('Additional folder:')).toBeNull()
})
