import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import type { GithubRepoHit, RemoteCommand } from '@superone/shared/agent-types'
import { ADD_PROJECT_TEXT } from '../add-project-state'
import { useAddProject } from '../navigation/use-add-project'
import { renderWithTheme } from '../test-render'
import { AddProjectScreen } from './add-project-screen'

const REPO: GithubRepoHit = {
  owner: 'expo', name: 'expo', fullName: 'expo/expo', description: 'Universal apps',
  private: false, stars: 100,
}

function setup() {
  const pending: Array<{ command: Extract<RemoteCommand, { type: 'search_github_repos' }>; resolve: (value: unknown) => void }> = []
  const request = (command: RemoteCommand): Promise<unknown> => {
    if (command.type !== 'search_github_repos') return Promise.resolve({ path: null })
    return new Promise((resolve) => pending.push({ command, resolve }))
  }
  function Page() {
    const flow = useAddProject({ request, onAdded: () => {} })
    return <AddProjectScreen flow={flow} />
  }
  return { Page, pending }
}

async function enterGithub() {
  await act(async () => { fireEvent.press(screen.getByLabelText('GitHub Repository')) })
}

async function typeQuery(value: string) {
  await act(async () => { fireEvent.changeText(screen.getByLabelText(ADD_PROJECT_TEXT.repoPlaceholderGithub), value) })
}

beforeEach(() => { jest.useFakeTimers() })
afterEach(() => { jest.useRealTimers() })

test('initial repository loading stays visible until the host returns an empty list', async () => {
  const { Page, pending } = setup()
  await renderWithTheme(<Page />)
  await enterGithub()
  expect(screen.getByText(ADD_PROJECT_TEXT.loading)).toBeTruthy()
  expect(screen.queryByText(ADD_PROJECT_TEXT.githubNoRepos)).toBeNull()
  await act(async () => { pending[0].resolve({ repos: [] }) })
  expect(screen.getByText(ADD_PROJECT_TEXT.githubNoRepos)).toBeTruthy()
})

test('name search shows searching throughout debounce and the request before showing no matches', async () => {
  const { Page, pending } = setup()
  await renderWithTheme(<Page />)
  await enterGithub()
  await act(async () => { pending[0].resolve({ repos: [] }) })
  await typeQuery('expo')
  expect(screen.getByText(/^Searching\.+$/)).toBeTruthy()
  expect(screen.queryByText(ADD_PROJECT_TEXT.githubNoRepos)).toBeNull()
  await act(async () => { jest.advanceTimersByTime(500) })
  expect(screen.getByText(/^Searching\.+$/)).toBeTruthy()
  expect(pending[1].command).toMatchObject({ mode: 'query', value: 'expo' })
  await act(async () => { pending[1].resolve({ repos: [] }) })
  expect(screen.queryByText(/^Searching\.+$/)).toBeNull()
  expect(screen.getByText(ADD_PROJECT_TEXT.githubNoRepos)).toBeTruthy()
})

test('owner search shows loading before its debounce expires and then displays the returned repository', async () => {
  const { Page, pending } = setup()
  await renderWithTheme(<Page />)
  await enterGithub()
  await act(async () => { pending[0].resolve({ repos: [] }) })
  await typeQuery('expo/')
  expect(screen.getByText(ADD_PROJECT_TEXT.loading)).toBeTruthy()
  expect(screen.queryByText(ADD_PROJECT_TEXT.githubNoRepos)).toBeNull()
  await act(async () => { jest.advanceTimersByTime(200) })
  expect(screen.getByText(ADD_PROJECT_TEXT.loading)).toBeTruthy()
  await act(async () => { pending[1].resolve({ repos: [REPO] }) })
  expect(screen.getByLabelText('expo/expo')).toBeTruthy()
  expect(screen.queryByText(ADD_PROJECT_TEXT.loading)).toBeNull()
})

test('an older name search cannot replace a cached query after the user switches back', async () => {
  const { Page, pending } = setup()
  await renderWithTheme(<Page />)
  await enterGithub()
  await act(async () => { pending[0].resolve({ repos: [] }) })
  await typeQuery('expo')
  await act(async () => { jest.advanceTimersByTime(500) })
  await act(async () => { pending[1].resolve({ repos: [REPO] }) })
  await typeQuery('react')
  await act(async () => { jest.advanceTimersByTime(1000) })
  await typeQuery('expo')
  expect(screen.getByLabelText('expo/expo')).toBeTruthy()
  await act(async () => { pending[2].resolve({ repos: [] }) })
  expect(screen.getByLabelText('expo/expo')).toBeTruthy()
  expect(screen.queryByText(ADD_PROJECT_TEXT.githubNoRepos)).toBeNull()
})

test('a previous owner response cannot finish loading or populate a different owner query', async () => {
  const { Page, pending } = setup()
  await renderWithTheme(<Page />)
  await enterGithub()
  await act(async () => { pending[0].resolve({ repos: [] }) })
  await typeQuery('expo/')
  await act(async () => { jest.advanceTimersByTime(200) })
  await typeQuery('vercel/')
  await act(async () => { pending[1].resolve({ repos: [REPO] }) })
  expect(screen.getByText(ADD_PROJECT_TEXT.loading)).toBeTruthy()
  expect(screen.queryByLabelText('expo/expo')).toBeNull()
  await act(async () => { jest.advanceTimersByTime(200) })
  await act(async () => { pending[2].resolve({ repos: [] }) })
  expect(screen.queryByText(ADD_PROJECT_TEXT.loading)).toBeNull()
  expect(screen.getByText(ADD_PROJECT_TEXT.githubNoRepos)).toBeTruthy()
})
