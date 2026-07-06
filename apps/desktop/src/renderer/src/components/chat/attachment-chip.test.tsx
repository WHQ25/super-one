/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { AttachmentChip } from './attachment-chip'

const renderChip = (att: { name: string; mimeType: string; base64: string }) =>
  render(
    <TooltipProvider>
      <AttachmentChip att={att} onOpen={() => {}} />
    </TooltipProvider>,
  )

describe('AttachmentChip', () => {
  it('renders an image attachment as a thumbnail chip carrying its filename', () => {
    renderChip({ name: 'cat.png', mimeType: 'image/png', base64: 'AAA' })

    expect(screen.getByText('cat.png')).toBeInTheDocument()
    const thumb = screen.getAllByAltText('cat.png')[0]
    expect(thumb).toHaveAttribute('src', 'data:image/png;base64,AAA')
  })

  it('renders a pdf attachment as an icon chip with its title and no thumbnail image', () => {
    renderChip({ name: 'spec.pdf', mimeType: 'application/pdf', base64: 'AAA' })

    expect(screen.getByText('spec.pdf')).toBeInTheDocument()
    expect(screen.queryByAltText('spec.pdf')).toBeNull()
  })
})
