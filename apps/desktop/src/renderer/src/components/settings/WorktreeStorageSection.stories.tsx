import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import type { StorageWorktree } from '@superone/shared/desktop-storage'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { WorktreeStorageSection } from './WorktreeStorageSection'

const GB = 1024 ** 3
const MB = 1024 ** 2
const ROOT = '/Users/dev/.worktrees'

export const worktreeStorageFixture: StorageWorktree[] = [
  { path: `${ROOT}/super-one/tol47y-04d7c7b`, repo: 'super-one', branch: 'feat/worktree-optimization', bytes: 6 * GB + 100 * MB, inUse: true, dirty: true },
  { path: `${ROOT}/super-one/tnz1ab-51ff76b`, repo: 'super-one', branch: null, bytes: 112 * MB, inUse: true, dirty: false },
  { path: `${ROOT}/super-one/tkq90c-d2d432a`, repo: 'super-one', branch: 'fix/steer-split', bytes: 5 * GB + 870 * MB, inUse: false, dirty: false },
  { path: `${ROOT}/super-one/tjx44d-13eddcf`, repo: 'super-one', branch: null, bytes: 112 * MB, inUse: false, dirty: false },
  { path: `${ROOT}/docs-site/tia12e-9c0ffee`, repo: 'docs-site', branch: 'draft/pricing-page', bytes: 340 * MB, inUse: false, dirty: true },
]

type SeedOptions = { mode?: 'ready' | 'loading' | 'error'; delay?: number; failing?: string[] }

let worktrees = worktreeStorageFixture
let mode: SeedOptions['mode'] = 'ready'
let delay = 0
let failing: string[] = []
let reads = 0

mockIpc('app', 'getStorageWorktrees', async () => {
  reads += 1
  if (mode === 'loading') await new Promise(() => {})
  if (mode === 'error' && reads === 1) throw new Error('EACCES')
  return worktrees
})
mockIpc('app', 'removeStorageWorktrees', async (paths: unknown) => {
  await new Promise((resolve) => setTimeout(resolve, delay))
  const targets = paths as string[]
  const removed = targets.filter((path) => !failing.includes(path))
  worktrees = worktrees.filter((worktree) => !removed.includes(worktree.path))
  return {
    removed,
    failed: targets.filter((path) => failing.includes(path)).map((path) => ({ path, error: 'Worktree is in use' })),
  }
})
mockIpc('app', 'revealFile', async () => undefined)

/** Point the mock at a story's data. The storage page stories call this too, since the page embeds the section. */
export function seedWorktreeStorage(next: StorageWorktree[] = worktreeStorageFixture, options: SeedOptions = {}): void {
  worktrees = next
  mode = options.mode ?? 'ready'
  delay = options.delay ?? 0
  failing = options.failing ?? []
  reads = 0
}

/** The section reads on mount, so a story seeds the mock during render — before that effect runs. */
function seed(next: StorageWorktree[], options: SeedOptions = {}) {
  return (Story: () => ReactElement) => {
    seedWorktreeStorage(next, options)
    return <Story />
  }
}

const meta: Meta<typeof WorktreeStorageSection> = {
  title: 'Settings/Storage/Worktrees',
  component: WorktreeStorageSection,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof WorktreeStorageSection>

/** Worktrees sessions still use are one summary row; only the unused ones can be removed. */
export const Ready: Story = { decorators: [seed(worktreeStorageFixture)] }

/** Measuring walks every file, so the section shows progress while the rest of the page is already usable. */
export const Measuring: Story = { decorators: [seed(worktreeStorageFixture, { mode: 'loading' })] }

/** The first read fails; Retry reads again. */
export const ErrorThenRetry: Story = {
  decorators: [seed(worktreeStorageFixture, { mode: 'error' })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(canvas.getAllByTestId('storage-worktree')).toHaveLength(3))
  },
}

/** Nothing was ever created under `~/.worktrees`. */
export const Empty: Story = { decorators: [seed([])] }

/** Every worktree belongs to a session: there is nothing to remove. */
export const AllInUse: Story = { decorators: [seed(worktreeStorageFixture.filter((worktree) => worktree.inUse))] }

/** Remove Unused takes the clean unused worktrees and leaves the one with uncommitted changes. */
export const RemoveUnused: Story = {
  decorators: [seed(worktreeStorageFixture, { delay: 600 })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByTestId('storage-worktrees-remove-unused'))
    await userEvent.click(await within(document.body).findByTestId('storage-worktrees-confirm'))
    await waitFor(() => expect(canvas.getAllByTestId('storage-worktree')).toHaveLength(1))
    await expect(canvas.getByTestId('storage-worktrees-notice')).toHaveTextContent('Removed 2 worktrees')
  },
}

/** A worktree with uncommitted changes is removed one at a time, after a warning that names the loss. */
export const RemoveWithUncommittedChanges: Story = {
  decorators: [seed(worktreeStorageFixture)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rows = await canvas.findAllByTestId('storage-worktree')
    await userEvent.click(within(rows[2]!).getByRole('button', { name: 'Remove' }))
    await expect(await within(document.body).findByText(/uncommitted changes that will be lost/)).toBeVisible()
  },
}

/** A session adopted one worktree after it was listed: it stays, and the notice says so. */
export const PartialFailure: Story = {
  decorators: [seed(worktreeStorageFixture, { failing: [worktreeStorageFixture[3]!.path] })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByTestId('storage-worktrees-remove-unused'))
    await userEvent.click(await within(document.body).findByTestId('storage-worktrees-confirm'))
    await waitFor(() => expect(canvas.getByTestId('storage-worktrees-notice')).toHaveTextContent('1 worktree could not be removed'))
  },
}

/** Long repository and branch names truncate instead of pushing the size and buttons off the row. */
export const LongNames: Story = {
  decorators: [
    seed([{
      path: `${ROOT}/a-very-long-repository-directory-name-that-keeps-going-and-going/tkq90c-d2d432a`,
      repo: 'a-very-long-repository-directory-name-that-keeps-going-and-going',
      branch: 'feature/an-equally-long-branch-name-that-describes-everything-in-detail',
      bytes: 2 * GB,
      inUse: false,
      dirty: true,
    }]),
    (Story) => <div className="max-w-sm"><Story /></div>,
  ],
}
