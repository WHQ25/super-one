import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { ADD_PROJECT_TEXT, githubRows } from '../add-project-state'
import type { AddProjectFlow } from '../navigation/use-add-project'
import { AddProjectScreen } from './add-project-screen'

/**
 * Add Project browses through the shared `BrowsePage`, the same component the
 * additional-folders page uses. These cover the wiring into it — the clone
 * preview is the one thing that stayed here.
 */
const DESTINATION = {
  kind: 'destination', source: 'github', repoInput: 'anthropics/claude-code',
  remoteUrl: 'https://github.com/anthropics/claude-code.git', repoName: 'claude-code',
} as const

function flow(overrides: Partial<AddProjectFlow> = {}): AddProjectFlow {
  return {
    step: { kind: 'browse' },
    title: 'Add Project',
    placeholder: 'Type a path',
    query: '~/Developer/',
    setQuery: () => {},
    sections: [{
      key: 'directories',
      label: 'Directories',
      rows: [{ key: 'super-one', icon: 'directory', label: 'super-one' }],
    }],
    emptyMessage: null,
    loading: false,
    busy: false,
    error: '',
    clonePreview: null,
    shallowClone: false,
    setShallowClone: () => {},
    saveAsDefault: false,
    setSaveAsDefault: () => {},
    confirmLabel: 'Add',
    confirm: () => {},
    activate: () => {},
    canGoBack: true,
    goBack: () => {},
    ...overrides,
  }
}

test('the field carries the path and the list follows it', async () => {
  await renderWithTheme(<AddProjectScreen flow={flow()} />)

  expect(screen.getByDisplayValue('~/Developer/')).toBeTruthy()
  expect(screen.getByLabelText('super-one')).toBeTruthy()
})

test('tapping a row reaches the flow rather than the shared component', async () => {
  const activate = jest.fn()
  await renderWithTheme(<AddProjectScreen flow={flow({ activate })} />)

  fireEvent.press(screen.getByLabelText('super-one'))
  expect(activate).toHaveBeenCalledWith(expect.objectContaining({ key: 'super-one' }))
})

test('an empty listing states why instead of showing a bare list', async () => {
  await renderWithTheme(<AddProjectScreen flow={flow({ emptyMessage: 'No directories' })} />)

  expect(screen.getByText('No directories')).toBeTruthy()
  expect(screen.queryByLabelText('super-one')).toBeNull()
})

test('the destination step keeps its clone preview, which is not shared', async () => {
  await renderWithTheme(<AddProjectScreen flow={flow({
    step: DESTINATION,
    clonePreview: { repoLabel: 'anthropics/claude-code', remoteUrl: 'https://github.com/anthropics/claude-code.git', path: '~/Developer/claude-code' },
  })} />)

  expect(screen.getByText('anthropics/claude-code')).toBeTruthy()
  expect(screen.getByText('https://github.com/anthropics/claude-code.git')).toBeTruthy()
  expect(screen.getByText('A')).toBeTruthy()
})

function repositoryFlow(owner = 'expo') {
  return flow({
    step: { kind: 'repo', source: 'github' },
    sections: [{ key: 'repos', label: 'Repositories', rows: githubRows([{
      owner, name: 'sdk', fullName: `${owner}/sdk`, description: null, private: false, stars: 10,
    }], { ownerPrefix: null, query: '' }) }],
  })
}

test('a repository shows the owner initial until its avatar finishes loading', async () => {
  await renderWithTheme(<AddProjectScreen flow={repositoryFlow()} />)
  expect(screen.getByText('E')).toBeTruthy()
  await act(async () => { fireEvent(screen.getByTestId('repo-owner-avatar-image'), 'load') })
  expect(screen.queryByText('E')).toBeNull()
})

test('a failed avatar keeps the owner initial visible', async () => {
  await renderWithTheme(<AddProjectScreen flow={repositoryFlow()} />)
  await act(async () => { fireEvent(screen.getByTestId('repo-owner-avatar-image'), 'error', { nativeEvent: { error: 'Offline' } }) })
  expect(screen.getByText('E')).toBeTruthy()
})

test('changing the clone destination owner restores the new initial while its avatar loads', async () => {
  const previewFlow = (owner: string) => flow({
    step: { ...DESTINATION, repoInput: `${owner}/sdk` },
    clonePreview: { repoLabel: `${owner}/sdk`, remoteUrl: `https://github.com/${owner}/sdk.git`, path: '~/sdk' },
  })
  const { rerender } = await renderWithTheme(<AddProjectScreen flow={previewFlow('expo')} />)
  await act(async () => { fireEvent(screen.getByTestId('repo-owner-avatar-image'), 'load') })
  await rerender(<AddProjectScreen flow={previewFlow('anthropics')} />)
  expect(screen.getByText('A')).toBeTruthy()
  expect(screen.queryByText('E')).toBeNull()
})

test('a clone in flight says so rather than only disabling the header', async () => {
  await renderWithTheme(<AddProjectScreen flow={flow({
    step: DESTINATION, busy: true,
  })} />)

  expect(screen.getByText(ADD_PROJECT_TEXT.cloning)).toBeTruthy()
})

test('a failure is reported on the page, where the attempt was made', async () => {
  await renderWithTheme(<AddProjectScreen flow={flow({ error: 'Permission denied' })} />)

  expect(screen.getByText('Permission denied')).toBeTruthy()
})
