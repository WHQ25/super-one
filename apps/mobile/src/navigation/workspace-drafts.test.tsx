import { beforeEach, expect, jest, test } from '@jest/globals'
import { act, fireEvent } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { WorkspaceDrafts } from './workspace-drafts'
import { DraftsPreview, draftPreviewRows } from './workspace-drafts.stories'

let mockMotion = true
jest.mock('../ui/use-icon-motion', () => ({ useIconMotion: () => mockMotion }))
beforeEach(() => { mockMotion = true })

test('opens a shared draft and displays pending sync for an offline draft', async () => {
  const open = jest.fn()
  const view = await renderWithTheme(<WorkspaceDrafts drafts={draftPreviewRows} onOpenDraft={(draft) => { open(draft) }} onDeleteDraft={() => {}} />)
  expect(view.getAllByLabelText('Pending Sync').length).toBeGreaterThan(0)
  expect(view.getByText('Drafts')).toBeTruthy()
  expect(view.getByTestId('workspace-section-icon-drafts')).toBeTruthy()
  expect(view.queryByText(/gpt-5.4/)).toBeNull()
  await act(async () => {
    fireEvent.press(view.getByText(draftPreviewRows[0].title))
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(open).toHaveBeenCalledWith(draftPreviewRows[0])
})
test('hides the section when there are no drafts', async () => {
  const view = await renderWithTheme(<WorkspaceDrafts drafts={[]} onOpenDraft={() => {}} onDeleteDraft={() => {}} />)
  expect(view.queryByTestId('workspace-drafts')).toBeNull()
})

test('places the Drafts group above Projects', async () => {
  const view = await renderWithTheme(<DraftsPreview />)
  expect(view.getAllByText(/^(Drafts|Projects|Continue the mobile composer migration|SuperOne)$/).map((node) => node.props.children))
    .toEqual(['Drafts', draftPreviewRows[0].title, 'Projects', 'SuperOne'])
})

test('folds the rows behind a count and keeps them mounted', async () => {
  const view = await renderWithTheme(<WorkspaceDrafts drafts={draftPreviewRows} onOpenDraft={() => {}} onDeleteDraft={() => {}} />)
  expect(view.getByRole('button', { name: 'Drafts', expanded: true })).toBeTruthy()
  expect(view.queryByTestId('workspace-section-count-drafts')).toBeNull()
  await act(async () => { fireEvent.press(view.getByTestId('workspace-section-drafts')) })
  expect(view.getByRole('button', { name: 'Drafts, 2', expanded: false })).toBeTruthy()
  expect(view.getByTestId('workspace-section-count-drafts')).toBeTruthy()
  expect(view.getByTestId('workspace-drafts-panel', { includeHiddenElements: true }).props.accessibilityElementsHidden).toBe(true)
  expect(view.getByText(draftPreviewRows[0].title, { includeHiddenElements: true })).toBeTruthy()
  expect(view.getByTestId('workspace-section-icon-drafts')).toBeTruthy()
})

test('flies in a draft that arrives after the list is already showing', async () => {
  const props = { onOpenDraft: () => {}, onDeleteDraft: () => {} }
  const view = await renderWithTheme(<WorkspaceDrafts {...props} drafts={[draftPreviewRows[0]]} />)
  expect(view.getByTestId(`draft-slot-0-${draftPreviewRows[0].id}`)).toBeTruthy()
  expect(view.queryByTestId(/-enter$/)).toBeNull()
  await view.rerender(<WorkspaceDrafts {...props} drafts={draftPreviewRows} />)
  expect(view.getByTestId(`draft-slot-0-${draftPreviewRows[0].id}`)).toBeTruthy()
  expect(view.getByTestId(`draft-slot-1-${draftPreviewRows[1].id}-enter`)).toBeTruthy()
})

test('leaves a copy of the opened draft flying out and holds the rows below', async () => {
  const rows = [0, 1, 2, 3, 4].map((index) => ({
    ...draftPreviewRows[0],
    id: `d${index + 1}`,
    title: `draft ${index + 1}`,
  }))
  let release: () => void = () => {}
  const view = await renderWithTheme(
    <WorkspaceDrafts drafts={rows} onDeleteDraft={() => {}} onOpenDraft={() => new Promise<void>((resolve) => { release = resolve })} />,
  )
  await act(async () => { fireEvent.press(view.getByText('draft 3')) })
  expect(view.getByTestId('draft-fly-out')).toBeTruthy()
  expect(view.getByTestId('draft-slot-3-d4')).toBeTruthy()
  expect(view.getByTestId('draft-slot-4-d5')).toBeTruthy()
  expect(view.queryByTestId('draft-slot-2-d3')).toBeNull()
  const arrived = { ...draftPreviewRows[0], id: 'd-composer', title: 'composer' }
  await view.rerender(
    <WorkspaceDrafts drafts={[arrived, ...rows]} onDeleteDraft={() => {}} onOpenDraft={() => new Promise<void>((resolve) => { release = resolve })} />,
  )
  expect(view.getByTestId('draft-slot-3-d4')).toBeTruthy()
  expect(view.getByTestId('draft-slot-4-d5')).toBeTruthy()
  expect(view.getByTestId('draft-slot-0-d-composer-enter')).toBeTruthy()
  await act(async () => { release() })
})

test('never lists the draft being left together with the one just opened', async () => {
  const outgoing = { ...draftPreviewRows[0], id: 'draft-a', title: 'Outgoing note' }
  const clicked = { ...draftPreviewRows[1], id: 'draft-b', title: 'Clicked note' }
  const rows = [outgoing, clicked]
  let release: () => void = () => {}
  const onOpenDraft = () => new Promise<void>((resolve) => { release = resolve })
  const view = await renderWithTheme(
    <WorkspaceDrafts drafts={rows} activeDraftId={outgoing.id} onDeleteDraft={() => {}} onOpenDraft={onOpenDraft} />,
  )
  expect(view.queryByText('Outgoing note')).toBeNull()
  expect(view.getByTestId('draft-slot-0-draft-b')).toBeTruthy()
  await act(async () => { fireEvent.press(view.getByText('Clicked note')) })
  await view.rerender(
    <WorkspaceDrafts drafts={rows} activeDraftId={null} onDeleteDraft={() => {}} onOpenDraft={onOpenDraft} />,
  )
  expect(view.getByTestId('draft-slot-0-draft-a-enter')).toBeTruthy()
  expect(view.queryByTestId(/draft-slot-\d+-draft-b/)).toBeNull()
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(view.queryByTestId(/draft-slot-\d+-draft-b/)).toBeNull()
  await view.rerender(
    <WorkspaceDrafts drafts={rows} activeDraftId={clicked.id} onDeleteDraft={() => {}} onOpenDraft={onOpenDraft} />,
  )
  expect(view.getByText('Outgoing note')).toBeTruthy()
  expect(view.queryByTestId(/draft-slot-\d+-draft-b/)).toBeNull()
  await act(async () => {
    release()
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(view.queryByTestId(/draft-slot-\d+-draft-b/)).toBeNull()
})

test('puts the opened draft back when that open fails', async () => {
  let rejectOpen: (error: Error) => void = () => {}
  const view = await renderWithTheme(
    <WorkspaceDrafts
      drafts={draftPreviewRows}
      onDeleteDraft={() => {}}
      onOpenDraft={() => new Promise<void>((_resolve, reject) => { rejectOpen = reject })}
    />,
  )
  await act(async () => { fireEvent.press(view.getByText(draftPreviewRows[0].title)) })
  expect(view.queryByTestId(`draft-slot-0-${draftPreviewRows[0].id}`)).toBeNull()
  await act(async () => {
    rejectOpen(new Error('open failed'))
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(view.getByTestId(`draft-slot-0-${draftPreviewRows[0].id}`)).toBeTruthy()
})

test('does not fly a copy out when motion is reduced', async () => {
  mockMotion = false
  const open = jest.fn()
  const view = await renderWithTheme(<WorkspaceDrafts drafts={draftPreviewRows} onOpenDraft={(draft) => { open(draft) }} onDeleteDraft={() => {}} />)
  await act(async () => {
    fireEvent.press(view.getByText(draftPreviewRows[0].title))
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(open).toHaveBeenCalledWith(draftPreviewRows[0])
  expect(view.queryByTestId('draft-fly-out')).toBeNull()
  mockMotion = true
})

test('hides the draft open in the composer until that session is left', async () => {
  const view = await renderWithTheme(<WorkspaceDrafts drafts={draftPreviewRows} activeDraftId={draftPreviewRows[0].id} onOpenDraft={() => {}} onDeleteDraft={() => {}} />)
  expect(view.queryByText(draftPreviewRows[0].title)).toBeNull()
  expect(view.getByText(draftPreviewRows[1].title)).toBeTruthy()
  await view.rerender(<WorkspaceDrafts drafts={draftPreviewRows} activeDraftId={null} onOpenDraft={() => {}} onDeleteDraft={() => {}} />)
  expect(view.getByText(draftPreviewRows[0].title)).toBeTruthy()
})

test('removes a cleared draft row instead of rendering Untitled Draft', async () => {
  const props = { onOpenDraft: () => {}, onDeleteDraft: () => {} }
  const view = await renderWithTheme(<WorkspaceDrafts {...props} drafts={[draftPreviewRows[0]]} />)
  expect(view.getByText(draftPreviewRows[0].title)).toBeTruthy()
  await view.rerender(<WorkspaceDrafts {...props} drafts={[{ ...draftPreviewRows[0], text: ' \n', title: '' }]} />)
  expect(view.queryByTestId('workspace-drafts')).toBeNull()
  expect(view.queryByText(/Untitled/i)).toBeNull()
})
