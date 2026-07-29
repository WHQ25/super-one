import type { Meta, StoryObj } from '@storybook/react-vite'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { ComputerUseGrantPrompt } from './ComputerUseGrantPrompt'

/** Tiny 1×1 green PNG as a stand-in app icon. */
const SAMPLE_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    requestId: 'story-cugrant-1',
    toolName: 'computer_snapshot',
    input: { app: '豆包', bundleId: 'com.bot.pc.doubao' },
    allowAlwaysAllow: true,
    supportsAlwaysPersist: true,
    requestKind: 'computer_use_grant',
    message: 'Allow Computer Use for 豆包?',
    subtitle: 'com.bot.pc.doubao',
    riskLevel: 'medium',
    computerUseGrant: {
      app: '豆包',
      bundleId: 'com.bot.pc.doubao',
      toolName: 'computer_snapshot',
      iconDataUri: SAMPLE_ICON,
    },
    ...overrides,
  }
}

const meta = {
  title: 'Chat/ComputerUseGrantPrompt',
  component: ComputerUseGrantPrompt,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="@container" style={{ maxWidth: 560 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ComputerUseGrantPrompt>

export default meta
type Story = StoryObj<typeof meta>

export const WithIcon: Story = {
  args: {
    request: makeRequest(),
    onSessionAllow: () => {},
    onAlwaysAllow: () => {},
    onDeny: () => {},
  },
}

export const WithoutIcon: Story = {
  args: {
    request: makeRequest({
      computerUseGrant: {
        app: 'TextEdit',
        bundleId: 'com.apple.TextEdit',
        toolName: 'computer_act',
      },
    }),
    onSessionAllow: () => {},
    onAlwaysAllow: () => {},
    onDeny: () => {},
  },
}

export const LongBundleId: Story = {
  args: {
    request: makeRequest({
      computerUseGrant: {
        app: 'Google Chrome',
        bundleId: 'com.google.Chrome.helper.renderer.very.long.identifier',
        toolName: 'computer_apps',
        iconDataUri: SAMPLE_ICON,
      },
    }),
    onSessionAllow: () => {},
    onAlwaysAllow: () => {},
    onDeny: () => {},
  },
}
