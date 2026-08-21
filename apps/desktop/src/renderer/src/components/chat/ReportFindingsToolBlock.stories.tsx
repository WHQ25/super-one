import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { ReportFindingsToolBlock } from './ReportFindingsToolBlock'
import { ToolBlock } from './ToolBlock'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container flex flex-col gap-2" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

/**
 * Goes through `ToolBlock`, not straight to the component, so these stories also
 * cover the dispatch — a story that renders the block directly would still look
 * right after someone deleted the `ReportFindings` case.
 */
function block(
  params: Record<string, unknown>,
  options: {
    isStreaming?: boolean
    isError?: boolean
    isDenied?: boolean
    elapsedSeconds?: number
  } = {},
) {
  return (
    <ToolBlock
      toolName="ReportFindings"
      input={JSON.stringify(params)}
      // A denied call is a result prefixed with `[denied] `, the same way the real
      // stream carries it.
      result={options.isDenied ? '[denied] User denied permission' : options.isStreaming ? undefined : 'Findings recorded.'}
      status={options.isStreaming ? 'streaming' : 'complete'}
      elapsedSeconds={options.elapsedSeconds}
      isError={options.isError}
    />
  )
}

/** `allowExpand` comes from the nested-tool context, so the compact row is direct. */
function compact(params: Record<string, unknown>, isStreaming = false) {
  return (
    <ReportFindingsToolBlock
      params={params}
      isStreaming={isStreaming}
      stallLevel="normal"
      allowExpand={false}
    />
  )
}

// Written in the tool's own vocabulary — snake_case keys, most-severe-first order,
// `short_summary` as the claim with the rationale stripped off.
const FINDINGS = [
  {
    file: 'apps/desktop/src/main/session/session.ts',
    line: 812,
    category: 'correctness',
    verdict: 'CONFIRMED',
    short_summary: 'Interrupt latch never clears on abort',
    summary: 'The interrupted latch is set before the abort resolves and is never cleared when the stream ends early, so the session refuses every later turn.',
    failure_scenario: 'Press Stop while a tool call is in flight → the tool rejects → `interrupted` stays true → the next send returns immediately with no assistant output.',
  },
  {
    file: 'apps/desktop/src/main/device-agent/ios-backend.ts',
    line: 233,
    category: 'correctness',
    verdict: 'CONFIRMED',
    short_summary: 'simctl stdin mangles non-ASCII input',
    summary: 'The simctl child process inherits the ambient locale, so typing non-ASCII text into the simulator writes replacement characters.',
    failure_scenario: 'device_act with text "登录" on a machine without LC_ALL set → the field receives "??" instead of the two characters.',
  },
  {
    file: 'apps/desktop/src/renderer/src/components/chat/ToolBlock.tsx',
    line: 1358,
    category: 'efficiency',
    verdict: 'PLAUSIBLE',
    short_summary: 'Result JSON re-parsed on every render',
    summary: 'The result payload is parsed inside the render body instead of a memo, so a streaming turn re-parses the full string on every delta.',
    failure_scenario: 'A 400 KB browser_snapshot result streams in over 60 deltas → 60 full JSON.parse passes on the main thread → visible input lag.',
  },
  {
    file: 'packages/shared/src/i18n/zh.ts',
    line: 2338,
    category: 'test-coverage',
    verdict: 'PLAUSIBLE',
    short_summary: 'No parity test between en and zh keys',
    summary: 'Nothing asserts that the zh resource covers every key the en interface declares, so a missed translation only surfaces as a raw key in the UI.',
    failure_scenario: 'Add a key to en.ts and forget zh.ts → TypeScript still passes if the block is spread → the Chinese UI renders "chat.toolBlock.x.y".',
  },
  {
    file: 'apps/desktop/src/main/ios-simulator/a11y-tree.ts',
    line: 96,
    category: 'simplification',
    short_summary: 'Duplicate node-flattening walk',
    summary: 'The tree is walked twice — once to collect labels and once to assign element ids — where a single pass would produce both.',
    failure_scenario: 'Not a runtime failure; a deep tree pays double traversal cost and the two walks can drift on which nodes they skip.',
  },
]

const meta: Meta = {
  title: 'SuperOne/Tool UI/Report Findings',
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj

/** The everyday shape: a finished review with a ranked list. */
export const Review: Story = {
  render: () => block({ level: 'high', findings: FINDINGS }),
}

/**
 * The two states the row has to distinguish without words.
 *
 * A clean review still gets a block — the tool was called, and "nothing to flag" is a
 * result the user paid for. A single finding checks that the count reads in the
 * singular.
 */
export const CleanAndSingle: Story = {
  render: () => (
    <>
      {block({ level: 'medium', findings: [] })}
      {block({ level: 'max', findings: [FINDINGS[0]] })}
      {block({ findings: [FINDINGS[4]] })}
    </>
  ),
}

/** After `--fix`: the same findings, re-reported with what actually happened. */
export const AfterFix: Story = {
  render: () => block({
    level: 'high',
    findings: [
      { ...FINDINGS[0], outcome: 'fixed' },
      { ...FINDINGS[1], outcome: 'fixed' },
      { ...FINDINGS[2], outcome: 'skipped' },
      { ...FINDINGS[3], outcome: 'no_change_needed' },
    ],
  }),
}

/**
 * Mid-stream the input is a partially-parsed object: `findings` may be absent, a
 * bare string, or an array whose last entry is still half-written.
 */
export const Streaming: Story = {
  render: () => (
    <>
      {block({}, { isStreaming: true, elapsedSeconds: 3 })}
      {block({ level: 'high', findings: FINDINGS.slice(0, 2) }, { isStreaming: true, elapsedSeconds: 11 })}
      {block({
        level: 'high',
        findings: [FINDINGS[0], { file: 'apps/desktop/src/main/', summary: '' }],
      }, { isStreaming: true, elapsedSeconds: 14 })}
    </>
  ),
}

/** Long paths truncate from the left; the filename and line never disappear. */
export const Overflow: Story = {
  render: () => (
    <>
      {block({
        findings: [
          {
            file: 'apps/desktop/src/renderer/src/components/ios-simulator/use-ios-simulator-handover.ts',
            line: 1042,
            category: 'correctness',
            verdict: 'CONFIRMED',
            short_summary: 'Handover drops the pending frame when the preview remounts mid-gesture',
            summary: 'Remounting the preview while a drag is in flight clears the decoded frame reference before the new host layer subscribes, so the device shows the last painted frame until the next full keyframe arrives.',
            failure_scenario: 'Start dragging the floating simulator, switch panes so the host layer remounts, release → the preview freezes for up to two seconds.',
          },
        ],
      })}
      {block({ findings: [{ file: 'vitest.config.ts', summary: 'The alias map is duplicated between the vitest and electron-vite configs and the two have already drifted on `@superone/ui`.' }] })}
    </>
  ),
}

/** Header-only, the way a subagent card shows it. */
export const Compact: Story = {
  render: () => (
    <>
      {compact({ level: 'high', findings: FINDINGS })}
      {compact({ findings: [] })}
      {compact({}, true)}
    </>
  ),
}

/** Denied and errored calls keep the shared outcome chrome. */
export const Outcomes: Story = {
  render: () => (
    <>
      {block({ level: 'high', findings: FINDINGS.slice(0, 2) }, { isError: true })}
      {block({ level: 'high', findings: [] }, { isDenied: true })}
    </>
  ),
}
