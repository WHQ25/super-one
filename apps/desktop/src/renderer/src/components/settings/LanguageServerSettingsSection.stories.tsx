import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import type { LspServerInfo } from '@superone/shared/desktop-lsp'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import { LanguageServerSettingsSection } from './LanguageServerSettingsSection'

const PROJECT_ROOT = '/Users/demo/workspace/super-one'

function makeServer(overrides: Partial<LspServerInfo> = {}): LspServerInfo {
  return {
    id: 'typescript',
    label: 'TypeScript / JavaScript',
    serverName: 'typescript-language-server',
    languages: ['typescript', 'tsx', 'javascript', 'jsx'],
    installStatus: 'not_installed',
    installable: true,
    installHint: null,
    version: null,
    binaryPath: null,
    managed: false,
    installError: null,
    enabled: true,
    runningWorkspaces: [],
    ...overrides,
  }
}

function seedState({
  projectEnabled,
  server,
  noProject = false,
}: {
  projectEnabled: boolean
  server: LspServerInfo
  noProject?: boolean
}) {
  return (Story: () => ReactElement) => {
    mockIpc('app', 'listLspServers', async () => [server])
    mockIpc('app', 'onLspStatusChange', () => () => {})
    mockIpc('app', 'installLspServer', async () => makeServer({ installStatus: 'installed', version: '4.3.3', managed: true }))
    mockIpc('app', 'uninstallLspServer', async () => makeServer({ installStatus: 'not_installed' }))
    mockIpc('app', 'stopLspWorkspace', async () => {})
    mockIpc('app', 'saveAppSettings', async () => ({}))

    useAppStore.setState({
      currentFolder: noProject ? null : PROJECT_ROOT,
      lspEnabledProjects: projectEnabled ? [PROJECT_ROOT] : [],
      lspEnabledServers: { typescript: server.enabled },
    })
    return <Story />
  }
}

const meta: Meta<typeof LanguageServerSettingsSection> = {
  title: 'Settings/LanguageServerSettingsSection',
  component: LanguageServerSettingsSection,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof LanguageServerSettingsSection>

export const NotInstalled: Story = {
  decorators: [seedState({ projectEnabled: false, server: makeServer() })],
}

export const InstalledAndRunning: Story = {
  decorators: [
    seedState({
      projectEnabled: true,
      server: makeServer({
        installStatus: 'installed',
        version: '4.3.3',
        managed: true,
        binaryPath: '/Users/demo/.superone/lsp/typescript/node_modules/.bin/typescript-language-server',
        runningWorkspaces: [{ workspaceRoot: PROJECT_ROOT, pid: 12345, lastActiveAt: Date.now() }],
      }),
    }),
  ],
}

export const InstallError: Story = {
  decorators: [
    seedState({
      projectEnabled: false,
      server: makeServer({
        installStatus: 'error',
        installError: 'npm was not found on PATH',
      }),
    }),
  ],
}

export const NoActiveProject: Story = {
  decorators: [
    seedState({
      projectEnabled: false,
      noProject: true,
      server: makeServer({ installStatus: 'installed', version: '4.3.3', managed: true }),
    }),
  ],
}
