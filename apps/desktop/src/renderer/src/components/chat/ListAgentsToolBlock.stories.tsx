import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { ListAgentsToolBlock } from './ListAgentsToolBlock'
import { ToolBlock } from './ToolBlock'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container flex flex-col gap-2" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

/**
 * Goes through `ToolBlock`, not straight to the component, so these stories also cover
 * the dispatch — a story rendering the block directly would still look right after
 * someone deleted the `ListAgents` case.
 */
function block(
  result: string | undefined,
  options: { isStreaming?: boolean; isError?: boolean; isDenied?: boolean } = {},
) {
  return (
    <ToolBlock
      toolName="ListAgents"
      input="{}"
      result={
        options.isDenied
          ? '[denied] User denied permission'
          : options.isStreaming
            ? undefined
            : result
      }
      status={options.isStreaming ? 'streaming' : 'complete'}
      isError={options.isError}
    />
  )
}

/** `allowExpand` comes from the nested-tool context, so the compact row is direct. */
function compact(result: string) {
  return <ListAgentsToolBlock result={result} isStreaming={false} allowExpand={false} />
}

// Captured from real calls — the double-space padding around `·` is the harness's.
const MIXED = [
  'Subagents (1):',
  '  ac52c0c00c38676d3  ·  Plan  ·  running  ·  started 3m ago',
  '',
  'Peer sessions (2):',
  '  super-one-9c [205b72]  ·  interactive  ·  started 11m ago',
  '  super-one-80 [d6563f]  ·  interactive  ·  started 14m ago',
].join('\n')

const PEERS_ONLY = [
  'Peer sessions (2):',
  '  super-one-9c [205b72]  ·  interactive  ·  started 14m ago',
  '  super-one-80 [d6563f]  ·  interactive  ·  started 14m ago',
].join('\n')

const BRIDGED = [
  'Subagents (2):',
  '  b91f0ac41d2e5577  ·  Explore  ·  running  ·  started 40s ago',
  '  7c2d8be03af14690  ·  general-purpose  ·  running  ·  started 2m ago',
  '',
  'Other Claude sessions (3):',
  '  relay protocol audit  ·  ~/dev/super-one  ·  waiting on a human  ·  started 2h ago',
  '  untitled session  ·  (unknown directory)  ·  offline  ·  started 3d ago',
  '  cloud: docs sweep  ·  cloud session  ·  active 6m ago',
].join('\n')

const meta: Meta = {
  title: 'SuperOne/Tool UI/List Agents',
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj

/** The everyday shape: a subagent still working plus the sessions next door. */
export const Roster: Story = {
  render: () => (
    <>
      {block(MIXED)}
      {block(PEERS_ONLY)}
    </>
  ),
}

/** Every status the harness can print, so the dots stay distinguishable. */
export const Statuses: Story = {
  render: () => block(BRIDGED),
}

/**
 * "Nobody is reachable" is a real answer, not a failed parse — the row has to say so
 * instead of showing an empty list.
 */
export const Empty: Story = {
  render: () => (
    <>
      {block('No subagents or other Claude sessions.')}
      {block('No reachable agents.')}
    </>
  ),
}

/**
 * A heading whose count outruns its rows, a kind this build has never seen, and a
 * warning printed after the list — all three must survive rather than be dropped.
 */
export const PartialAndUnknown: Story = {
  render: () => (
    <>
      {block([
        'Peer sessions (9):',
        '  super-one-9c [205b72]  ·  interactive  ·  started 11m ago',
        '  super-one-80 [d6563f]  ·  interactive  ·  started 14m ago',
        'Some sessions were not reachable.',
      ].join('\n'))}
      {block([
        'Fleet workers (2):',
        '  worker-a  ·  building  ·  started 1m ago',
        '  worker-b  ·  queued',
      ].join('\n'))}
      {block('agents: []')}
    </>
  ),
}

/** In flight there is no result yet, so the row is a shimmering header. */
export const Streaming: Story = {
  render: () => block(MIXED, { isStreaming: true }),
}

/** The badge carries the outcome; the title stays verb + noun. */
export const DeniedAndError: Story = {
  render: () => (
    <>
      {block(undefined, { isDenied: true })}
      {block('Bridge walk failed: relay unreachable.', { isError: true })}
    </>
  ),
}

/** Nested under a subagent card: one line, no expand. */
export const Nested: Story = {
  render: () => (
    <>
      {compact(MIXED)}
      {compact('No reachable agents.')}
    </>
  ),
}
