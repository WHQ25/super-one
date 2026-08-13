/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { AddProjectDialog } from './AddProjectDialog'
import { setAddProjectHookDelayForTests } from './use-add-project-dialog'

const browsePath = vi.fn()
const openProject = vi.fn()
const cloneRepository = vi.fn()
const searchGithubRepos = vi.fn()
const queryGithubRepos = vi.fn()
const listMyGithubRepos = vi.fn()
const getAppSettings = vi.fn()
const saveAppSettings = vi.fn()
const selectFolder = vi.fn()

function renderDialog(connectionId = 'local') {
  const onOpened = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <AddProjectDialog
      open
      onOpenChange={onOpenChange}
      connectionId={connectionId}
      hostLabel="This Mac"
      onOpened={onOpened}
    />,
  )
  return { onOpened, onOpenChange }
}

const input = () => screen.getByRole('textbox') as HTMLInputElement
/**
 * Row text read off the DOM: fuzzy highlighting splits a label into several
 * spans, which strips the spaces out of the computed accessible name.
 */
const rowTexts = () => screen.getAllByRole('button').map((b) => b.textContent ?? '')
const highlightedText = (row: HTMLElement) =>
  [...row.querySelectorAll('.text-highlighted')].map((el) => el.textContent ?? '').join('')

describe('add-project dialog', () => {
  beforeEach(() => {
    setAddProjectHookDelayForTests(0)
    browsePath.mockResolvedValue({
      path: '/Users/dev/Projects',
      entries: [
        { name: 'super-one', path: '/Users/dev/Projects/super-one', type: 'directory' },
        { name: 'notes', path: '/Users/dev/Projects/notes', type: 'directory' },
      ],
    })
    openProject.mockResolvedValue({ projectId: 'p1', path: '/Users/dev/Projects/notes', name: 'notes' })
    cloneRepository.mockResolvedValue({
      projectId: 'p2',
      path: '/Users/dev/Projects/super-one',
      name: 'super-one',
    })
    queryGithubRepos.mockResolvedValue([])
    searchGithubRepos.mockResolvedValue([
      {
        owner: 'WHQ25',
        name: 'super-one',
        fullName: 'WHQ25/super-one',
        description: 'Meta desktop app',
        private: false,
        stars: 1200,
      },
      {
        owner: 'WHQ25',
        name: 'notes',
        fullName: 'WHQ25/notes',
        description: null,
        private: true,
        stars: 3,
      },
    ])
    listMyGithubRepos.mockResolvedValue({
      repos: [
        {
          owner: 'me',
          name: 'alpha',
          fullName: 'me/alpha',
          description: 'First',
          private: false,
          stars: 42,
        },
        {
          owner: 'me',
          name: 'beta',
          fullName: 'me/beta',
          description: null,
          private: true,
          stars: 0,
        },
      ],
      hasMore: false,
      unavailable: false,
    })
    getAppSettings.mockResolvedValue({ defaultClonePaths: {} })
    saveAppSettings.mockImplementation(async (patch: { defaultClonePaths?: Record<string, string> }) => ({
      defaultClonePaths: patch.defaultClonePaths ?? {},
    }))
    selectFolder.mockResolvedValue(null)
    ;(window as unknown as Record<string, unknown>).environment = {
      browsePath,
      openProject,
      cloneRepository,
    }
    ;(window as unknown as Record<string, unknown>).app = {
      ...((window as unknown as Record<string, unknown>).app as object),
      searchGithubRepos,
      queryGithubRepos,
      listMyGithubRepos,
      selectFolder,
      getAppSettings,
      saveAppSettings,
    }
  })

  afterEach(() => {
    setAddProjectHookDelayForTests(null)
    cleanup()
    vi.clearAllMocks()
  })

  it('opens on the source picker with local, GitHub and Git URL', () => {
    renderDialog()
    expect(screen.getByText('Local Folder')).toBeInTheDocument()
    expect(screen.getByText('GitHub Repository')).toBeInTheDocument()
    expect(screen.getByText('Git URL')).toBeInTheDocument()
  })

  it('adds an existing folder picked from the local browser', async () => {
    const { onOpened } = renderDialog()

    fireEvent.click(screen.getByText('Local Folder'))
    await waitFor(() => expect(browsePath).toHaveBeenCalledWith('local', '~/'))
    await screen.findByText('notes')

    // Clicking a directory completes the path rather than submitting, and keeps
    // the `~/` the user typed instead of expanding it.
    fireEvent.click(screen.getByText('notes'))
    expect(input().value).toBe('~/notes/')

    // "." / "Add this folder" is the default selection once listing settles —
    // Enter commits the current path instead of drilling into a child.
    await screen.findByRole('button', { name: /Add This Folder/ })
    fireEvent.keyDown(input(), { key: 'Enter' })

    await waitFor(() =>
      expect(openProject).toHaveBeenCalledWith('local', '/Users/dev/Projects', {
        createIfMissing: false,
      }),
    )
    await waitFor(() => expect(onOpened).toHaveBeenCalled())
  })

  it('native Browse opens at the listed path and adds the selection immediately', async () => {
    const { onOpened } = renderDialog()
    selectFolder.mockResolvedValueOnce('/Users/dev/Projects/notes')

    fireEvent.click(screen.getByText('Local Folder'))
    await waitFor(() => expect(browsePath).toHaveBeenCalledWith('local', '~/'))
    await screen.findByText('notes')

    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    await waitFor(() =>
      expect(selectFolder).toHaveBeenCalledWith('/Users/dev/Projects'),
    )
    await waitFor(() =>
      expect(openProject).toHaveBeenCalledWith('local', '/Users/dev/Projects/notes', {
        createIfMissing: false,
      }),
    )
    await waitFor(() => expect(onOpened).toHaveBeenCalled())
    // Picker commit skips a second confirm — dialog closes via onOpenChange(false).
  })

  it('keeps typed and absolute prefixes as they are while navigating', async () => {
    renderDialog()
    fireEvent.click(screen.getByText('Local Folder'))
    await screen.findByText('notes')

    // Tab completion into the highlighted row keeps the `~/` prefix.
    fireEvent.change(input(), { target: { value: '~/Dev/no' } })
    await waitFor(() => expect(browsePath).toHaveBeenCalledWith('local', '~/Dev/'))
    await screen.findByRole('button', { name: /notes/ })
    // Inline ghost shows the untyped remainder before Tab (prefix mode).
    expect(document.body.textContent).toMatch(/tes/)
    fireEvent.keyDown(input(), { key: 'Tab' })
    expect(input().value).toBe('~/Dev/notes/')

    // Going up stays relative too, as long as a segment can be dropped.
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    await screen.findByText('..')
    fireEvent.click(screen.getByText('..'))
    expect(input().value).toBe('~/Dev/')

    // An absolute path the user typed keeps its absolute form.
    fireEvent.change(input(), { target: { value: '/srv/apps/' } })
    await waitFor(() => expect(browsePath).toHaveBeenCalledWith('local', '/srv/apps/'))
    fireEvent.click(screen.getByText('notes'))
    expect(input().value).toBe('/srv/apps/notes/')
  })

  it('falls back to the absolute parent when the typed prefix has no segment left', async () => {
    renderDialog()
    fireEvent.click(screen.getByText('Local Folder'))
    await screen.findByText('..')

    // `~/` cannot express its own parent, so the listed absolute path takes over.
    fireEvent.click(screen.getByText('..'))
    expect(input().value).toBe('/Users/dev/')
  })

  it('offers to create a folder that does not exist yet', async () => {
    renderDialog()
    fireEvent.click(screen.getByText('Local Folder'))
    await screen.findByText('notes')

    fireEvent.change(input(), { target: { value: '~/Projects/brand-new' } })
    // Missing path appears as its own "Create" list group, not a free-text banner.
    await waitFor(() => expect(screen.getByText('Create')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Create Directory/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Create Directory/ }))
    await waitFor(() =>
      expect(openProject).toHaveBeenCalledWith('local', '/Users/dev/Projects/brand-new', {
        createIfMissing: true,
      }),
    )
  })

  it('clones a GitHub repo into the chosen directory', async () => {
    const { onOpened } = renderDialog()

    fireEvent.click(screen.getByText('GitHub Repository'))
    fireEvent.change(input(), { target: { value: 'WHQ25/super-one' } })
    await waitFor(() => expect(searchGithubRepos).toHaveBeenCalledWith('WHQ25'))
    await screen.findByRole('button', { name: /WHQ25\/super-one/ })

    fireEvent.keyDown(input(), { key: 'Enter' })

    // Destination step keeps the repository visible while a path is chosen.
    await screen.findByText('Repository')
    expect(screen.getByText('https://github.com/WHQ25/super-one.git')).toBeInTheDocument()
    await waitFor(() => expect(browsePath).toHaveBeenCalledWith('local', '~/'))
    await screen.findByText(/Clones into/)

    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() =>
      expect(cloneRepository).toHaveBeenCalledWith('local', {
        remoteUrl: 'https://github.com/WHQ25/super-one.git',
        parentPath: '/Users/dev/Projects',
        directoryName: 'super-one',
      }),
    )
    await waitFor(() => expect(onOpened).toHaveBeenCalled())
  })

  it('does not auto-route GitHub or Git URL from free typing on the source step', async () => {
    renderDialog()

    fireEvent.change(input(), { target: { value: 'WHQ25/super-one' } })
    // Still on the source picker — only paths auto-advance.
    expect(screen.getByText('Local Folder')).toBeInTheDocument()
    expect(screen.getByText('GitHub Repository')).toBeInTheDocument()
    expect(searchGithubRepos).not.toHaveBeenCalled()

    fireEvent.change(input(), { target: { value: 'https://gitlab.com/group/project.git' } })
    expect(screen.getByText('Local Folder')).toBeInTheDocument()
    expect(browsePath).not.toHaveBeenCalled()
  })

  it('auto-routes a typed path to the local browser and lists it right away', async () => {
    renderDialog()

    fireEvent.change(input(), { target: { value: '~/Projects/no' } })

    await waitFor(() => expect(browsePath).toHaveBeenCalledWith('local', '~/Projects/'))
    expect(input().value).toBe('~/Projects/no')
    // The half-typed leaf filters the listing (row text is split by highlights).
    await screen.findByRole('button', { name: /notes/ })
    expect(screen.queryByRole('button', { name: /super-one/ })).not.toBeInTheDocument()
    // Source rows are gone — the path itself selected Local Folder.
    expect(screen.queryByText('Local Folder')).not.toBeInTheDocument()
  })

  it('auto-completes a typed ~ to ~/ and lists home', async () => {
    browsePath.mockResolvedValue({
      path: '/Users/dev',
      entries: [
        { name: 'Projects', path: '/Users/dev/Projects', type: 'directory' },
        { name: 'Desktop', path: '/Users/dev/Desktop', type: 'directory' },
      ],
    })
    renderDialog()

    fireEvent.change(input(), { target: { value: '~' } })

    // Input expands so the user can keep typing a path without the slash.
    expect(input().value).toBe('~/')
    await waitFor(() => expect(browsePath).toHaveBeenCalledWith('local', '~/'))
    await screen.findByText('Projects')
    expect(screen.getByText('Desktop')).toBeInTheDocument()
  })

  it('lists the authenticated user repos when opening GitHub (via gh)', async () => {
    renderDialog()
    fireEvent.click(screen.getByText('GitHub Repository'))

    await waitFor(() => expect(listMyGithubRepos).toHaveBeenCalledWith(1, 20))
    await screen.findByText('Your Repositories')
    expect(screen.getByRole('button', { name: /me\/alpha/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /me\/beta/ })).toBeInTheDocument()

    // Name filter stays on "my repos" path — does not call owner search.
    fireEvent.change(input(), { target: { value: 'alp' } })
    await screen.findByRole('button', { name: /me\/alpha/ })
    expect(screen.queryByRole('button', { name: /me\/beta/ })).not.toBeInTheDocument()
    expect(searchGithubRepos).not.toHaveBeenCalled()
    await waitFor(() => expect(queryGithubRepos).toHaveBeenCalledWith('alp'), {
      timeout: 2000,
    })
  })

  it('shows GitHub name-search hits under a second section', async () => {
    queryGithubRepos.mockResolvedValue([
      {
        owner: 'me',
        name: 'alpha',
        fullName: 'me/alpha',
        description: 'First',
        private: false,
        stars: 42,
      },
      {
        owner: 'acme',
        name: 'alpha',
        fullName: 'acme/alpha',
        description: 'Public alpha',
        private: false,
        stars: 8800,
      },
    ])
    renderDialog()
    fireEvent.click(screen.getByText('GitHub Repository'))
    await screen.findByText('Your Repositories')

    fireEvent.change(input(), { target: { value: 'alp' } })
    await screen.findByText(/Searching/)
    await waitFor(() => expect(queryGithubRepos).toHaveBeenCalledWith('alp'), {
      timeout: 2000,
    })
    await screen.findByText('Search Results')
    expect(screen.queryByText(/Searching/)).not.toBeInTheDocument()
    // Own repo stays in "Your Repositories"; search drops the duplicate.
    expect(screen.getByRole('button', { name: /^me\/alpha/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^acme\/alpha/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /alpha/ })).toHaveLength(2)
    expect(searchGithubRepos).not.toHaveBeenCalled()
  })

  it('does not name-search when the query is owner/ or a URL', async () => {
    renderDialog()
    fireEvent.click(screen.getByText('GitHub Repository'))
    await waitFor(() => expect(listMyGithubRepos).toHaveBeenCalled())

    fireEvent.change(input(), { target: { value: 'WHQ25/' } })
    await waitFor(() => expect(searchGithubRepos).toHaveBeenCalledWith('WHQ25'))
    expect(queryGithubRepos).not.toHaveBeenCalled()

    fireEvent.change(input(), { target: { value: 'https://github.com/WHQ25/super-one' } })
    await screen.findByText('WHQ25/super-one')
    expect(queryGithubRepos).not.toHaveBeenCalled()
  })

  it('searches GitHub repos after owner/ and shows the owner avatar', async () => {
    renderDialog()

    fireEvent.click(screen.getByText('GitHub Repository'))
    await waitFor(() => expect(listMyGithubRepos).toHaveBeenCalled())
    fireEvent.change(input(), { target: { value: 'WHQ25/' } })

    await waitFor(() => expect(searchGithubRepos).toHaveBeenCalledWith('WHQ25'))
    await screen.findByRole('button', { name: /WHQ25\/super-one/ })
    expect(screen.getByRole('button', { name: /WHQ25\/notes/ })).toBeInTheDocument()
    expect(screen.getByText('Meta desktop app')).toBeInTheDocument()
    expect(screen.getByText('1.2k')).toBeInTheDocument()
    // Larger owner avatar on each hit (32px slot, 80px source).
    const avatars = document.querySelectorAll('img[src="https://github.com/WHQ25.png?size=80"]')
    expect(avatars.length).toBeGreaterThanOrEqual(1)

    fireEvent.change(input(), { target: { value: 'WHQ25/super' } })
    await screen.findByRole('button', { name: /WHQ25\/super-one/ })
    expect(screen.queryByRole('button', { name: /WHQ25\/notes/ })).not.toBeInTheDocument()

    fireEvent.keyDown(input(), { key: 'Enter' })
    await screen.findByText('Repository')
    await waitFor(() => expect(browsePath).toHaveBeenCalledWith('local', '~/'))
  })

  it('highlights the owner and repo prefix on owner/ search hits', async () => {
    renderDialog()
    fireEvent.click(screen.getByText('GitHub Repository'))
    await waitFor(() => expect(listMyGithubRepos).toHaveBeenCalled())

    fireEvent.change(input(), { target: { value: 'WHQ25/' } })
    const ownerOnly = await screen.findByRole('button', { name: /WHQ25\/super-one/ })
    expect(highlightedText(ownerOnly)).toBe('WHQ25')

    fireEvent.change(input(), { target: { value: 'WHQ25/super' } })
    const ownerAndPrefix = await screen.findByRole('button', { name: /WHQ25\/super-one/ })
    expect(highlightedText(ownerAndPrefix)).toBe('WHQ25/super')
  })

  it('still searches the source labels when the text is not a path or repo', () => {
    renderDialog()

    fireEvent.change(input(), { target: { value: 'github' } })
    expect(rowTexts().some((text) => text.includes('GitHub Repository'))).toBe(true)
    expect(rowTexts().some((text) => text.includes('Local Folder'))).toBe(false)

    // Picking a source by search starts from a clean input.
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(input().value).toBe('')
  })

  it('ignores Enter while an IME composition is in progress', () => {
    renderDialog()

    fireEvent.change(input(), { target: { value: 'github' } })
    // Drive the compositionstart handler (imeComposingRef) — more reliable in jsdom
    // than synthesizing isComposing on the keyboard event.
    fireEvent.compositionStart(input())
    fireEvent.keyDown(input(), { key: 'Enter' })

    // Still filtering sources (not advanced into the GitHub repo step).
    expect(rowTexts().some((text) => text.includes('GitHub Repository'))).toBe(true)
    expect(input().value).toBe('github')
    // Repo step placeholder would replace the source search placeholder.
    expect(input().placeholder).toMatch(/path|source/i)
  })

  it('ignores Enter while keyCode is 229 (legacy IME marker)', () => {
    renderDialog()

    fireEvent.change(input(), { target: { value: 'github' } })
    fireEvent.keyDown(input(), { key: 'Enter', keyCode: 229 })

    expect(rowTexts().some((text) => text.includes('GitHub Repository'))).toBe(true)
    expect(input().value).toBe('github')
  })

  it('ignores the Enter that ends an IME composition session', () => {
    renderDialog()

    fireEvent.change(input(), { target: { value: 'github' } })
    // Chromium often clears isComposing before the commit Enter; composition
    // events are the reliable signal.
    fireEvent.compositionStart(input())
    fireEvent.keyDown(input(), { key: 'Enter' })
    fireEvent.compositionEnd(input())
    // Same-tick Enter after compositionEnd must still be ignored.
    fireEvent.keyDown(input(), { key: 'Enter' })

    expect(rowTexts().some((text) => text.includes('GitHub Repository'))).toBe(true)
    expect(input().value).toBe('github')
  })

  it('hides the create-directory candidate when the path already exists', async () => {
    renderDialog()
    fireEvent.click(screen.getByText('Local Folder'))
    await screen.findByText('notes')

    fireEvent.change(input(), { target: { value: '~/Projects/notes' } })
    // Exact existing leaf: listing settles with a notes hit, never a create row.
    await waitFor(() => expect(screen.getByRole('button', { name: /^notes/i })).toBeInTheDocument())
    expect(screen.queryByText('Create')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Create Directory/ })).not.toBeInTheDocument()
  })

  it('does not advance on Enter until the repository input parses', () => {
    renderDialog()
    fireEvent.click(screen.getByText('GitHub Repository'))

    fireEvent.change(input(), { target: { value: 'WHQ25' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    // Half-typed owner is not enough to leave the repo step.
    expect(screen.queryByText('Repository')).not.toBeInTheDocument()

    fireEvent.change(input(), { target: { value: 'WHQ25/super-one' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
  })

  it('accepts a pasted GitHub URL without requiring a search hit', async () => {
    const { onOpened } = renderDialog()

    fireEvent.click(screen.getByText('GitHub Repository'))
    fireEvent.change(input(), {
      target: { value: 'https://github.com/WHQ25/super-one' },
    })

    // Resolved preview uses owner/repo (same as a search hit), not raw URL title.
    await screen.findByText('WHQ25/super-one')
    expect(screen.getByText('https://github.com/WHQ25/super-one.git')).toBeInTheDocument()
    expect(searchGithubRepos).not.toHaveBeenCalled()

    fireEvent.keyDown(input(), { key: 'Enter' })
    await screen.findByText('Repository')
    // Destination title is also owner/repo after URL paste.
    expect(screen.getByText('WHQ25/super-one')).toBeInTheDocument()
    await waitFor(() => expect(browsePath).toHaveBeenCalledWith('local', '~/'))

    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() =>
      expect(cloneRepository).toHaveBeenCalledWith('local', {
        remoteUrl: 'https://github.com/WHQ25/super-one.git',
        parentPath: '/Users/dev/Projects',
        directoryName: 'super-one',
      }),
    )
    await waitFor(() => expect(onOpened).toHaveBeenCalled())
  })

  it('prefills the destination with the saved default clone path', async () => {
    getAppSettings.mockResolvedValue({
      defaultClonePaths: { local: '~/Github/' },
    })
    browsePath.mockResolvedValue({
      path: '/Users/dev/Github',
      entries: [{ name: 'other', path: '/Users/dev/Github/other', type: 'directory' }],
    })
    renderDialog()

    // Wait for the settings promise so continueWithRepo sees the saved path.
    await act(async () => {
      await getAppSettings.mock.results[0]!.value
    })

    fireEvent.click(screen.getByText('GitHub Repository'))
    fireEvent.change(input(), { target: { value: 'WHQ25/super-one' } })
    await screen.findByRole('button', { name: /WHQ25\/super-one/ })
    fireEvent.keyDown(input(), { key: 'Enter' })

    await screen.findByText('Repository')
    expect(input().value).toBe('~/Github/')
    // Checkbox is pre-checked when a default was applied.
    expect(screen.getByText('Save as Default Clone Path')).toBeInTheDocument()
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toHaveAttribute('data-state', 'checked')
    await waitFor(() => expect(browsePath).toHaveBeenCalledWith('local', '~/Github/'))
  })

  it('saves the current destination as default when the checkbox is checked', async () => {
    const { onOpened } = renderDialog()

    fireEvent.click(screen.getByText('GitHub Repository'))
    fireEvent.change(input(), { target: { value: 'WHQ25/super-one' } })
    await screen.findByRole('button', { name: /WHQ25\/super-one/ })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await screen.findByText('Repository')
    await waitFor(() => expect(browsePath).toHaveBeenCalled())

    fireEvent.change(input(), { target: { value: '~/Projects/' } })
    await waitFor(() => expect(browsePath).toHaveBeenCalledWith('local', '~/Projects/'))

    // Opt in to remember this parent.
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('checkbox')).toHaveAttribute('data-state', 'checked')

    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(cloneRepository).toHaveBeenCalled())
    await waitFor(() =>
      expect(saveAppSettings).toHaveBeenCalledWith({
        defaultClonePaths: { local: '~/Projects/' },
      }),
    )
    await waitFor(() => expect(onOpened).toHaveBeenCalled())
  })

  it('goes back to the source picker on Backspace with an empty input', () => {
    renderDialog()
    fireEvent.click(screen.getByText('GitHub Repository'))
    expect(screen.queryByText('Local Folder')).not.toBeInTheDocument()

    fireEvent.keyDown(input(), { key: 'Backspace' })
    expect(screen.getByText('Local Folder')).toBeInTheDocument()
  })

  it('hides the back control on local browse and returns home when the path is cleared', async () => {
    renderDialog()
    fireEvent.click(screen.getByText('Local Folder'))
    await waitFor(() => expect(browsePath).toHaveBeenCalled())
    // Path is prefilled with ~/ — footer has no ⌫ back hint on browse.
    expect(screen.queryByText('back')).not.toBeInTheDocument()

    fireEvent.change(input(), { target: { value: '' } })
    await waitFor(() => expect(screen.getByText('Local Folder')).toBeInTheDocument())
    expect(screen.getByText('GitHub Repository')).toBeInTheDocument()
  })

  it('surfaces a clone failure without closing the dialog', async () => {
    cloneRepository.mockRejectedValueOnce(new Error('repository not found'))
    const { onOpenChange } = renderDialog()

    fireEvent.click(screen.getByText('Git URL'))
    fireEvent.change(input(), { target: { value: 'https://example.com/x/y.git' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await screen.findByText('Repository')
    await waitFor(() => expect(browsePath).toHaveBeenCalled())

    fireEvent.keyDown(input(), { key: 'Enter' })
    await screen.findByText('repository not found')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('shows a friendly message when the clone destination already exists', async () => {
    cloneRepository.mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'environment:cloneRepository': Error: destination already exists: /Users/dev/Github/super-one",
      ),
    )
    renderDialog()

    fireEvent.click(screen.getByText('Git URL'))
    fireEvent.change(input(), { target: { value: 'https://example.com/x/super-one.git' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await screen.findByText('Repository')
    await waitFor(() => expect(browsePath).toHaveBeenCalled())

    fireEvent.keyDown(input(), { key: 'Enter' })
    await screen.findByText(
      '"/Users/dev/Github/super-one" already exists. Pick another folder, or add that project instead of cloning.',
    )
  })
})
