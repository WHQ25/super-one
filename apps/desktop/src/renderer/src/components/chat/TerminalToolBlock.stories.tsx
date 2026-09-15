import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { ToolBlock } from './ToolBlock'
import { NestedToolContext } from './nested-tool-context'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container flex flex-col gap-2" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
}

function tool(
  name: 'tabs' | 'snapshot' | 'act' | 'wait_for',
  options: {
    input?: Record<string, unknown>
    result?: string
    status?: 'streaming' | 'complete'
    isError?: boolean
  },
) {
  return (
    <ToolBlock
      toolName={`mcp__superone__terminal_${name}`}
      input={JSON.stringify(options.input ?? {})}
      result={options.result}
      status={options.status ?? 'complete'}
      isError={options.isError}
    />
  )
}

const STORYBOOK_SCREEN = [
  '$ bun run storybook --ci',
  '$ node ./.storybook/run.mjs dev -p 6006 --ci',
  '',
  '┌  storybook v10.5.10',
  '│',
  '◇  Local:    http://localhost:6006/',
  '◇  Network:  http://192.168.1.20:6006/',
  '│',
  '└  Storybook started in 4.2s',
]

const RUN_OK = JSON.stringify({
  status: 'ok',
  tab: 'a1b2c3',
  tabStatus: 'running',
  foreground: 'node',
  control: 'me',
  command: 'bun run storybook --ci',
  altScreen: false,
  screen: STORYBOOK_SCREEN,
})

const RUN_REJECTED = JSON.stringify({
  status: 'rejected',
  reason: 'User declined',
  hint: 'Do not retry on your own — wait for the user.',
})

const LIST = 'count: 2\ntabs[2]{tab,title,cwd,status,foreground,control,openedBy,altScreen}:\n  a1b2c3,bun,/Users/me/app,running,node,me,agent,false\n  d4e5f6,zsh,/Users/me/app,running,zsh,none,user,false'

const ACT_OK = JSON.stringify({
  status: 'ok',
  stepsExecuted: 2,
  tab: 'a1b2c3',
  tabStatus: 'running',
  foreground: 'python3',
  control: 'me',
  command: 'python3',
  altScreen: false,
  screen: ['>>> import sys', '>>> sys.version', "'3.13.2 (main, Feb  4 2026, 14:51:20)'", '>>> '],
})

const ACT_EXITED = JSON.stringify({
  status: 'rejected',
  reason: 'command_exited',
  hint: 'The approved command is no longer in the foreground. Start a new one with terminal_tabs action=run.',
  tab: 'a1b2c3',
  tabStatus: 'running',
  foreground: 'zsh',
  control: 'none',
  command: null,
  altScreen: false,
  screen: ['>>> exit()', '$ '],
})

const ACT_TOOK_OVER = JSON.stringify({
  status: 'rejected',
  reason: 'user_took_over',
  hint: 'The user took over this tab. Do not retry on your own — ask before requesting it again.',
  tab: 'a1b2c3',
  tabStatus: 'running',
  foreground: 'vim',
  control: 'none',
  command: null,
  altScreen: true,
  screen: ['~', '~', '-- INSERT --'],
})

const WAIT_MET = JSON.stringify({
  status: 'ok',
  met: true,
  conditions: { text: true },
  elapsedMs: 3840,
  tab: 'a1b2c3',
  tabStatus: 'running',
  foreground: 'node',
  control: 'me',
  command: 'bun run storybook --ci',
  altScreen: false,
  screen: STORYBOOK_SCREEN,
})

const WAIT_TIMEOUT = JSON.stringify({
  status: 'timeout',
  met: false,
  conditions: { text: false },
  elapsedMs: 15000,
  tab: 'a1b2c3',
  tabStatus: 'running',
  foreground: 'node',
  control: 'me',
  command: 'bun run storybook --ci',
  altScreen: false,
  screen: ['$ bun run storybook --ci', '', '┌  storybook v10.5.10', '│  Building manager…'],
})

const SNAPSHOT = JSON.stringify({
  tab: 'a1b2c3',
  status: 'running',
  screen: STORYBOOK_SCREEN,
  meta: { title: 'bun', cwd: '/Users/me/app', foreground: 'node', control: 'me', command: 'bun run storybook --ci', altScreen: false, cols: 120, rows: 40, openedBy: 'agent' },
})

const SCROLLBACK = JSON.stringify({
  tab: 'a1b2c3',
  status: 'running',
  scrollback: Array.from({ length: 60 }, (_, i) => `[vite] hmr update /src/components/Button.tsx (${i + 1})`).join('\n'),
  scrollbackLines: 60,
  totalLines: 412,
})

const CLOSE_OK = JSON.stringify({ status: 'ok', closed: ['a1b2c3'], skipped: [] })

const meta: Meta = {
  title: 'Tool UI/SuperOne MCP/Terminal',
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj

export const Gallery: Story = {
  render: () => (
    <StoryShell>
      <Note>One row per terminal call; the screen the agent saw sits behind expand. Rejections use the denied tone.</Note>
      <Section title="Tabs">
        {tool('tabs', { input: {}, result: LIST })}
        {tool('tabs', { input: { action: 'run', command: 'bun run storybook --ci' }, result: RUN_OK })}
        {tool('tabs', { input: { action: 'run', command: 'bun run storybook --ci', description: 'Start Storybook to check the new story' }, result: RUN_OK })}
        {tool('tabs', { input: { action: 'attach', tab: 'd4e5f6' }, result: RUN_OK })}
        {tool('tabs', { input: { action: 'close', tab: 'a1b2c3' }, result: CLOSE_OK })}
      </Section>
      <Section title="Read">
        {tool('snapshot', { input: { tab: 'a1b2c3', include: ['screen', 'meta'] }, result: SNAPSHOT })}
        {tool('snapshot', { input: { tab: 'a1b2c3', include: ['scrollback'], tail: 60 }, result: SCROLLBACK })}
      </Section>
      <Section title="Act">
        {tool('act', { input: { tab: 'a1b2c3', actions: [{ type: 'type', text: 'import sys' }, { type: 'type', text: 'sys.version' }] }, result: ACT_OK })}
        {tool('act', { input: { tab: 'a1b2c3', actions: [{ type: 'key', key: 'Ctrl+C' }], description: 'Stop the dev server' }, result: ACT_OK })}
      </Section>
      <Section title="Wait">
        {tool('wait_for', { input: { tab: 'a1b2c3', text: 'Local:' }, result: WAIT_MET })}
        {tool('wait_for', { input: { tab: 'a1b2c3', idleMs: 800, exited: true }, result: WAIT_MET })}
      </Section>
    </StoryShell>
  ),
}

export const Streaming: Story = {
  render: () => (
    <StoryShell>
      {tool('tabs', { input: { action: 'run', command: 'bun run storybook --ci' }, status: 'streaming' })}
      {tool('act', { input: { tab: 'a1b2c3', actions: [{ type: 'key', key: 'Enter' }] }, status: 'streaming' })}
      {tool('wait_for', { input: { tab: 'a1b2c3', text: 'Local:' }, status: 'streaming' })}
    </StoryShell>
  ),
}

/** The three ways an agent is stopped: user declined, command ended, user took over. */
export const Rejected: Story = {
  render: () => (
    <StoryShell>
      {tool('tabs', { input: { action: 'run', command: 'rm -rf node_modules && bun install' }, result: RUN_REJECTED })}
      {tool('act', { input: { tab: 'a1b2c3', actions: [{ type: 'type', text: 'ls' }] }, result: ACT_EXITED })}
      {tool('act', { input: { tab: 'a1b2c3', actions: [{ type: 'key', key: 'Escape' }, { type: 'type', text: ':wq' }] }, result: ACT_TOOK_OVER })}
      {tool('tabs', { input: { action: 'run', command: 'vim' }, result: '[denied] User declined' })}
    </StoryShell>
  ),
}

export const Errors: Story = {
  render: () => (
    <StoryShell>
      {tool('tabs', { input: { action: 'run', command: 'ls', tab: 'a1b2c3' }, result: '[Error] Tab a1b2c3 is busy running node. Wait for it, use terminal_act, or omit tab to open a new one.', isError: true })}
      {tool('snapshot', { input: { tab: 'd4e5f6' }, result: '[Error] Tab d4e5f6 belongs to the user. Use terminal_tabs action=attach while a command is running in it.', isError: true })}
      {tool('wait_for', { input: { tab: 'a1b2c3', text: 'Local:' }, result: WAIT_TIMEOUT })}
    </StoryShell>
  ),
}

export const Nested: Story = {
  name: 'Nested in a subagent (no expand)',
  render: () => (
    <NestedToolContext.Provider value={{ allowExpand: false }}>
      <StoryShell>
        {tool('tabs', { input: { action: 'run', command: 'bun run storybook --ci' }, result: RUN_OK })}
        {tool('act', { input: { tab: 'a1b2c3', actions: [{ type: 'key', key: 'Ctrl+C' }] }, result: ACT_OK })}
      </StoryShell>
    </NestedToolContext.Provider>
  ),
}

export const Narrow: Story = {
  render: () => (
    <StoryShell width={320}>
      {tool('tabs', { input: { action: 'run', command: 'docker compose -f docker-compose.dev.yml up --build api worker scheduler' }, result: RUN_OK })}
      {tool('act', { input: { tab: 'a1b2c3', actions: [{ type: 'type', text: 'a very long line of input that will surely not fit in a narrow column' }] }, result: ACT_OK })}
    </StoryShell>
  ),
}
