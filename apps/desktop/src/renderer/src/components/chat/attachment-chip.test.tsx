/** @vitest-environment jsdom */
import { render } from '@testing-library/react'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { AttachmentChip } from './attachment-chip'

const renderChip = (att: { name: string; mimeType: string; base64: string }) => {
  const { container } = render(
    <TooltipProvider>
      <AttachmentChip att={att} />
    </TooltipProvider>,
  )
  return container.querySelector<HTMLElement>('[data-mention-kind="attachment"]')!
}

describe('AttachmentChip', () => {
  it('renders an image attachment as a thumbnail chip carrying its filename', () => {
    const chip = renderChip({ name: 'cat.png', mimeType: 'image/png', base64: 'AAA' })

    expect(chip).toHaveTextContent('cat.png')
    expect(chip.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AAA')
  })

  it('renders a pdf attachment as an icon chip with its title and no thumbnail image', () => {
    const chip = renderChip({ name: 'spec.pdf', mimeType: 'application/pdf', base64: 'AAA' })

    expect(chip).toHaveTextContent('spec.pdf')
    expect(chip.querySelector('img')).toBeNull()
  })
})
