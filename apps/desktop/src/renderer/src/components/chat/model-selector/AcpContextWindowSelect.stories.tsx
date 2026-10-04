import type { Meta, StoryObj } from '@storybook/react-vite'
import { AcpContextWindowSelect } from './AcpContextWindowSelect'

const meta = {
  title: 'Chat/ACP context window',
  component: AcpContextWindowSelect,
  args: {
    windows: [128_000, 256_000],
    value: null,
    onChange: () => {},
  },
} satisfies Meta<typeof AcpContextWindowSelect>

export default meta
type Story = StoryObj<typeof meta>

export const Preserve: Story = {}

export const Selected: Story = {
  args: { value: 256_000 },
}

export const SingleWindowHidden: Story = {
  args: { windows: [128_000] },
}

export const Disabled: Story = {
  args: { disabled: true, value: 128_000 },
}
