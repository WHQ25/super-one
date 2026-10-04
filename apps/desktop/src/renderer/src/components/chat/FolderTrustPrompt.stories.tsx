import type { Meta, StoryObj } from '@storybook/react-vite'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { FolderTrustPrompt } from './FolderTrustPrompt'

const request = (input: PermissionRequest['input']): PermissionRequest => ({
  requestId: 'folder-trust-1',
  toolName: 'FolderTrust',
  input,
  allowAlwaysAllow: false,
  requestKind: 'folder_trust',
})

const meta = {
  title: 'Chat/Folder trust',
  component: FolderTrustPrompt,
  args: {
    onTrust: () => {},
    onReject: () => {},
  },
} satisfies Meta<typeof FolderTrustPrompt>

export default meta
type Story = StoryObj<typeof meta>

export const EmptyKinds: Story = {
  args: {
    request: request({
      cwd: '/Users/me/proj',
      workspace: '/Users/me/proj',
      configKinds: [],
    }),
  },
}

export const LongPath: Story = {
  args: {
    request: request({
      cwd: '/Users/me/very/long/nested/workspace/that/should/truncate/in/a/narrow/composer',
      workspace: '/Users/me/very/long/nested/workspace/that/should/truncate/in/a/narrow/composer',
      configKinds: ['rules', 'mcp', 'hooks', 'skills'],
    }),
  },
}

export const Reject: Story = {
  args: {
    request: request({
      cwd: '/tmp/untrusted',
      workspace: '/tmp/untrusted',
      configKinds: ['mcp'],
    }),
  },
}
