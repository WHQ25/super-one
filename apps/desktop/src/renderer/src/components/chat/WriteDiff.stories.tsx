import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { ToolBlock } from './ToolBlock'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const meta: Meta<typeof ToolBlock> = {
  title: 'ClaudeCode/WriteDiff',
  component: ToolBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof ToolBlock>

const SMALL_FILE = [
  'import { z } from \'zod\'',
  '',
  'export const userSchema = z.object({',
  '  id: z.string(),',
  '  email: z.string().email(),',
  '  createdAt: z.date(),',
  '})',
  '',
  'export type User = z.infer<typeof userSchema>',
].join('\n')

const STREAMING_PARTIAL = [
  'import { z } from \'zod\'',
  '',
  'export const userSchema = z.object({',
  '  id: z.string(),',
  '  email: z.string().ema',
].join('\n')

const BIG_FILE = Array.from({ length: 60 }, (_, i) =>
  `// line ${i + 1}: feature flag for experimental subagent rendering — ${i % 3 === 0 ? 'enabled' : 'disabled'}`
).join('\n')

export const NewSmallFile: Story = {
  args: {
    toolName: 'Write',
    input: JSON.stringify({
      file_path: '/Users/me/projects/super-one/src/shared/user.ts',
      content: SMALL_FILE,
    }),
    status: 'complete',
  },
}

export const StreamingPartial: Story = {
  args: {
    toolName: 'Write',
    input: JSON.stringify({
      file_path: '/Users/me/projects/super-one/src/shared/user.ts',
      content: STREAMING_PARTIAL,
    }),
    status: 'streaming',
    elapsedSeconds: 1,
  },
}

export const BigFile: Story = {
  args: {
    toolName: 'Write',
    input: JSON.stringify({
      file_path: '/Users/me/projects/super-one/src/shared/feature-flags.ts',
      content: BIG_FILE,
    }),
    status: 'complete',
  },
}
