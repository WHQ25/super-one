import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { CopyableMarkdown } from './CopyableMarkdown'
import { mockIpc } from '../../../../../.storybook/mock-ipc'

mockIpc('app', 'getMediaServerPort', async () => 6007)

const TABLE = [
  '| Name / 名称 | Role / 职责 | Status / 状态 |',
  '| --- | --- | --- |',
  '| Alice | Engineer / 工程师 | Ready / 就绪 |',
  '| Bob | Designer / 设计师 | In progress / 进行中 |',
  '| Carol | PM / 产品经理 | Complete / 已完成 |',
].join('\n')

const meta: Meta<typeof CopyableMarkdown> = {
  title: 'Chat/MarkdownTable',
  component: CopyableMarkdown,
  args: { text: `Table actions appear above the header on hover or keyboard focus.\n\n${TABLE}`, isStreaming: false },
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="max-w-2xl"><Story /></div>],
}
export default meta
type Story = StoryObj<typeof CopyableMarkdown>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const copy = canvas.getByRole('button', { name: /Copy Table|复制表格/ })
    const descriptor = Object.getOwnPropertyDescriptor(navigator.clipboard, 'writeText')
    let copiedText = ''
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async (text: string) => { copiedText = text },
    })
    try {
      await userEvent.click(copy)
      await waitFor(() => expect(copiedText).toBe(TABLE))
      expect(copy.querySelector('.lucide-check')).not.toBeNull()
      await userEvent.click(canvas.getByRole('button', { name: /Expand|展开/ }))
      const body = within(canvasElement.ownerDocument.body)
      const dialog = await body.findByRole('dialog', { name: 'Table' })
      expect(within(dialog).getByRole('table')).toHaveTextContent('Alice')
      await userEvent.keyboard('{Escape}')
      await waitFor(() => expect(body.queryByRole('dialog')).toBeNull())
    } finally {
      if (descriptor) Object.defineProperty(navigator.clipboard, 'writeText', descriptor)
      else Reflect.deleteProperty(navigator.clipboard, 'writeText')
    }
  },
}

export const DarkChinese: Story = { ...Default, globals: { theme: 'dark', locale: 'zh' } }

export const Narrow: Story = {
  ...Default,
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
}

export const Streaming: Story = {
  args: { text: `${TABLE}\n| Dan | Engineer / 工程师 |`, isStreaming: true },
}

export const ClipboardDenied: Story = {
  play: async ({ canvasElement }) => {
    const copy = within(canvasElement).getByRole('button', { name: /Copy Table|复制表格/ })
    const descriptor = Object.getOwnPropertyDescriptor(navigator.clipboard, 'writeText')
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async () => { throw new Error('Clipboard denied') },
    })
    try {
      await userEvent.click(copy)
      expect(copy.querySelector('.lucide-check')).toBeNull()
    } finally {
      if (descriptor) Object.defineProperty(navigator.clipboard, 'writeText', descriptor)
      else Reflect.deleteProperty(navigator.clipboard, 'writeText')
    }
  },
}
