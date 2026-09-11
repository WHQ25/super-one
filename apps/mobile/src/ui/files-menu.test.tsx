import { expect, jest, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { FilesMenuBody } from './files-menu'

test('a project tree offers search, upload and a new folder', async () => {
  const onSearch = jest.fn()
  const onUploadFile = jest.fn()
  const onNewFolder = jest.fn()
  await renderWithTheme(
    <FilesMenuBody kind="project" onSearch={onSearch} onUploadFile={onUploadFile} onNewFolder={onNewFolder} />,
  )

  fireEvent.press(screen.getByLabelText('Search Files'))
  fireEvent.press(screen.getByLabelText('Upload File'))
  fireEvent.press(screen.getByLabelText('New Folder'))
  expect(onSearch).toHaveBeenCalled()
  expect(onUploadFile).toHaveBeenCalled()
  expect(onNewFolder).toHaveBeenCalled()
  expect(screen.queryByLabelText('Go to Folder')).toBeNull()
})
