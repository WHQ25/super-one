import { expect, jest, test } from '@jest/globals'
import { act, fireEvent } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { WorkspaceDrafts } from './workspace-drafts'
import { DraftsPreview, draftPreviewRows } from './workspace-drafts.stories'

test('opens a shared draft and displays pending sync for an offline draft', async () => {
  const open = jest.fn()
  const view = await renderWithTheme(<WorkspaceDrafts drafts={draftPreviewRows} onOpenDraft={open} onDeleteDraft={() => {}} />)
  expect(view.getAllByLabelText('Pending Sync').length).toBeGreaterThan(0)
  expect(view.queryByText('Drafts')).toBeNull()
  expect(view.queryByText(/gpt-5.4/)).toBeNull()
  await act(async () => { fireEvent.press(view.getByText(draftPreviewRows[0].title)) })
  expect(open).toHaveBeenCalledWith(draftPreviewRows[0])
})
test('hides the section when there are no drafts', async () => {
  const view = await renderWithTheme(<WorkspaceDrafts drafts={[]} onOpenDraft={() => {}} onDeleteDraft={() => {}} />)
  expect(view.queryByTestId('workspace-drafts')).toBeNull()
})

test('places ungrouped draft rows under Projects before the project rows', async () => {
  const view = await renderWithTheme(<DraftsPreview />)
  expect(view.getAllByText(/^(Projects|Continue the mobile composer migration|SuperOne)$/).map((node) => node.props.children))
    .toEqual(['Projects', draftPreviewRows[0].title, 'SuperOne'])
  expect(view.queryByText('Drafts')).toBeNull()
})

test('removes a cleared draft row instead of rendering Untitled Draft', async () => {
  const props = { onOpenDraft: () => {}, onDeleteDraft: () => {} }
  const view = await renderWithTheme(<WorkspaceDrafts {...props} drafts={[draftPreviewRows[0]]} />)
  expect(view.getByText(draftPreviewRows[0].title)).toBeTruthy()
  await view.rerender(<WorkspaceDrafts {...props} drafts={[{ ...draftPreviewRows[0], text: ' \n', title: '' }]} />)
  expect(view.queryByTestId('workspace-drafts')).toBeNull()
  expect(view.queryByText(/Untitled/i)).toBeNull()
})
