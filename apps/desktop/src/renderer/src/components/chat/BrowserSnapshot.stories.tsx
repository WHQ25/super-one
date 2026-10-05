import type { Meta, StoryObj } from '@storybook/react-vite'
import { ToolBlock } from './ToolBlock'
import { mockIpc } from '../../../../../.storybook/mock-ipc'

const IMAGE_PATH = '/storybook-browser/checkout.png'
const IMAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#f5f5f5"/><rect x="48" y="40" width="544" height="280" rx="12" fill="white"/><g font-family="sans-serif" fill="#202020"><text x="80" y="90" font-size="26">Checkout</text><text x="80" y="145" font-size="18">Order total</text><text x="460" y="145" font-size="18">$42.00</text></g><rect x="80" y="204" width="480" height="64" rx="8" fill="#262626"/><text x="280" y="244" font-family="sans-serif" font-size="18" fill="white">Continue</text></svg>',
)}`
const PAGE = 'url: https://example.com/checkout\ntitle: Checkout\nelements[1]{selector,role,name}:\n  #continue,button,Continue'
const INPUT = JSON.stringify({ include: ['meta', 'elements', 'screenshot'], description: 'Inspect checkout and capture its current state' })
const RESULT = JSON.stringify({ screenshot: { path: IMAGE_PATH, width: 640, height: 360 }, page: PAGE })

const meta = {
  title: 'SuperOne/Browser/Snapshot',
  component: ToolBlock,
  args: { toolName: 'mcp__superone__browser_snapshot', input: INPUT, result: RESULT, status: 'complete' },
  decorators: [(Story) => {
    mockIpc('app', 'getMediaServerPort', async () => 6006)
    mockIpc('app', 'readFileAsDataUri', async (path) => path === IMAGE_PATH
      ? { ok: true, dataUri: IMAGE }
      : { ok: false, error: 'File no longer available' })
    mockIpc('app', 'saveFileAs', async () => ({ ok: false, canceled: true }))
    return <div className="@container max-w-[720px]"><Story /></div>
  }],
} satisfies Meta<typeof ToolBlock>
export default meta
type Story = StoryObj<typeof meta>

export const Mixed: Story = {}
export const Expanded: Story = {
  play: async ({ canvasElement }) => { canvasElement.querySelector<HTMLElement>('.tool-node > div')?.click() },
}
export const ScreenshotOnly: Story = {
  args: {
    input: JSON.stringify({ include: ['screenshot'], description: 'Capture checkout' }),
    result: JSON.stringify({ path: IMAGE_PATH, width: 640, height: 360 }),
  },
}
export const WithoutScreenshot: Story = {
  args: { input: JSON.stringify({ description: 'Read checkout controls' }), result: PAGE },
}
export const Loading: Story = { args: { status: 'streaming', result: undefined } }
export const Error: Story = { args: { result: '[Error] Browser tab closed before capture', isError: true } }
export const Denied: Story = { args: { result: '[denied] Capture declined' } }
export const ImageUnavailable: Story = {
  args: { result: JSON.stringify({ screenshot: { path: '/storybook-browser/missing.png' }, page: PAGE }) },
  play: Expanded.play,
}
export const NarrowLongSummary: Story = {
  args: { input: JSON.stringify({ include: ['meta', 'screenshot'], description: 'Inspect checkout, verify all line items and totals, and capture the page before continuing to the payment step' }) },
  render: (args) => <div className="w-[320px]"><ToolBlock {...args} /></div>,
}
export const DarkChinese: Story = { globals: { theme: 'dark', locale: 'zh' }, play: Expanded.play }
