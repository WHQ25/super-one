import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import {
  BROWSER_COMPACT_TOOL_NAMES,
  BROWSER_LEGACY_TOOL_NAMES,
  BUILT_IN_SUPERONE_TOOL_NAMES,
  MINIAPP_CALL_BARE_NAME,
  MINIAPP_LIST_BARE_NAME,
  MOBILE_SHARE_FILE_TOOL_NAME,
} from '@superone/shared/superone-host-owned-tools'
import { NestedToolContext } from './nested-tool-context'
import { ToolBlock } from './ToolBlock'

/**
 * Catalog of every SuperOne MCP tool row as ToolBlock renders it.
 *
 * Detailed expand galleries stay in sibling stories under this same title:
 * Archive, Automation, Collab, Browser, Computer, Widget, Video, Miniapp.
 */
const HIDDEN_TOOLS = new Set([
  'session_rename',
  'session_tag_list',
  'session_collab_list_agents',
  MINIAPP_LIST_BARE_NAME,
])

const COMPUTER_TOOLS = [
  'computer_apps',
  'computer_snapshot',
  'computer_zoom',
  'computer_query',
  'computer_act',
  'computer_wait_for',
] as const

function q(bare: string): string {
  return `mcp__superone__${bare}`
}

function StoryShell({ children, width = 680 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container space-y-5" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
}

function Row({
  tool,
  input = {},
  status = 'complete',
  result,
  isError,
  collapsed,
}: {
  tool: string
  input?: Record<string, unknown>
  status?: 'streaming' | 'complete'
  result?: string
  isError?: boolean
  collapsed?: boolean
}) {
  const block = (
    <ToolBlock
      toolName={q(tool)}
      input={JSON.stringify(input)}
      status={status}
      result={result}
      isError={isError}
      elapsedSeconds={status === 'streaming' ? 2 : undefined}
    />
  )
  if (!collapsed) return block
  return (
    <NestedToolContext.Provider value={{ allowExpand: false }}>
      {block}
    </NestedToolContext.Provider>
  )
}

function Pair({
  tool,
  input,
  result,
  collapsed,
}: {
  tool: string
  input?: Record<string, unknown>
  result?: string
  collapsed?: boolean
}) {
  return (
    <>
      <Row tool={tool} input={input} status="streaming" collapsed={collapsed} />
      <Row tool={tool} input={input} status="complete" result={result} collapsed={collapsed} />
    </>
  )
}

const meta: Meta = {
  title: 'SuperOne/MCP Tools',
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj

export const ManualAndConfig: Story = {
  name: 'Manual & config',
  render: () => (
    <StoryShell>
      <Note>
        Compact rows: name + space + muted summary. Running labels shimmer. No colon.
      </Note>
      <Section title="read_manual">
        <Pair tool="read_manual" input={{ domain: 'widget', topic: 'overview' }} result="Loaded widget guidelines" />
        <Pair tool="read_manual" input={{ domain: 'miniapp', topic: 'manifest' }} result="Guide content delivered" />
      </Section>
      <Section title="config_read">
        <Pair
          tool="config_read"
          input={{ domain: 'appearance' }}
          result={JSON.stringify({ label: 'Appearance' })}
        />
        <Row tool="config_read" input={{}} result={JSON.stringify({ label: 'Overview' })} />
      </Section>
      <Section title="config_apply">
        <Pair
          tool="config_apply"
          input={{ changes: [{ key: 'theme', value: 'dark' }] }}
          result={JSON.stringify({
            status: 'ok',
            applied: [{ key: 'theme', label: 'Theme', type: 'string', oldValue: 'light', newValue: 'dark' }],
          })}
        />
        <Row
          tool="config_apply"
          input={{ resource: { operation: 'create' } }}
          result={JSON.stringify({ status: 'ok', operation: 'create', title: 'Personal Key' })}
        />
      </Section>
    </StoryShell>
  ),
}

export const Miniapp: Story = {
  name: 'Mini-app',
  render: () => (
    <StoryShell>
      <Section title="miniapp_dev_setup">
        <Pair
          tool="miniapp_dev_setup"
          input={{ name: 'Counter', slug: 'counter', directory: '/tmp/counter' }}
          result={JSON.stringify({ status: 'ok', appId: 'counter' })}
        />
      </Section>
      <Section title="miniapp_dev_register / pack / update_types">
        <Pair
          tool="miniapp_dev_register"
          input={{ directory: '/tmp/counter', name: 'Counter' }}
          result={JSON.stringify({ status: 'ok' })}
        />
        <Pair
          tool="miniapp_dev_pack"
          input={{ appDir: '/tmp/counter', outputDir: '/tmp/out' }}
          result={JSON.stringify({ packagePath: '/tmp/out/counter-1.0.0.s1app' })}
        />
        <Pair
          tool="miniapp_dev_update_types"
          input={{ appDir: '/tmp/counter' }}
          result={JSON.stringify({ status: 'ok' })}
        />
      </Section>
      <Section title="miniapp_call (no installed app in Storybook)">
        <Pair
          tool={MINIAPP_CALL_BARE_NAME}
          input={{ appId: 'counter', tool: 'increment', input: { by: 1 } }}
          result={JSON.stringify({ value: 2 })}
        />
      </Section>
    </StoryShell>
  ),
}

export const Session: Story = {
  name: 'Session tag & archive',
  render: () => (
    <StoryShell>
      <Note>Archive expand galleries live in SuperOne/MCP Tools/Archive.</Note>
      <Section title="session_tag">
        <Pair
          tool="session_tag"
          input={{ add: ['tool-ui', 'storybook'] }}
          result={JSON.stringify({ status: 'ok' })}
        />
      </Section>
      <Section title="project_list / session_list / session_search">
        <Pair
          tool="project_list"
          result={JSON.stringify({
            projects: [{ id: 'p1', name: 'super-one', path: '/tmp/super-one', isCurrent: true }],
            count: 1,
          })}
        />
        <Pair
          tool="session_list"
          input={{ harness: 'claude' }}
          result={JSON.stringify({
            sessions: [{ id: 's1', title: 'Fix tool UI', harness: 'claude' }],
            count: 1,
          })}
        />
        <Pair
          tool="session_search"
          input={{ query: 'tool ui' }}
          result={JSON.stringify({
            hits: [{ sessionId: 's1', title: 'Fix tool UI', snippet: 'shimmer' }],
            count: 1,
          })}
        />
      </Section>
      <Section title="session_read">
        <Pair
          tool="session_read"
          input={{ sessionId: 's1', view: 'user' }}
          result={'# Session s1 — user\ntitle: Fix tool UI'}
        />
        <Row
          tool="session_read"
          input={{ sessionId: 's1', view: 'meta' }}
          result={JSON.stringify({ title: 'Fix tool UI', harness: 'claude', messageCount: 4 })}
        />
      </Section>
      <Section title="session_cleanup">
        <Pair
          tool="session_cleanup"
          input={{ action: 'hide', sessionIds: ['s1'] }}
          result={JSON.stringify({ action: 'hide', hidden: [{ id: 's1', title: 'Old' }] })}
        />
      </Section>
    </StoryShell>
  ),
}

export const Collab: Story = {
  name: 'Collaboration',
  render: () => (
    <StoryShell>
      <Note>Full expand cards live in SuperOne/MCP Tools/Collab.</Note>
      <Section title="Collapsed (subagent card)">
        <Pair tool="session_collab_request" input={{ launches: [{ name: 'Alice' }] }} collapsed />
        <Pair tool="session_collab_start" input={{ credential: 'cred-a' }} collapsed />
        <Pair tool="session_collab_send" input={{ credential: 'cred-a', content: 'hello' }} collapsed />
        <Pair tool="session_collab_retrieve" input={{ credentials: ['cred-a'] }} collapsed />
      </Section>
      <Section title="Expanded">
        <Row
          tool="session_collab_request"
          input={{ launches: [{ name: 'Alice', role: 'Reviewer' }] }}
          result={JSON.stringify({
            status: 'ok',
            launches: [{ name: 'Alice', role: 'Reviewer', title: 'Alice - Reviewer' }],
          })}
        />
        <Row
          tool="session_collab_send"
          input={{ content: 'Please review the tool row.' }}
          result={JSON.stringify({
            status: 'ok',
            to: { name: 'Alice', role: 'Reviewer', title: 'Alice - Reviewer', sessionId: 'child-1' },
          })}
        />
      </Section>
    </StoryShell>
  ),
}

export const Automation: Story = {
  name: 'Automation',
  render: () => (
    <StoryShell>
      <Section title="automation_list / apply / delete">
        <Pair
          tool="automation_list"
          result={JSON.stringify({
            automations: [{ id: 'a1', name: 'Daily Review', enabled: true, schedule: 'daily 09:00' }],
            count: 1,
          })}
        />
        <Pair
          tool="automation_apply"
          input={{ name: 'Nightly digest' }}
          result={JSON.stringify({ status: 'ok', automation: { id: 'a2', name: 'Nightly digest' } })}
        />
        <Pair
          tool="automation_delete"
          input={{ id: 'a1' }}
          result={JSON.stringify({ deleted: [{ id: 'a1', name: 'Daily Review' }] })}
        />
      </Section>
    </StoryShell>
  ),
}

export const Media: Story = {
  name: 'Media',
  render: () => (
    <StoryShell>
      <Section title="media_list_providers">
        <Pair
          tool="media_list_providers"
          result={JSON.stringify({
            providers: [
              { id: 'grok', label: 'Grok', provider: 'xAI', kind: 'image', models: [{ id: 'grok-imagine', label: 'Imagine' }] },
            ],
          })}
        />
        <Row
          tool="media_list_providers"
          status="streaming"
          collapsed
        />
      </Section>
      <Section title="media_generate_image (failed — success hides the row)">
        <Row
          tool="media_generate_image"
          input={{ prompt: 'a red cube on a table' }}
          result={JSON.stringify({ status: 'error', message: 'provider timeout' })}
          isError
        />
      </Section>
      <Section title="media_generate_video">
        <Pair
          tool="media_generate_video"
          input={{ prompt: 'slow camera push on a city street at dusk' }}
          result={JSON.stringify({ status: 'submitted', generationId: 'gen-1' })}
        />
        <Pair
          tool="media_generate_video"
          input={{ prompt: 'slow camera push on a city street at dusk' }}
          result={JSON.stringify({ status: 'submitted', generationId: 'gen-1' })}
          collapsed
        />
        <Row
          tool="media_generate_video"
          input={{ prompt: 'slow camera push on a city street at dusk' }}
          result={JSON.stringify({ status: 'error', message: 'provider returned 500' })}
          isError
        />
      </Section>
      <Section title="media_video_status (failed poll is the only visible row)">
        <Row
          tool="media_video_status"
          input={{ generationId: 'gen-1' }}
          result={JSON.stringify({ status: 'error', message: 'render failed' })}
          isError
        />
      </Section>
    </StoryShell>
  ),
}

export const Widget: Story = {
  name: 'Widget',
  render: () => (
    <StoryShell>
      <Section title="widget_list_templates">
        <Pair
          tool="widget_list_templates"
          result={JSON.stringify({ templates: ['coverage-gauge', 'build-summary'] })}
        />
      </Section>
      <Section title="widget_show collapsed (subagent card)">
        <Pair
          tool="widget_show"
          input={{ title: 'Coverage', widget_code: '<svg/>' }}
          result={JSON.stringify({ title: 'Coverage', widget_code: '<svg/>' })}
          collapsed
        />
      </Section>
    </StoryShell>
  ),
}

export const Browser: Story = {
  name: 'Browser',
  render: () => (
    <StoryShell>
      <Note>Op-level galleries live in SuperOne/MCP Tools/Browser.</Note>
      <Section title="Compact 8-tool surface">
        {BROWSER_COMPACT_TOOL_NAMES.map((tool) => (
          <Pair
            key={tool}
            tool={tool}
            input={tool === 'browser_act'
              ? { url: 'https://example.com' }
              : tool === 'browser_snapshot'
                ? {}
                : { description: tool }}
            result={JSON.stringify({ ok: true })}
          />
        ))}
      </Section>
    </StoryShell>
  ),
}

export const BrowserLegacy: Story = {
  name: 'Browser (legacy primitives)',
  render: () => (
    <StoryShell width={720}>
      <Section title="Legacy primitive + action names">
        {BROWSER_LEGACY_TOOL_NAMES.map((tool) => (
          <Row
            key={tool}
            tool={tool}
            input={tool.includes('navigate') ? { url: 'https://example.com' } : { description: tool }}
            result={JSON.stringify({ ok: true })}
          />
        ))}
      </Section>
    </StoryShell>
  ),
}

export const Computer: Story = {
  name: 'Computer use',
  render: () => (
    <StoryShell>
      <Note>Op-level galleries live in SuperOne/MCP Tools/Computer.</Note>
      {COMPUTER_TOOLS.map((tool) => (
        <Pair
          key={tool}
          tool={tool}
          input={tool === 'computer_act' ? { actions: [{ type: 'click' }] } : {}}
          result={JSON.stringify({ status: 'ok' })}
        />
      ))}
    </StoryShell>
  ),
}

export const MobileShare: Story = {
  name: 'Mobile share',
  render: () => (
    <StoryShell>
      <Pair
        tool={MOBILE_SHARE_FILE_TOOL_NAME}
        input={{ path: '/tmp/notes.pdf' }}
        result={JSON.stringify({ ok: true, path: '/tmp/notes.pdf', deviceName: 'iPhone', size: 12000 })}
      />
    </StoryShell>
  ),
}

export const ErrorAndDenied: Story = {
  name: 'Error & denied',
  render: () => (
    <StoryShell>
      <Note>
        Same chrome as Bash / Read / Browser: Ban + Denied badge on reject, warning icon + Error badge on failure.
        Interrupted titles are verb + noun (Generate Image, Tag Session). The badge carries the outcome.
      </Note>
      <Section title="Denied">
        <Row
          tool="session_tag"
          input={{ add: ['tool-ui'] }}
          result="[denied] User denied permission"
        />
        <Row
          tool="config_apply"
          input={{ changes: [{ key: 'theme', value: 'dark' }] }}
          result="[denied] User denied permission"
        />
        <Row
          tool="session_list"
          input={{}}
          result="[denied] User denied permission"
        />
        <Row
          tool="miniapp_dev_setup"
          input={{ name: 'Counter', slug: 'counter', directory: '/tmp/counter' }}
          result="[denied] User denied permission"
        />
      </Section>
      <Section title="Error">
        <Row
          tool="miniapp_dev_register"
          input={{ directory: '/tmp/broken', name: 'Broken' }}
          result={JSON.stringify({ status: 'error', message: 'manifest.json not found' })}
          isError
        />
        <Row
          tool="media_video_status"
          input={{ generationId: 'gen-1' }}
          result={JSON.stringify({ status: 'error', message: 'render failed' })}
          isError
        />
        <Row
          tool="config_apply"
          input={{ changes: [{ key: 'theme', value: 'dark' }] }}
          result={JSON.stringify({ status: 'error', message: 'provider unreachable' })}
          isError
        />
        <Row
          tool="automation_list"
          result={JSON.stringify({ status: 'error', message: 'database locked' })}
          isError
        />
      </Section>
    </StoryShell>
  ),
}

export const Hidden: Story = {
  name: 'Hidden (agent-internal)',
  render: () => (
    <StoryShell>
      <Note>
        These SuperOne tools are suppressed in chat (isAlwaysHiddenToolBlock).
        The empty slots below confirm ToolBlock renders nothing.
      </Note>
      {([...HIDDEN_TOOLS] as string[]).map((tool) => (
        <Section key={tool} title={tool}>
          <Row tool={tool} input={{ title: 'x' }} result="{}" />
        </Section>
      ))}
    </StoryShell>
  ),
}

export const Inventory: Story = {
  name: 'Inventory',
  render: () => {
    const extras = [MOBILE_SHARE_FILE_TOOL_NAME, MINIAPP_LIST_BARE_NAME, MINIAPP_CALL_BARE_NAME, ...COMPUTER_TOOLS]
    const all = [...new Set([...BUILT_IN_SUPERONE_TOOL_NAMES, ...extras])]
    return (
      <StoryShell width={720}>
        <Note>{all.length} SuperOne MCP names. Hidden tools render empty.</Note>
        {all.map((tool) => (
          <Section key={tool} title={HIDDEN_TOOLS.has(tool) ? `${tool} (hidden)` : tool}>
            <Row
              tool={tool}
              input={{}}
              status="complete"
              result={HIDDEN_TOOLS.has(tool) ? '{}' : JSON.stringify({ status: 'ok' })}
            />
          </Section>
        ))}
      </StoryShell>
    )
  },
}
