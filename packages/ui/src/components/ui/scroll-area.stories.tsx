import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { ScrollArea } from './scroll-area'

const meta: Meta<typeof ScrollArea> = {
  title: 'UI/ScrollArea',
  component: ScrollArea,
  args: {
    edgeFade: true,
    type: 'scroll',
    className:
      'max-h-48 w-64 rounded-md border bg-popover min-h-0 [&_[data-slot=scroll-area-viewport]]:max-h-[inherit] [&_[data-slot=scroll-area-viewport]>div]:block!',
  },
}

export default meta
type Story = StoryObj<typeof ScrollArea>

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => (
    <div key={index} className="px-3 py-1.5 text-sm">
      Project {index}
    </div>
  ))
}

export const Overflow: Story = {
  args: { children: rows(16) },
  play: async ({ canvasElement }) => {
    const scroller = canvasElement.querySelector('[data-slot="scroll-area-viewport"]')
    await expect(scroller).not.toBeNull()
    await expect(scroller).toHaveClass('scroll-edge-fade-y')
  },
}

export const OverflowDark: Story = {
  ...Overflow,
  globals: { theme: 'dark' },
}

export const Fits: Story = {
  args: { children: rows(2) },
}
