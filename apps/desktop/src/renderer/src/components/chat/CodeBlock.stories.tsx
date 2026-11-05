import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { HighlightedCodeBlockPresenter } from './presenters/CodeBlock'
import { codePlugin, codePluginLight } from './code-plugins'
import { useIsDark } from '@/hooks/use-is-dark'

const script = "pwd\nname='你好'\nprintf '%s\\n' \"$name\"\n"
const meta: Meta<typeof HighlightedCodeBlockPresenter> = {
  title: 'Chat/CodeBlock',
  component: HighlightedCodeBlockPresenter,
  parameters: { layout: 'padded' },
  args: {
    code: script,
    language: 'bash',
    codePlugin,
    runBash: async () => {},
  },
  render: function Render(args) {
    const isDark = useIsDark()
    return <div className="chat-md max-w-xl"><HighlightedCodeBlockPresenter {...args} ports={{
      isDark,
      lightCodePlugin: codePluginLight,
      copyText: async () => true,
      isRhaiLanguage: () => false,
      highlightRhai: () => null,
    }} /></div>
  },
}
export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {}
export const Launching: Story = {
  args: { runBash: () => new Promise(() => {}) },
  play: async ({ canvasElement }) => {
    const run = within(canvasElement).getAllByRole('button')[0]
    await userEvent.click(run)
    await expect(run).toBeDisabled()
  },
}
export const LaunchErrorAndRetry: Story = {
  args: { runBash: async () => { throw new Error('Bash could not start. Check that Bash is installed and try again.') } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getAllByRole('button')[0])
    await expect(within(canvasElement).getByRole('alert')).toBeVisible()
  },
}
export const NoProject: Story = { args: { runBash: null } }
export const Incomplete: Story = { args: { isComplete: false, code: 'for file in' } }
export const Empty: Story = { args: { code: '' } }
export const NonBash: Story = { args: { language: 'python', code: 'print("hello")' } }
export const HostWithoutExecution: Story = { args: { runBash: undefined } }
export const NarrowLongScript: Story = {
  decorators: [Story => <div style={{ width: 280 }}><Story /></div>],
  args: { code: `${script}printf '%s\\n' 'A very long output string in a narrow terminal example with spaces and 中文内容'\n`.repeat(4) },
}
export const Started: Story = {
  play: async ({ canvasElement }) => {
    const run = within(canvasElement).getAllByRole('button')[0]
    await userEvent.click(run)
    await expect(run).toBeEnabled()
    await expect(within(canvasElement).queryByRole('alert')).toBeNull()
  },
}
