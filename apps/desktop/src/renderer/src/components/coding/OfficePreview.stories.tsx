import type { Meta, StoryObj } from '@storybook/react-vite'
import { OfficePreviewTooLargeError } from './office-preview-bytes'
import { OfficePreview, type ReadOfficePreviewBytes } from './OfficePreview'
import { OfficePptxThumbnailRail, type PptxThumbnailRenderer } from './office-pptx-rail'

const hang: ReadOfficePreviewBytes = () => new Promise(() => {})
const fail: ReadOfficePreviewBytes = async () => { throw new Error('unreadable') }
const huge: ReadOfficePreviewBytes = async () => { throw new OfficePreviewTooLargeError() }

/**
 * The engines load only after bytes arrive, so these stories stay on the
 * status chrome. A real document is the desktop file panel.
 */
const meta = {
  title: 'Coding/OfficePreview',
  component: OfficePreview,
  parameters: { layout: 'padded' },
  args: { url: 'local-file:///docs/quarterly.docx', name: 'quarterly.docx', className: 'h-80 border border-border bg-background' },
} satisfies Meta<typeof OfficePreview>
export default meta
type Story = StoryObj<typeof meta>

export const Loading: Story = { args: { readBytes: hang } }
export const Failed: Story = { args: { readBytes: fail } }
export const TooLarge: Story = { args: { readBytes: huge, name: 'model.xlsx' } }
export const FailedNarrow: Story = {
  args: { readBytes: fail, className: 'h-80 w-80 border border-border bg-background' },
}
export const Stage: Story = { args: { readBytes: fail, variant: 'stage', name: 'deck.pptx' } }

const paintThumb: PptxThumbnailRenderer = {
  async renderThumbnail(index, target) {
    const band = document.createElement('div')
    band.style.cssText = 'height:100%;display:flex;align-items:flex-end;justify-content:center;background:linear-gradient(#246,#c2185b);color:white;font:600 12px sans-serif'
    band.textContent = String(index + 1)
    target.replaceChildren(band)
    return () => target.replaceChildren()
  },
}

export const ThumbnailRail: Story = {
  render: function ThumbnailRailStory() {
    return (
      <div className="flex h-[840px] border border-border bg-background">
        <OfficePptxThumbnailRail count={10} active={1} aspect={16 / 9} renderer={paintThumb} onSelect={() => {}} />
      </div>
    )
  },
}
