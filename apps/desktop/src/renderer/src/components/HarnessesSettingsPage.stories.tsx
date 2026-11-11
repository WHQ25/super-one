/**
 * Storybook: Settings → Harnesses enable / download / install UI.
 * Mocks listHarnesses + enable/disable + install progress so the flow can be
 * exercised without a real runtime download.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { HarnessesSettingsPage } from './HarnessesSettingsPage'
import {
  StoryFrame,
  baseCatalog,
  interactiveScenario,
  type Scenario,
} from './HarnessesSettingsPage.test-fixtures'

const meta: Meta<typeof HarnessesSettingsPage> = {
  title: 'Settings/Harnesses',
  component: HarnessesSettingsPage,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Harness enable / download / install UI. External CLI harnesses (`acp-grok`, `acp-antigravity`, `opencode`) render a runnable Markdown install block when their CLI is missing.',
      },
    },
  },
}

export default meta
type Story = StoryObj<typeof HarnessesSettingsPage>

function withScenario(name: string, scenario: Scenario): Story {
  return {
    name,
    decorators: [
      (Story) => (
        <StoryFrame scenario={scenario}>
          <Story />
        </StoryFrame>
      ),
    ],
  }
}

export const InteractiveInstall: Story = withScenario(
  'Interactive — enable & download',
  interactiveScenario,
)

export const AllDisabled: Story = withScenario('All disabled', {
  catalog: baseCatalog(),
})

export const Installing: Story = withScenario('Installing (mid download)', {
  select: 'codex',
  catalog: baseCatalog({
    claude: {
      enabled: true,
      state: 'ready',
      runtimeSource: 'managed',
      runtimeVersion: '2.0.1',
      command: '/Users/demo/.superone/harnesses/claude/2.0.1/bin/claude',
    },
    codex: {
      enabled: true,
      state: 'installing',
      runtimeSource: 'managed',
    },
  }),
  seedProgress: [
    {
      harnessId: 'codex',
      received: 4.2 * 1024 * 1024,
      total: 12 * 1024 * 1024,
      phase: 'download',
    },
  ],
  seedProgressStepMs: 80,
})

export const InstallError: Story = withScenario('Install error', {
  select: 'codex',
  catalog: baseCatalog({
    claude: {
      enabled: true,
      state: 'ready',
      runtimeSource: 'managed',
      runtimeVersion: '2.0.1',
      command: '/Users/demo/.superone/harnesses/claude/2.0.1/bin/claude',
    },
    codex: {
      enabled: false,
      state: 'error',
      runtimeSource: 'managed',
      diagnostic: {
        code: 'install_failed',
        message: 'Download failed: ECONNRESET while fetching tarball from dl.super-one.dev',
      },
    },
  }),
  seedProgress: [
    {
      harnessId: 'codex',
      received: 2 * 1024 * 1024,
      total: 8 * 1024 * 1024,
      phase: 'error',
      message: 'Download failed: ECONNRESET while fetching tarball from dl.super-one.dev',
    },
  ],
  seedProgressStepMs: 80,
})

export const ReadyManaged: Story = withScenario('Ready (managed runtime)', {
  catalog: baseCatalog({
    claude: {
      enabled: true,
      state: 'ready',
      runtimeSource: 'managed',
      runtimeVersion: '2.1.4',
      command: '/Users/demo/.superone/harnesses/claude/2.1.4/bin/claude',
    },
    codex: {
      enabled: true,
      state: 'ready',
      runtimeSource: 'managed',
      runtimeVersion: '0.45.0',
      command: '/Users/demo/.superone/harnesses/codex/0.45.0/bin/codex',
    },
    opencode: {
      enabled: true,
      state: 'ready',
      runtimeSource: 'external',
      runtimeVersion: '1.2.0',
      command: '/Users/demo/.opencode/bin/opencode',
    },
    'acp-grok': {
      enabled: true,
      state: 'needs_auth',
      runtimeSource: 'external',
      requiresAuth: true,
      runtimeVersion: '0.9.0',
      command: '/Users/demo/.grok/bin/grok',
    },
  }),
})

export const ExternalCliMissingGrok: Story = withScenario(
  'External CLI missing — Grok (click ▶ to install)',
  {
    select: 'acp',
    section: 'account',
    focusKey: 'acp-grok',
    catalog: baseCatalog({
      'acp-grok': {
        enabled: true,
        state: 'missing',
        runtimeSource: 'external',
        diagnostic: { code: 'not_found', message: 'configured command path was not found' },
      },
    }),
  },
)

export const ExternalCliMissingAntigravity: Story = withScenario(
  'External CLI missing — Antigravity (click ▶ to install)',
  {
    select: 'acp',
    section: 'account',
    focusKey: 'acp-antigravity',
    catalog: baseCatalog({
      'acp-antigravity': {
        enabled: true,
        state: 'missing',
        runtimeSource: 'external',
        diagnostic: { code: 'not_found', message: 'configured command path was not found' },
      },
    }),
  },
)

export const ExternalCliMissingOpenCode: Story = withScenario(
  'External CLI missing — OpenCode (click ▶ to install)',
  {
    select: 'opencode',
    focusKey: 'opencode',
    catalog: baseCatalog({
      opencode: {
        enabled: true,
        state: 'missing',
        runtimeSource: 'external',
        diagnostic: { code: 'not_found', message: 'configured command path was not found' },
      },
    }),
  },
)

export const ExternalCliInstallingStreaming: Story = withScenario(
  'External CLI installing (streaming output)',
  {
    select: 'acp',
    section: 'account',
    focusKey: 'acp-antigravity',
    catalog: baseCatalog({
      'acp-antigravity': {
        enabled: true,
        state: 'missing',
        runtimeSource: 'external',
        diagnostic: { code: 'not_found', message: 'configured command path was not found' },
      },
    }),
    seedCliInstallEvents: [
      { harnessId: 'acp-antigravity', phase: 'start' },
      {
        harnessId: 'acp-antigravity',
        phase: 'output',
        data: '\u001b[36m==> Fetching Antigravity CLI for darwin-arm64...\u001b[0m\n\u001b[32m==> Installing agy to ~/.local/bin/agy\u001b[0m\n',
      },
    ],
    seedCliInstallStepMs: 60,
  },
)

export const ExternalCliInstallErrorRetry: Story = withScenario(
  'External CLI install error & retry',
  {
    select: 'acp',
    section: 'account',
    focusKey: 'acp-grok',
    failCliInstallCode: 6,
    catalog: baseCatalog({
      'acp-grok': {
        enabled: true,
        state: 'missing',
        runtimeSource: 'external',
        diagnostic: { code: 'not_found', message: 'configured command path was not found' },
      },
    }),
    seedCliInstallEvents: [
      { harnessId: 'acp-grok', phase: 'start' },
      {
        harnessId: 'acp-grok',
        phase: 'output',
        data: '\u001b[31mcurl: (6) Could not resolve host: x.ai\u001b[0m\n',
      },
      { harnessId: 'acp-grok', phase: 'error', exitCode: 6 },
    ],
    seedCliInstallStepMs: 50,
  },
)

export const ExternalCliNarrow: Story = withScenario(
  'External CLI missing — narrow window',
  {
    select: 'acp',
    section: 'account',
    focusKey: 'acp-antigravity',
    width: 720,
    catalog: baseCatalog({
      'acp-antigravity': {
        enabled: true,
        state: 'missing',
        runtimeSource: 'external',
        diagnostic: { code: 'not_found', message: 'configured command path was not found' },
      },
    }),
  },
)

export const OpenCodePreferences: Story = withScenario('OpenCode (session defaults only)', {
  select: 'opencode',
  catalog: baseCatalog({
    opencode: {
      enabled: true,
      state: 'ready',
      runtimeSource: 'external',
      runtimeVersion: '1.2.0',
    },
  }),
})

export const GrokPreferences: Story = withScenario('Grok (session defaults only)', {
  select: 'acp',
  catalog: baseCatalog({
    'acp-grok': {
      enabled: true,
      state: 'ready',
      runtimeSource: 'external',
      runtimeVersion: '0.9.0',
      command: 'grok',
      requiresAuth: true,
    },
  }),
})

export const CursorTabs: Story = withScenario(
  'Cursor (account / preferences / models / cloud tabs)',
  {
    select: 'cursor',
    catalog: baseCatalog({
      claude: {
        enabled: true,
        state: 'ready',
        runtimeSource: 'managed',
        runtimeVersion: '2.1.4',
      },
      cursor: {
        enabled: true,
        state: 'ready',
        runtimeSource: 'managed',
        runtimeVersion: 'sdk',
        requiresAuth: true,
      },
    }),
  },
)

export const FailOnEnable: Story = withScenario('Interactive — fail on enable', {
  catalog: baseCatalog({
    claude: {
      enabled: true,
      state: 'ready',
      runtimeSource: 'managed',
      runtimeVersion: '2.0.1',
      command: '/Users/demo/.superone/harnesses/claude/2.0.1/bin/claude',
    },
  }),
  simulateInstall: true,
  failInstall: 'R2 returned 403 for channel manifest',
})

export const CodexPreferences: Story = withScenario(
  'Codex (preferences, accounts managed in Providers)',
  {
    select: 'codex',
    catalog: baseCatalog({
      codex: { enabled: true, state: 'ready', runtimeSource: 'managed', runtimeVersion: '0.45.0' },
    }),
  },
)

export const GrokAccount: Story = withScenario('Grok Account', {
  select: 'acp',
  section: 'account',
  catalog: baseCatalog({
    'acp-grok': {
      enabled: true,
      state: 'ready',
      runtimeSource: 'external',
      command: '/Users/demo/.grok/bin/grok agent stdio',
    },
  }),
})

export const CatalogLoading: Story = withScenario('Catalog loading', {
  catalog: baseCatalog(),
  catalogPending: true,
})

export const Narrow: Story = withScenario('Narrow window', {
  ...interactiveScenario,
  width: 720,
})

export const DeepSeekPreferences: Story = withScenario(
  'DeepSeek (preferences + subagent models)',
  {
    select: 'dsh',
    catalog: baseCatalog({
      dsh: { enabled: true, state: 'ready', runtimeSource: 'managed', runtimeVersion: '0.3.0' },
    }),
  },
)
