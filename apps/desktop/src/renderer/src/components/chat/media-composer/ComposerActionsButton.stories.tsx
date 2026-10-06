import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { ComposerActionsButton } from './ComposerActionsButton'

const meta = {
  title: 'Chat/ComposerActions',
  component: ComposerActionsButton,
  args: { target: null, onAttach: fn() },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ComposerActionsButton>
export default meta
type Story = StoryObj<typeof meta>

export const NoSession: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button'))
    const menu = within(canvasElement.ownerDocument.body)
    await expect(menu.getByRole('menuitem', { name: 'Generate Image' })).toHaveAttribute('aria-disabled', 'true')
    await expect(menu.getByRole('menuitem', { name: 'Generate Video' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(menu.getByRole('menuitem', { name: 'Add Attachment' }))
    await expect(args.onAttach).toHaveBeenCalled()
  },
}
export const Menu: Story = { args: { target: { projectPath: '/preview', sessionId: 'preview' } }, play: async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole('button'))
  const menu = within(canvasElement.ownerDocument.body)
  await expect(menu.getByRole('menuitem', { name: 'Generate Image' })).not.toHaveAttribute('aria-disabled', 'true')
  await expect(menu.getByRole('menuitem', { name: 'Generate Video' })).not.toHaveAttribute('aria-disabled', 'true')
} }
export const Narrow: Story = { ...NoSession, parameters: { viewport: { defaultViewport: 'mobile1' } } }
