import { expect, jest, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { ADD_PROJECT_TEXT } from '../add-project-state'
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
