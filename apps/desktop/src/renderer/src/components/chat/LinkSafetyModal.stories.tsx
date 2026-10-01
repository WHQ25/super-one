import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'
import { FullscreenGlassDialog } from './FullscreenGlassDialog'
import { LinkSafetyModal } from './LinkSafetyModal'

const meta = {
  title: 'Chat/LinkSafetyModal',
  component: LinkSafetyModal,
  args: {
    url: 'https://example.com/docs/getting-started',
    isOpen: true,
    onClose: fn(),
    onConfirm: fn(),
    onOpenInApp: fn(),
  },
} satisfies Meta<typeof LinkSafetyModal>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithoutInAppBrowser: Story = {
  args: { onOpenInApp: undefined },
}

export const LongUrl: Story = {
  args: {
    url: `/private/tmp/claude-501/s1/${'very-long-evidence-file-name-'.repeat(8)}confirm.png`,
  },
}

/** Opened from a Markdown link inside another modal dialog, as in the files previewer fullscreen. */
export const InsideFullscreenDialog: Story = {
  render: function Render(args) {
    const [open, setOpen] = useState(true)
    return (
      <FullscreenGlassDialog open onOpenChange={() => {}} title="EVIDENCE.md">
        <div className="p-6 text-sm">
          <button type="button" className="text-primary underline" onClick={() => setOpen(true)}>
            claude-verified-titled-new-confirm.png
          </button>
          <LinkSafetyModal {...args} isOpen={open} onClose={() => { args.onClose(); setOpen(false) }} />
        </div>
      </FullscreenGlassDialog>
    )
  },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: /built-in browser/i }))
    await expect(args.onOpenInApp).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('button', { name: /built-in browser/i })).toBeNull())
    // The outer fullscreen survives the inner dialog's interaction.
    await expect(screen.getByRole('button', { name: 'claude-verified-titled-new-confirm.png' })).toBeVisible()
  },
}
