import { useLayoutEffect } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import type { LspServerInfo } from '@superone/shared/desktop-lsp'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { setLspClientStatus, type LspClientPhase } from '@/lib/lsp-status-store'
import { useAppStore } from '@/stores/app'
import { LspStatusPill } from './LspStatusPill'

const ROOT = '/storybook/lsp-demo'

function buildServer(overrides: Partial<LspServerInfo> = {}): LspServerInfo {
  return {
    id: 'typescript',
    label: 'TypeScript / JavaScript',
    serverName: 'typescript-language-server',
    languages: ['typescript', 'tsx', 'javascript', 'jsx'],
    installStatus: 'installed',
    installable: true,
    installHint: null,
    version: '4.3.3',
    binaryPath: '/usr/local/bin/typescript-language-server',
    managed: false,
    installError: null,
    enabled: true,
    runningWorkspaces: [],
    ...overrides,
  }
}

mockIpc('app', 'onLspStatusChange', () => () => {})
mockIpc('app', 'stopLspWorkspace', async () => {})

function PillHarness({
  phase,
  serverName = 'typescript-language-server',
  serverLabel = 'TypeScript / JavaScript',
  variant = 'editor',
  error = null,
  narrow = false,
}: {
  phase: 'unconfigured' | LspClientPhase
  serverName?: string
  serverLabel?: string
  variant?: 'editor' | 'review'
  error?: string | null
  narrow?: boolean
}) {
  useLayoutEffect(() => {
    if (phase === 'unconfigured') {
      useAppStore.setState({ lspEnabledServers: {}, customLspServers: [] })
      mockIpc('app', 'listLspServers', async () => [buildServer({ enabled: false })])
      setLspClientStatus('typescript', ROOT, null)
    } else {
      useAppStore.setState({ lspEnabledServers: { typescript: true }, customLspServers: [] })
      mockIpc('app', 'listLspServers', async () => [
        buildServer({ label: serverLabel, serverName }),
      ])
      setLspClientStatus('typescript', ROOT, { phase, error })
    }
    return () => {
      setLspClientStatus('typescript', ROOT, null)
    }
  }, [phase, serverName, serverLabel, error])

  return (
    <div
      className="flex h-9 items-center justify-between gap-2 rounded-md border border-border bg-card px-3"
      style={{ width: narrow ? 240 : 480, maxWidth: '100%' }}
    >
      <span className="truncate text-xs font-medium text-foreground">src/components/App.tsx</span>
      <LspStatusPill
        workspaceRoot={ROOT}
        filePath="src/components/App.tsx"
        language="tsx"
        variant={variant}
      />
    </div>
  )
}

const meta = {
  title: 'Coding/LspStatusPill',
  component: PillHarness,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof PillHarness>

export default meta
type Story = StoryObj<typeof meta>

export const Unconfigured: Story = {
  args: { phase: 'unconfigured' },
}

export const Starting: Story = {
  args: { phase: 'starting' },
}

export const Indexing: Story = {
  args: { phase: 'indexing' },
}

export const Ready: Story = {
  args: { phase: 'ready' },
}

export const ErrorState: Story = {
  args: { phase: 'error', error: 'Request timed out after 8000ms while loading tsconfig.json' },
}

export const ReviewVariant: Story = {
  args: { phase: 'ready', variant: 'review' },
}

function MultiServerHarness() {
  useLayoutEffect(() => {
    useAppStore.setState({
      lspEnabledServers: { typescript: true, python: true },
      customLspServers: [],
    })
    mockIpc('app', 'listLspServers', async () => [
      buildServer(),
      buildServer({
        id: 'python',
        label: 'Python',
        serverName: 'pyright',
        languages: ['python'],
      }),
    ])
    setLspClientStatus('typescript', ROOT, { phase: 'ready', error: null })
    setLspClientStatus('python', ROOT, { phase: 'indexing', error: null })
    return () => {
      setLspClientStatus('typescript', ROOT, null)
      setLspClientStatus('python', ROOT, null)
    }
  }, [])

  return (
    <div className="flex h-9 w-[420px] items-center justify-between rounded-md border border-border bg-card px-3">
      <span className="text-xs font-medium text-foreground">Review Toolbar</span>
      <LspStatusPill
        workspaceRoot={ROOT}
        filePaths={['src/components/App.tsx', 'scripts/analyze.py']}
        variant="review"
      />
    </div>
  )
}

export const MultiServerReview: Story = {
  args: { phase: 'ready', variant: 'review' },
  render: () => <MultiServerHarness />,
}

export const LongServerNameNarrow: Story = {
  args: {
    phase: 'ready',
    serverName: 'custom-enterprise-typescript-language-server-v2',
    serverLabel: 'Custom Enterprise TypeScript Server',
    narrow: true,
  },
}

export const ReadyPopoverOpen: Story = {
  args: { phase: 'ready' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = await canvas.findByTestId('lsp-status-pill')
    await expect(trigger).toHaveAttribute('data-lsp-phase', 'ready')
    await expect(trigger).toHaveTextContent('LSP')
    await userEvent.click(trigger)
  },
}
