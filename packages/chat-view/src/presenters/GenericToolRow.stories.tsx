import type { Meta, StoryObj } from '@storybook/react-vite'
import { GenericToolRowPresenter, type GenericToolRowPorts } from './GenericToolRow'

const ports: GenericToolRowPorts = {
  cwd: '/tmp/proj',
  homedir: '/Users/me',
  stallLevel: 'normal',
  renderFileChip: ({ name }) => name,
  renderFileDiff: () => null,
  renderArtifactChip: ({ label }) => label,
  renderCount: (value) => value,
  renderJson: (text) => text,
  renderQuestionPreview: ({ content }) => content,
}

const meta = {
  title: 'Chat/Generic tool row',
  component: GenericToolRowPresenter,
  args: {
    toolName: 'Bash',
    input: '{"command":"rm -rf build"}',
    status: 'complete',
    allowExpand: true,
    autoExpandFileDiffs: false,
    ports,
  },
} satisfies Meta<typeof GenericToolRowPresenter>

export default meta
type Story = StoryObj<typeof meta>

export const AutoDeny: Story = {
  args: {
    isError: true,
    result: 'Tool `Bash` was not executed: Auto mode blocked this action (shell)',
  },
}

export const DeniedPrefix: Story = {
  args: {
    result: '[denied] User denied permission',
  },
}

export const DeniedWithReason: Story = {
  name: 'Denied with a reason · expanded',
  // The header only says it was denied; the reason sits at the bottom of the expanded row.
  args: {
    isError: true,
    result: '[denied] Keep the build folder, the release script still reads it.',
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByText('Denied'))
  },
}

export const Error: Story = {
  args: {
    isError: true,
    result: 'command exited 1',
  },
}
