import type { Meta, StoryObj } from '@storybook/react-vite'
import { InputRequestToolRow } from './InputRequestToolRow'

const meta = { title: 'Chat/InputRequestToolRow', component: InputRequestToolRow,
  args: { title: 'Review the implementation', streaming: false }, parameters: { layout: 'padded' },
} satisfies Meta<typeof InputRequestToolRow>
export default meta
type Story = StoryObj<typeof meta>
export const Waiting: Story = { args: { streaming: true } }
export const Submitted: Story = { args: { result: '{"status":"submitted","values":{"notes":"Preserve the original layout"}}' } }
export const Cancelled: Story = { args: { result: '{"status":"cancelled","reason":"user"}' } }
export const Failed: Story = { args: { isError: true, result: 'The requested schema contains an unsupported nested object.' } }
export const UnknownOutcome: Story = {}
export const NarrowDarkChinese: Story = { ...Cancelled, globals: { theme: 'dark', locale: 'zh' },
  args: { ...Cancelled.args, title: '确认这些很长的设计说明，取消表单后不会自动重新打开' },
  decorators: [Story => <div style={{ width: 280 }}><Story /></div>],
}
