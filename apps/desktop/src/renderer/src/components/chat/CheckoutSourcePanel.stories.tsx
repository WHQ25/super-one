import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import type { BranchImportResult, CheckoutFromSourceRequest, CheckoutProgress, CheckoutSourceBranch, CheckoutSourceBranchesResult } from '@superone/shared/agent-types'
import { CheckoutSourcePanel, type CheckoutSourcePanelProps } from './CheckoutSourcePanel'
import type { CheckoutSourceOption } from './checkout-sources'
import { mockIpc } from '../../../../../.storybook/mock-ipc'

const HEAD = '6a6563d0deadbeefcafe6a6563d0deadbeefcafe'
const HOUR = 3_600_000
const now = Date.now()

const OPTIONS: CheckoutSourceOption[] = [
  { id: 'node:office', group: 'node', label: 'office', hostKind: 'cli-node', source: { kind: 'node', connectionId: 'office', folderPath: 'remote:office:/srv/app' } },
  { id: 'node:lab', group: 'node', label: 'lab-mac', hostKind: 'cli-node', disabled: 'needs-upgrade', source: { kind: 'node', connectionId: 'lab', folderPath: 'remote:lab:/srv/app' } },
  { id: 'node:home', group: 'node', label: 'home-server', hostKind: 'cli-node', disabled: 'offline', source: { kind: 'node', connectionId: 'home', folderPath: 'remote:home:/srv/app' } },
  { id: 'remote:origin', group: 'remote', label: 'origin', detail: 'github.com/acme/super-one', source: { kind: 'remote', remote: 'origin' } },
  { id: 'pr', group: 'pr', label: 'Pull Requests', source: { kind: 'pr' } },
]
const [NODE, , , ORIGIN, PR] = OPTIONS as [CheckoutSourceOption, CheckoutSourceOption, CheckoutSourceOption, CheckoutSourceOption, CheckoutSourceOption]

const b = (partial: Partial<CheckoutSourceBranch>): CheckoutSourceBranch => ({
  ref: 'feat/x', title: 'feat/x', head: HEAD, localName: 'feat/x', relation: 'new', ...partial,
})

const NODE_BRANCHES = [
  b({ ref: 'feat/remote-checkout', title: 'feat/remote-checkout', localName: 'feat/remote-checkout', relation: 'behind', behind: 3, checkedOut: true, dirty: { files: 4, insertions: 120, deletions: 8 } }),
  b({ ref: 'feat/voice-handoff', title: 'feat/voice-handoff', localName: 'feat/voice-handoff', relation: 'new' }),
  b({ ref: 'fix/sidebar-hover', title: 'fix/sidebar-hover', localName: 'fix/sidebar-hover', relation: 'diverged' }),
  b({ ref: 'main', title: 'main', localName: 'main', relation: 'same', checkedOut: true }),
]
const ORIGIN_BRANCHES = [
  b({ ref: 'release/2.4', title: 'origin/release/2.4', localName: 'release/2.4', updatedAt: now - 2 * 24 * HOUR }),
  b({ ref: 'feat/mobile-live-activity', title: 'origin/feat/mobile-live-activity', localName: 'feat/mobile-live-activity', updatedAt: now - 5 * HOUR }),
  b({ ref: 'main', title: 'origin/main', localName: 'main', relation: 'behind', behind: 1, updatedAt: now - HOUR }),
]
const PULLS = [
  b({ ref: '482', title: '#482 Check out branches from other environments', localName: 'feat/remote-checkout', detail: 'vensen', relation: 'update', updatedAt: now - HOUR }),
  b({ ref: '479', title: '#479 Fix sidebar hover flicker', localName: 'pr/479-sidebar-hover', detail: 'contributor', fork: true, updatedAt: now - 30 * HOUR }),
]

/** What the stubs answer; each story sets it before rendering. */
let listing: (option: CheckoutSourceOption, fetch: boolean) => Promise<CheckoutSourceBranchesResult> = async () => ({ ok: true, branches: NODE_BRANCHES })
let emitProgress: ((progress: CheckoutProgress) => void) | null = null
let landing: (request: CheckoutFromSourceRequest) => Promise<BranchImportResult> = async (request) => ({
  ok: true, branch: request.localName, head: HEAD, status: 'created', snapshot: !!request.includeWorkingTree,
})
const byKind = async (option: CheckoutSourceOption): Promise<CheckoutSourceBranchesResult> => ({
  ok: true, branches: option.group === 'node' ? NODE_BRANCHES : option.group === 'remote' ? ORIGIN_BRANCHES : PULLS,
})

const THIS_PC: CheckoutSourceOption = { id: 'node:local', group: 'node', label: 'This Mac', hostKind: 'local', source: { kind: 'node', connectionId: 'local', folderPath: '/Users/me/code/super-one' } }

mockIpc('app', 'listCheckoutSourceBranches', (_folder: unknown, source: unknown, options: unknown) =>
  listing([...OPTIONS, THIS_PC].find((option) => JSON.stringify(option.source) === JSON.stringify(source)) ?? NODE,
    (options as { fetch?: boolean } | undefined)?.fetch === true))
mockIpc('app', 'checkoutFromSource', (request: unknown) => landing(request as CheckoutFromSourceRequest))
mockIpc('app', 'cancelCheckout', async () => {})
mockIpc('app', 'onCheckoutProgress', (listener: unknown) => {
  emitProgress = listener as (progress: CheckoutProgress) => void
  return () => { emitProgress = null }
})

function Frame({ narrow, ...props }: CheckoutSourcePanelProps & { narrow?: boolean }) {
  return (
    <div className={`${narrow ? 'w-60' : 'w-80'} overflow-hidden rounded-md border bg-popover text-popover-foreground`}>
      <CheckoutSourcePanel {...props} />
    </div>
  )
}

const meta = {
  title: 'Chat/CheckoutSourcePanel',
  component: Frame,
  args: {
    folderPath: '/Users/me/code/super-one',
    options: OPTIONS,
    selected: NODE,
    onSelectSource: () => {},
    onBack: () => {},
    onLanded: () => {},
  },
  beforeEach: () => {
    listing = byKind
    landing = async (request) => ({ ok: true, branch: request.localName, head: HEAD, status: 'created', snapshot: !!request.includeWorkingTree })
  },
} satisfies Meta<typeof Frame>

export default meta
type Story = StoryObj<typeof meta>

export const NodeBranches: Story = {}

export const CarryUncommittedChanges: Story = {
  args: { localDirty: { files: 2, insertions: 10, deletions: 1 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /feat\/remote-checkout/ }))
    await expect(canvas.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')
    await expect(canvas.getByRole('button', { name: 'Sync and Check Out' })).toBeEnabled()
  },
}

export const NewBranch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /feat\/voice-handoff/ }))
    await expect(canvas.getByRole('textbox', { name: 'Local branch name' })).toHaveValue('feat/voice-handoff')
  },
}

export const Diverged: Story = {
  args: { initialRef: 'fix/sidebar-hover' },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('button', { name: 'Overwrite and Keep Backup' })).toBeEnabled()
  },
}

export const Syncing: Story = {
  beforeEach: () => { landing = () => new Promise(() => {}) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /feat\/voice-handoff/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Create Only' }))
    await expect(await canvas.findByText(/Checking out feat\/voice-handoff from office/)).toBeInTheDocument()
  },
}

export const SourceMenu: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /office/, expanded: false }))
  },
}

export const GitRemote: Story = { args: { selected: ORIGIN } }

export const PullRequests: Story = { args: { selected: PR } }

export const Loading: Story = {
  beforeEach: () => { listing = () => new Promise(() => {}) },
  args: { selected: ORIGIN },
}

export const Empty: Story = {
  beforeEach: () => { listing = async () => ({ ok: true, branches: [] }) },
  args: { selected: PR },
}

export const NodeTooOld: Story = {
  beforeEach: () => { listing = async () => ({ ok: false, reason: 'unsupported' }) },
}

export const ListFailed: Story = {
  beforeEach: () => { listing = async () => ({ ok: false, reason: 'error', error: 'fatal: unable to access' }) },
  args: { selected: ORIGIN },
}

export const LongNamesNarrow: Story = {
  beforeEach: () => {
    listing = async () => ({
      ok: true,
      branches: [b({
        ref: 'feat/optimize-skill-and-prompt-for-agent-collaboration-handoff',
        title: 'feat/optimize-skill-and-prompt-for-agent-collaboration-handoff',
        localName: 'feat/optimize-skill-and-prompt-for-agent-collaboration-handoff',
        relation: 'behind', behind: 128, checkedOut: true, dirty: { files: 67, insertions: 1843, deletions: 212 },
      })],
    })
  },
  args: { narrow: true, selected: { ...NODE, label: 'build-server-in-the-third-floor-lab' } },
}

export const Dark: Story = { globals: { theme: 'dark' } }

export const Transferring: Story = {
  beforeEach: () => {
    landing = (request) => {
      queueMicrotask(() => emitProgress?.({ operationId: request.operationId!, phase: 'downloading', done: 6.5 * 1024 ** 2, total: 18.4 * 1024 ** 2 }))
      return new Promise(() => {})
    }
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /feat\/voice-handoff/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Create Only' }))
    await expect(await canvas.findByText(/Downloading/)).toBeInTheDocument()
  },
}

/** A remote last fetched an hour ago lists at once, then fetches in the background. */
export const GitRemoteFetching: Story = {
  args: { selected: ORIGIN },
  beforeEach: () => {
    listing = async (option, fetch) => fetch
      ? new Promise(() => {})
      : { ok: true, branches: ORIGIN_BRANCHES, fetchedAt: Date.now() - 60 * 60_000 }
  },
}

export const GitRemoteFetched: Story = {
  args: { selected: ORIGIN },
  beforeEach: () => {
    listing = async () => ({ ok: true, branches: ORIGIN_BRANCHES, fetchedAt: Date.now() - 2 * 60_000 })
  },
}

/** A node checkout takes a branch from this computer. */
export const NodeCheckoutFromThisComputer: Story = {
  args: {
    folderPath: 'remote:office:/srv/app',
    options: [THIS_PC, OPTIONS[1]!],
    selected: THIS_PC,
  },
}

