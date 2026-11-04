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
    const expand = canvas.getByRole('button', { name: /Expand|展开/ })
    const table = canvas.getByRole('table')
    const viewport = table.parentElement!
    const icon = expand.querySelector('svg')!
    await waitFor(() => {
      const visibleRight = Math.min(table.getBoundingClientRect().right, viewport.getBoundingClientRect().right)
      expect(Math.abs(icon.getBoundingClientRect().right - visibleRight)).toBeLessThanOrEqual(1)
    })
    expand.focus({ focusVisible: true })
    await waitFor(() => {
      expect(getComputedStyle(expand).boxShadow).not.toContain('3px')
      const stroke = getComputedStyle(icon)
      expect(stroke.outlineStyle).toBe('solid')
      const outset = parseFloat(stroke.outlineOffset) + parseFloat(stroke.outlineWidth)
      const buttonBox = expand.getBoundingClientRect()
      const glyph = icon.getBoundingClientRect()
      expect(buttonBox.right - glyph.right).toBeLessThanOrEqual(1)
      expect(glyph.left - buttonBox.left).toBeGreaterThan(outset)
    })
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
      await userEvent.click(expand)
      const body = within(canvasElement.ownerDocument.body)
      const dialog = await body.findByRole('dialog', { name: 'Table' })
      expect(within(dialog).getByRole('table')).toHaveTextContent('Alice')
      await userEvent.keyboard('{Escape}')
      await waitFor(() => expect(body.queryByRole('dialog')).toBeNull())
      const transpose = canvas.getByRole('button', { name: /Transpose Table|行列互换/ })
      await userEvent.click(transpose)
      await waitFor(() => {
        expect(within(table).queryAllByRole('columnheader')).toEqual([])
        expect(within(table).getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
          'Name / 名称', 'Role / 职责', 'Status / 状态',
        ])
      })
      await userEvent.click(canvas.getByRole('button', { name: /Original Layout|恢复原表/ }))
      await waitFor(() => {
        expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
          'Name / 名称', 'Role / 职责', 'Status / 状态',
        ])
      })
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

const WIDE = [
  '| Field | Alpha | Beta | Gamma | Delta | Epsilon | Zeta |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| Owner | Ada | Grace | Linus | Margaret | Edsger | Barbara |',
  '| State | Ready | Review | Blocked | Ready | Draft | Shipped |',
].join('\n')

export const Wide: Story = {
  args: { text: `A wide row becomes one column.\n\n${WIDE}`, isStreaming: false },
  decorators: [(Story) => <div style={{ width: 360 }}><Story /></div>],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const table = canvas.getByRole('table')
    expect(within(table).getAllByRole('columnheader')).toHaveLength(7)
    await userEvent.click(canvas.getByRole('button', { name: /Transpose Table|行列互换/ }))
    await waitFor(() => {
      expect(within(table).queryAllByRole('columnheader')).toEqual([])
      expect(within(table).getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
        'Field', 'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta',
      ])
    })
    const owner = within(table).getByRole('cell', { name: 'Owner' })
    expect(owner).not.toHaveAttribute('data-table-mark')
    const column = [...table.querySelectorAll('tr')].map((row) => row.children[1]?.textContent)
    expect(column).toEqual(['Owner', 'Ada', 'Grace', 'Linus', 'Margaret', 'Edsger', 'Barbara'])
  },
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
