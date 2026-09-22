import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import type { BashEditDiff } from '@superone/shared/agent-types'
import { ToolBlock } from './ToolBlock'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const meta: Meta<typeof ToolBlock> = {
  title: 'Tool UI/Claude Code/BashTerminalView',
  component: ToolBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof ToolBlock>

const NORMAL_OUTPUT = [
  'src/main/index.ts',
  'src/main/session/session.ts',
  'src/main/session/session.test.ts',
  'src/renderer/src/components/chat/ToolBlock.tsx',
  '4 files matched',
].join('\n')

const ANSI_OUTPUT = [
  '\x1b[32m✓\x1b[0m typecheck:web (3.2s)',
  '\x1b[32m✓\x1b[0m typecheck:node (1.1s)',
  '\x1b[31m✗\x1b[0m test (12.4s)',
  '  \x1b[31m●\x1b[0m \x1b[1msession ownership > rejects local send when remotely owned\x1b[0m',
  '    Expected: \x1b[32m"SessionLockedError"\x1b[0m',
  '    Received: \x1b[31m"undefined"\x1b[0m',
].join('\n')

const LARGE_OUTPUT = Array.from({ length: 80 }, (_, i) =>
  `${String(i + 1).padStart(3, ' ')}: ./node_modules/${['react', 'react-dom', 'zustand', 'motion', 'i18next'][i % 5]}/dist/index.js → resolved`
).join('\n')

export const Streaming: Story = {
  args: {
    toolName: 'Bash',
    input: JSON.stringify({ command: 'bun run typecheck:web' }),
    status: 'streaming',
    elapsedSeconds: 4,
  },
}

export const CompleteNormal: Story = {
  args: {
    toolName: 'Bash',
    input: JSON.stringify({ command: 'find src -name "*.ts" | head -5' }),
    status: 'complete',
    result: NORMAL_OUTPUT,
  },
}

export const CompleteWithDescription: Story = {
  args: {
    toolName: 'Bash',
    input: JSON.stringify({
      command: 'bun install --frozen-lockfile',
      description: 'Install dependencies',
    }),
    status: 'complete',
    result: 'Lockfile is up to date · 1247 packages installed',
  },
}

export const Denied: Story = {
  args: {
    toolName: 'Bash',
    input: JSON.stringify({ command: 'rm -rf /important/data' }),
    status: 'complete',
    result: '[denied] User denied permission',
  },
}

export const TimedOut: Story = {
  args: {
    toolName: 'Bash',
    input: JSON.stringify({ command: 'sleep 60', timeout: 5000 }),
    status: 'complete',
    result: '',
    isTimedOut: true,
  },
}

export const BackgroundTask: Story = {
  args: {
    toolName: 'Bash',
    input: JSON.stringify({
      command: 'bun run dev',
      run_in_background: true,
    }),
    status: 'complete',
    result: 'Started Vite server on port 5173 (running in background)',
    backgroundActivity: true,
  },
}

export const LargeOutput: Story = {
  args: {
    toolName: 'Bash',
    input: JSON.stringify({ command: 'find node_modules -name "index.js" | head -80' }),
    status: 'complete',
    result: LARGE_OUTPUT,
    autoExpand: true,
  },
}

const LONG_COMMAND = [
  'find apps/desktop/src -type f \\( -name "*.ts" -o -name "*.tsx" \\)',
  '  | xargs rg -n "isError|tool_use_error|Exit code"',
  '  | sort -t: -k1,1 -k2,2n',
  '  | head -n 200',
  '  | tee /tmp/bash-error-scan.txt',
].join(' \\\n')

export const LongCommand: Story = {
  args: {
    toolName: 'Bash',
    input: JSON.stringify({
      command: LONG_COMMAND,
      description: 'Scan for tool error markers',
    }),
    status: 'complete',
    result: LARGE_OUTPUT,
    autoExpand: true,
  },
}

export const AnsiColored: Story = {
  args: {
    toolName: 'Bash',
    input: JSON.stringify({ command: 'bun run check-all' }),
    status: 'complete',
    result: ANSI_OUTPUT,
    isError: true,
    autoExpand: true,
  },
}

// A command that edited the working tree: the CLI's `bashEditDiff` (SDK 0.3.269,
// `bashEditDiffEnabled`) draws each file as the Edit / Write / Delete row a direct
// edit would get, with the output folded behind its own toggle.
const EDIT_DIFF: BashEditDiff = {
  files: [
    {
      filePath: '/Users/me/project/src/main/session/session.ts',
      hunks: [
        { oldStart: 12, oldLines: 3, newStart: 12, newLines: 4, lines: [' export function park(session: Session) {', '-  session.status = "parked"', '+  session.status = "parked"', '+  session.parkedAt = Date.now()', ' }'] },
        { oldStart: 40, oldLines: 1, newStart: 41, newLines: 1, lines: ['-const RETRY = 3', '+const RETRY = 5'] },
      ],
    },
    {
      filePath: '/Users/me/project/src/main/session/park.test.ts',
      hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 3, lines: ['+import { park } from "./session"', '+', '+test("park stamps parkedAt", () => {})'] }],
      created: true,
    },
  ],
  moreFiles: 0,
  changedFiles: ['/Users/me/project/src/main/session/session.ts', '/Users/me/project/src/main/session/park.test.ts'],
}

const EDIT_COMMAND = 'sed -i \'\' \'s/RETRY = 3/RETRY = 5/\' src/main/session/session.ts && cat > src/main/session/park.test.ts <<\'EOF\'\n…\nEOF'

export const EditedFiles: Story = {
  name: 'Edited files (collapsed)',
  args: {
    toolName: 'Bash',
    input: JSON.stringify({ command: EDIT_COMMAND }),
    status: 'complete',
    result: '',
    bashEditDiff: EDIT_DIFF,
  },
}

export const EditedFilesExpanded: Story = {
  name: 'Edited files (expanded)',
  args: { ...EditedFiles.args, autoExpand: true },
}

export const EditedFilesWithOutput: Story = {
  name: 'Edited files with output',
  args: {
    ...EditedFiles.args,
    input: JSON.stringify({ command: 'bunx codemod rename-symbol park parkSession src/' }),
    result: 'Processed 2 files\n  ✓ src/main/session/session.ts\n  ✓ src/main/session/park.test.ts',
    autoExpand: true,
  },
}

export const EditedFilesFailed: Story = {
  name: 'Edited files, command failed',
  args: {
    ...EditedFiles.args,
    result: 'sed: 1: "s/RETRY = 3/RETRY = 5/": unterminated substitute pattern\nExit code 1',
    isError: true,
    autoExpand: true,
  },
}

export const EditedFilesDeleted: Story = {
  name: 'Edited files incl. a deletion',
  args: {
    ...EditedFiles.args,
    input: JSON.stringify({ command: 'git mv src/old.ts src/new.ts && rm src/legacy.ts' }),
    bashEditDiff: {
      files: [
        { filePath: '/Users/me/project/src/new.ts', hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+export const moved = true', '+'] }], created: true },
        { filePath: '/Users/me/project/src/old.ts', hunks: [{ oldStart: 1, oldLines: 2, newStart: 0, newLines: 0, lines: ['-export const moved = true', '-'] }], deleted: true },
        { filePath: '/Users/me/project/src/legacy.ts', hunks: [{ oldStart: 1, oldLines: 1, newStart: 0, newLines: 0, lines: ['-// legacy'] }], deleted: true },
      ],
      moreFiles: 0,
    },
    autoExpand: true,
  },
}

export const EditedFilesPartial: Story = {
  name: 'Edited files, diff partly unavailable',
  args: {
    ...EditedFiles.args,
    input: JSON.stringify({ command: 'bun run codegen' }),
    bashEditDiff: {
      files: [EDIT_DIFF.files[0], { filePath: '/Users/me/project/assets/logo.png', hunks: [] }],
      moreFiles: 4,
      changedFiles: ['/Users/me/project/src/main/session/session.ts', '/Users/me/project/assets/logo.png', '/Users/me/project/src/generated/api.ts'],
      unavailable: true,
    },
    autoExpand: true,
  },
}

// The CLI skips the diff for git state commands; with no files to list the block
// keeps the plain Bash layout.
export const EditDiffSkipped: Story = {
  name: 'Git state command, diff skipped',
  args: {
    ...EditedFiles.args,
    input: JSON.stringify({ command: 'git stash pop' }),
    result: 'Dropped refs/stash@{0}',
    bashEditDiff: { files: [], moreFiles: 0, skipped: true },
    autoExpand: true,
  },
}
