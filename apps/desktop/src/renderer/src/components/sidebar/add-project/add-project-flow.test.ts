import { describe, it, expect } from 'vitest'
import {
  autoAdvanceFromSourceQuery,
  detectAddProjectSource,
  describeDetectedSource,
  formatAddProjectError,
  GITHUB_REPO_NAME_SEARCH_IDLE_MS,
  filterGithubHitsByPrefix,
  githubRepoNameSearchDelay,
  longestPrefixCacheHits,
  resolveBrowsePath,
  resolveRepoInput,
  submitLabelKey,
  unwrapIpcInvokeError,
} from './add-project-flow'

describe('source detection while typing', () => {
  it('reads an absolute, home or relative path as a local folder', () => {
    expect(detectAddProjectSource('/Users/dev/Projects')).toBe('local')
    expect(detectAddProjectSource('~/Projects/super-one')).toBe('local')
    expect(detectAddProjectSource('../sibling')).toBe('local')
    expect(detectAddProjectSource('C:\\Users\\dev')).toBe('local')
  })

  it('only auto-detects local paths — GitHub and Git URL need a manual pick', () => {
    expect(detectAddProjectSource('WHQ25/super-one')).toBeNull()
    expect(detectAddProjectSource('https://github.com/WHQ25/super-one')).toBeNull()
    expect(detectAddProjectSource('https://gitlab.com/group/project.git')).toBeNull()
    expect(detectAddProjectSource('git@bitbucket.org:team/app.git')).toBeNull()
  })

  it('detects nothing while the input is still ambiguous or unsafe', () => {
    expect(detectAddProjectSource('')).toBeNull()
    expect(detectAddProjectSource('  ')).toBeNull()
    expect(detectAddProjectSource('local')).toBeNull()
    expect(detectAddProjectSource('WHQ25')).toBeNull()
    expect(detectAddProjectSource('ext::sh -c whoami')).toBeNull()
    expect(detectAddProjectSource('https://')).toBeNull()
  })

  it('previews what a manually picked remote resolves to', () => {
    expect(describeDetectedSource('github', 'WHQ25/super-one')).toBe(
      'https://github.com/WHQ25/super-one.git',
    )
    expect(describeDetectedSource('url', 'https://gitlab.com/group/project.git')).toBe('project')
    // A local path speaks for itself — the row keeps its normal hint.
    expect(describeDetectedSource('local', '~/Projects')).toBeNull()
  })

  it('auto-advances only for concrete local paths', () => {
    expect(autoAdvanceFromSourceQuery('~/Projects/no', '~/')).toEqual({
      step: { kind: 'browse' },
      query: '~/Projects/no',
    })
    // Repos never skip the source picker from free typing.
    expect(autoAdvanceFromSourceQuery('WHQ25/super-one', '~/')).toBeNull()
    expect(autoAdvanceFromSourceQuery('https://gitlab.com/group/project.git', '/')).toBeNull()
  })

  it('does not auto-advance while the text is still a source-label search', () => {
    expect(autoAdvanceFromSourceQuery('', '~/')).toBeNull()
    expect(autoAdvanceFromSourceQuery('github', '~/')).toBeNull()
    expect(autoAdvanceFromSourceQuery('WHQ25', '~/')).toBeNull()
  })
})

describe('repository input resolution', () => {
  it('turns GitHub shorthand into a clone URL and folder name', () => {
    expect(resolveRepoInput('github', 'WHQ25/super-one')).toEqual({
      remoteUrl: 'https://github.com/WHQ25/super-one.git',
      repoName: 'super-one',
    })
  })

  it('accepts a pasted GitHub URL in the GitHub step', () => {
    expect(resolveRepoInput('github', 'https://github.com/WHQ25/super-one')).toEqual({
      remoteUrl: 'https://github.com/WHQ25/super-one.git',
      repoName: 'super-one',
    })
    expect(resolveRepoInput('github', 'github.com/WHQ25/super-one')).toEqual({
      remoteUrl: 'https://github.com/WHQ25/super-one.git',
      repoName: 'super-one',
    })
    expect(resolveRepoInput('github', 'git@github.com:WHQ25/super-one.git')).toEqual({
      remoteUrl: 'https://github.com/WHQ25/super-one.git',
      repoName: 'super-one',
    })
  })

  it('keeps a raw URL untouched in the URL step', () => {
    expect(resolveRepoInput('url', 'git@gitlab.com:group/project.git')).toEqual({
      remoteUrl: 'git@gitlab.com:group/project.git',
      repoName: 'project',
    })
  })

  it('rejects a half-typed owner so the submit stays disabled', () => {
    expect(resolveRepoInput('github', 'WHQ25')).toBeNull()
  })

  it('rejects a transport-helper URL that would execute a command', () => {
    expect(resolveRepoInput('url', 'ext::sh -c whoami')).toBeNull()
  })
})

describe('typed path resolution against the directory listing', () => {
  const entries = [
    { name: 'super-one', path: '/Users/dev/Projects/super-one' },
    { name: 'notes', path: '/Users/dev/Projects/notes' },
  ]

  it('resolves a tilde path with a trailing slash to the absolute listed directory', () => {
    expect(
      resolveBrowsePath({ query: '~/Projects/', listedPath: '/Users/dev/Projects', entries }),
    ).toEqual({ path: '/Users/dev/Projects', exists: true })
  })

  it('resolves bare ~ as the listed home directory (not a leaf named "~")', () => {
    expect(
      resolveBrowsePath({ query: '~', listedPath: '/Users/dev', entries }),
    ).toEqual({ path: '/Users/dev', exists: true })
  })

  it('resolves a typed leaf that exists to that entry', () => {
    expect(
      resolveBrowsePath({ query: '~/Projects/super-one', listedPath: '/Users/dev/Projects', entries }),
    ).toEqual({ path: '/Users/dev/Projects/super-one', exists: true })
  })

  it('reports a not-yet-existing leaf as an absolute path to create', () => {
    expect(
      resolveBrowsePath({ query: '~/Projects/brand-new', listedPath: '/Users/dev/Projects', entries }),
    ).toEqual({ path: '/Users/dev/Projects/brand-new', exists: false })
  })

  it('falls back to the raw text when the parent listing failed', () => {
    expect(resolveBrowsePath({ query: '/srv/apps/', listedPath: '', entries: [] })).toEqual({
      path: '/srv/apps',
      exists: false,
    })
  })

  it('returns an empty path for blank input', () => {
    expect(resolveBrowsePath({ query: '   ', listedPath: '/Users/dev', entries })).toEqual({
      path: '',
      exists: false,
    })
  })
})

describe('primary action labelling', () => {
  it('keeps a short stable label on path steps (create is a separate hint)', () => {
    expect(submitLabelKey({ kind: 'browse' })).toBe('sidebar.addProject.actions.add')
    const step = {
      kind: 'destination',
      source: 'github',
      repoInput: 'a/b',
      remoteUrl: 'https://github.com/a/b.git',
      repoName: 'b',
    } as const
    expect(submitLabelKey(step)).toBe('sidebar.addProject.actions.clone')
  })
})

describe('clone error formatting', () => {
  const t = (key: string, options?: Record<string, string>) =>
    key === 'sidebar.addProject.destinationExists'
      ? `exists:${options?.path ?? ''}`
      : key

  it('strips the Electron invoke wrapper from error messages', () => {
    expect(
      unwrapIpcInvokeError(
        "Error invoking remote method 'environment:cloneRepository': Error: destination already exists: /tmp/repo",
      ),
    ).toBe('destination already exists: /tmp/repo')
  })

  it('maps a destination-exists failure to the localised message', () => {
    expect(
      formatAddProjectError(
        new Error(
          "Error invoking remote method 'environment:cloneRepository': Error: destination already exists: /Users/dev/Github/super-one",
        ),
        t,
      ),
    ).toBe('exists:/Users/dev/Github/super-one')
  })

  it('keeps unknown clone failures as the unwrapped backend text', () => {
    expect(
      formatAddProjectError(
        new Error(
          "Error invoking remote method 'environment:cloneRepository': Error: repository not found",
        ),
        t,
      ),
    ).toBe('repository not found')
  })
})

describe('GitHub name-search delay', () => {
  it('waits 500ms after typing stops when nothing has been sent yet', () => {
    expect(githubRepoNameSearchDelay(10_000, 0)).toBe(GITHUB_REPO_NAME_SEARCH_IDLE_MS)
  })

  it('stretches the wait so consecutive requests are at least 1s apart', () => {
    // Last send at t=1, deciding at t=200 → 801ms left of the 1s gap.
    expect(githubRepoNameSearchDelay(200, 1)).toBe(801)
    // Idle 500ms is already longer than the remaining gap.
    expect(githubRepoNameSearchDelay(900, 1)).toBe(GITHUB_REPO_NAME_SEARCH_IDLE_MS)
    expect(githubRepoNameSearchDelay(2_000, 1)).toBe(GITHUB_REPO_NAME_SEARCH_IDLE_MS)
  })

  it('reuses the longest cached prefix while a longer query is in flight', () => {
    const cache = new Map([
      [
        'sup',
        [
          { name: 'super-one', fullName: 'WHQ25/super-one' },
          { name: 'superpowers', fullName: 'obra/superpowers' },
          { name: 'supabase', fullName: 'supabase/supabase' },
        ],
      ],
    ])
    const prefix = longestPrefixCacheHits(cache, 'super')
    expect(prefix).toHaveLength(3)
    expect(filterGithubHitsByPrefix(prefix ?? [], 'super').map((h) => h.name)).toEqual([
      'super-one',
      'superpowers',
    ])
    expect(filterGithubHitsByPrefix(prefix ?? [], 'super-o').map((h) => h.name)).toEqual([
      'super-one',
    ])
    expect(longestPrefixCacheHits(cache, 'next')).toBeNull()
  })
})
