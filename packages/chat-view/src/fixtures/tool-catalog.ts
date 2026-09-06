import { remoteToolBlockType, sanitizeRemoteToolInput } from '@superone/shared/remote-tool-input'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'

/**
 * Catalog of every tool row a remote surface can draw, as the rows the phone actually
 * receives — each example's input goes through the real `sanitizeRemoteToolInput` and the
 * real `remoteToolBlockType`, so a projection that stops carrying a presenter's field
 * shows up here as a degraded row instead of staying invisible until someone pairs a phone.
 *
 * Metadata the desktop's `computeToolMeta` derives in the main process (`toolSummary`,
 * `toolFilePath`, `toolDiff`) is authored per example, since that code is Electron-side.
 */
export const TOOL_CATALOG_CATEGORIES = [
  'Files',
  'Shell',
  'Search',
  'Agent',
  'Browser',
  'Devices',
  'Media',
  'SuperOne',
  'States',
] as const

export type ToolCatalogCategory = typeof TOOL_CATALOG_CATEGORIES[number]

export interface ToolCatalogExample {
  id: string
  title: string
  category: ToolCatalogCategory
  blocks: ContentBlock[]
}

type ToolMeta = Partial<Omit<Extract<ContentBlock, { type: 'tool_use' }>, 'type' | 'toolName' | 'toolUseId' | 'input'>>

let seq = 0

/** Build a tool_use block the way `stripContentBlock` would hand it to a remote surface. */
function toolUse(toolName: string, input: Record<string, unknown>, meta: ToolMeta = {}): ContentBlock {
  seq += 1
  return {
    type: remoteToolBlockType(toolName),
    toolName,
    toolUseId: `catalog-${seq}`,
    input: sanitizeRemoteToolInput(toolName, JSON.stringify(input)),
    status: 'complete',
    ...meta,
  } as ContentBlock
}

function result(toolUseId: string, summary: string, isError = false): ContentBlock {
  return { type: 'tool_result', toolUseId, summary, isError } as ContentBlock
}

/** A tool call plus its matching result, sharing the id the reducer pairs them by. */
function call(
  toolName: string,
  input: Record<string, unknown>,
  output?: string,
  meta: ToolMeta = {},
  isError = false,
): ContentBlock[] {
  const block = toolUse(toolName, input, meta)
  const id = (block as { toolUseId: string }).toolUseId
  return output === undefined ? [block] : [block, result(id, output, isError)]
}

function example(
  id: string,
  category: ToolCatalogCategory,
  title: string,
  blocks: ContentBlock[],
): ToolCatalogExample {
  return { id, category, title, blocks }
}

export const toolCatalogExamples: ToolCatalogExample[] = [
  // Files
  example('files/read', 'Files', 'Read', call(
    'Read',
    { file_path: '/workspace/super-one/apps/mobile/src/screens/chat-screen.tsx', offset: 20, limit: 40 },
    'export function ChatScreen(props: ChatScreenProps) {\n  const { tokens } = useMobileTheme()\n  …',
    { toolFilePath: 'apps/mobile/src/screens/chat-screen.tsx', toolSummary: 'chat-screen.tsx (L20–59)' },
  )),
  example('files/read-streaming', 'Files', 'Read · streaming', call(
    'Read',
    { file_path: '/workspace/super-one/packages/chat-view/src/ChatView.tsx' },
    undefined,
    { status: 'streaming', elapsedSeconds: 3, toolFilePath: 'packages/chat-view/src/ChatView.tsx' },
  )),
  example('files/edit', 'Files', 'Edit · diff', call(
    'Edit',
    { file_path: '/workspace/super-one/apps/mobile/src/config.ts', old_string: 'const previewEnabled = false', new_string: 'const previewEnabled = true' },
    'Applied 1 edit.',
    {
      toolFilePath: 'apps/mobile/src/config.ts',
      toolDiff: '-const previewEnabled = false\n+const previewEnabled = true',
      toolLineDelta: { added: 1, removed: 1 },
      toolDiffTokens: {
        added: [[['const previewEnabled = ', null], ['true', '#d19a66']]],
        removed: [[['const previewEnabled = ', null], ['false', '#d19a66']]],
      },
    },
  )),
  example('files/write', 'Files', 'Write · new file', call(
    'Write',
    { file_path: '/workspace/super-one/docs/mobile-catalog.md', content: '# Tool catalog\n\nEvery row the phone can draw.\n' },
    'File written.',
    {
      toolFilePath: 'docs/mobile-catalog.md',
      toolDiff: '+# Tool catalog\n+\n+Every row the phone can draw.',
      toolLineDelta: { added: 3, removed: 0 },
    },
  )),
  example('files/file-change', 'Files', 'FileChange · unified patch', call(
    'FileChange',
    { file_path: '/workspace/super-one/packages/shared/src/remote-tool-input.ts', kind: 'modify', diff: '' },
    undefined,
    {
      toolFilePath: 'packages/shared/src/remote-tool-input.ts',
      toolDiff: '@@ -12,3 +12,4 @@\n export function shouldKeepRemoteToolInput(toolName: string): boolean {\n-  return REMOTE_TOOL_INPUT_NAMES.has(toolName)\n+  return REMOTE_TOOL_INPUT_NAMES.has(toolName)\n+    || REMOTE_TOOL_INPUT_SUFFIXES.some((suffix) => toolName.endsWith(suffix))',
      toolLineDelta: { added: 2, removed: 1 },
    },
  )),
  example('files/notebook-edit', 'Files', 'NotebookEdit', call(
    'NotebookEdit',
    { notebook_path: '/workspace/analysis/latency.ipynb', new_source: 'df.describe()' },
    'Cell replaced.',
    { toolFilePath: 'analysis/latency.ipynb' },
  )),

  // Shell
  example('shell/bash', 'Shell', 'Bash · terminal', call(
    'Bash',
    { command: 'bun run typecheck', description: 'Type check every workspace' },
    '[32m$[0m bun run typecheck\n@superone/shared typecheck: Exited with code 0\n@superone/chat-view typecheck: Exited with code 0\n@superone/mobile typecheck: Exited with code 0',
    { toolSummary: 'Type check every workspace' },
  )),
  example('shell/bash-streaming', 'Shell', 'Bash · running', call(
    'Bash',
    { command: 'bunx vitest run --changed HEAD', timeout: 600000 },
    undefined,
    { status: 'streaming', elapsedSeconds: 12, toolSummary: 'bunx vitest run --changed HEAD' },
  )),
  example('shell/bash-failed', 'Shell', 'Bash · failed', call(
    'Bash',
    { command: 'bun run build' },
    '[32m$[0m bun run build\n[31merror[0m: Cannot find module \'./generated-host-html\'\nExited with code 1',
    { toolSummary: 'bun run build' },
    true,
  )),
  example('shell/bash-background', 'Shell', 'Bash · background', call(
    'Bash',
    { command: 'bun run dev', run_in_background: true, description: 'Start the desktop app' },
    'Started in the background.',
    { toolSummary: 'Start the desktop app', runInBackground: true },
  )),

  // Search
  example('search/grep', 'Search', 'Grep', call(
    'Grep',
    { pattern: 'sanitizeRemoteToolInput', path: '/workspace/super-one/packages' },
    'packages/shared/src/remote-tool-input.ts:214\npackages/chat-view/src/fixtures/tool-catalog.ts:1',
    { toolSummary: 'sanitizeRemoteToolInput in packages' },
  )),
  example('search/glob', 'Search', 'Glob', call(
    'Glob',
    { pattern: '**/*.stories.tsx', path: '/workspace/super-one/apps/desktop' },
    '53 files',
    { toolSummary: '**/*.stories.tsx' },
  )),
  example('search/ls', 'Search', 'LS · scrollable output', call(
    'LS',
    { path: '/workspace/super-one/packages/chat-view/src/presenters' },
    Array.from({ length: 24 }, (_, i) => `presenter-${String(i + 1).padStart(2, '0')}.tsx`).join('\n'),
    { toolSummary: 'packages/chat-view/src/presenters' },
  )),
  example('search/web-search', 'Search', 'WebSearch', call(
    'WebSearch',
    { query: 'react native webview performance' },
    'Found 8 results.',
    { toolSummary: 'react native webview performance' },
  )),
  example('search/web-fetch', 'Search', 'WebFetch', call(
    'WebFetch',
    { url: 'https://docs.expo.dev/versions/latest/sdk/webview/', prompt: 'summarize the API' },
    'The WebView component renders web content in a native view…',
    { toolSummary: 'https://docs.expo.dev/versions/latest/sdk/webview/' },
  )),

  // Agent
  example('agent/skill', 'Agent', 'Skill', call(
    'Skill',
    { skill: 'release', args: 'alpha patch' },
    'Skill loaded.',
  )),
  example('agent/task', 'Agent', 'Task · subagent', call(
    'Task',
    { name: 'Explore', subagent_type: 'Explore', description: 'Find every tool presenter', prompt: 'Locate all tool presenters in chat-view.' },
    'Found 47 presenters under packages/chat-view/src/presenters.',
    { toolSummary: 'Find every tool presenter' },
  )),
  example('agent/ask-user-question', 'Agent', 'AskUserQuestion', call(
    'AskUserQuestion',
    {
      questions: [{
        header: 'Entry',
        question: 'Where should the catalog live?',
        options: [{ label: 'Preview mode' }, { label: 'Developer screen' }],
      }],
    },
    'Q: Where should the catalog live?\nA: Preview mode',
  )),
  example('agent/report-findings', 'Agent', 'ReportFindings', call(
    'ReportFindings',
    {
      findings: [{
        file: 'packages/chat-view/src/PortableToolRow.tsx',
        line: 118,
        summary: 'A mini-app projection without an appId renders an empty row.',
        failure_scenario: 'The card component returns null, so the row disappears instead of falling back.',
        short_summary: 'Empty row when identity is missing',
        category: 'correctness',
        verdict: 'CONFIRMED',
      }],
    },
    'Reported 1 finding.',
  )),
  example('agent/exit-plan-mode', 'Agent', 'ExitPlanMode', call(
    'ExitPlanMode',
    { plan: '1. Share the row\n2. Wire the ports' },
    'Plan approved.',
  )),
  example('agent/list-agents', 'Agent', 'ListAgents', call(
    'ListAgents',
    {},
    'Subagents (2):\n  Explore · read-only search · idle · 2m\n  Plan · architecture · idle · 5m',
  )),

  // Browser
  example('browser/snapshot', 'Browser', 'browser_snapshot', call(
    'mcp__superone__browser_snapshot',
    { include: ['screenshot'], description: 'Capture the docs landing page', selector: '#private' },
    JSON.stringify({ ok: true }),
  )),
  example('browser/act', 'Browser', 'browser_act', call(
    'mcp__superone__browser_act',
    {
      description: 'Sign in and open settings',
      actions: [
        { type: 'type', selector: '#email', text: 'someone@example.com' },
        { type: 'click', selector: '#submit' },
      ],
    },
    JSON.stringify({ ok: true }),
  )),
  example('browser/query', 'Browser', 'browser_query', call(
    'mcp__superone__browser_query',
    { op: 'text', selector: 'main', description: 'Read the page body' },
    'SuperOne — every coding agent on one surface.',
  )),
  example('browser/tools-call', 'Browser', 'browser_tools_call · WebMCP', call(
    'mcp__superone__browser_tools_call',
    { name: 'add_to_cart', description: 'Add the item to the cart', input: { sku: 'A-1' } },
    JSON.stringify({ ok: true }),
    { toolSummary: 'Add the item to the cart' },
  )),

  // Devices
  example('devices/snapshot', 'Devices', 'device_snapshot', call(
    'mcp__superone__device_snapshot',
    { mode: 'semantic', description: 'Read the login screen', device: 'ios:427A175E' },
    JSON.stringify({ ok: true }),
  )),
  example('devices/act', 'Devices', 'device_act', call(
    'mcp__superone__device_act',
    {
      description: 'Fill the login form',
      actions: [{ type: 'tap', ref: 'email' }, { type: 'type', text: 'secret' }],
    },
    JSON.stringify({ ok: true }),
  )),
  example('devices/computer-query', 'Devices', 'computer_query', call(
    'mcp__superone__computer_query',
    { op: 'search', text: 'private customer', description: 'Find the record' },
    JSON.stringify({ ok: true }),
  )),

  // Media
  example('media/generate-image', 'Media', 'media_generate_image', call(
    'mcp__superone__media_generate_image',
    { prompt: 'A calm terminal window at dusk, isometric, muted palette', count: 1 },
    JSON.stringify({ ok: true, images: [] }),
  )),
  example('media/generate-video', 'Media', 'media_generate_video', call(
    'mcp__superone__media_generate_video',
    { prompt: 'A slow pan across a desk with two phones mirroring a laptop', durationSeconds: 5 },
    JSON.stringify({ ok: true, taskId: 'vid-1' }),
  )),
  example('media/list-providers', 'Media', 'media_list_providers', call(
    'mcp__superone__media_list_providers',
    {},
    JSON.stringify({ providers: [{ id: 'openai', label: 'OpenAI', kinds: ['image'] }] }),
  )),

  // SuperOne
  example('superone/miniapp-call', 'SuperOne', 'miniapp_call · app card', call(
    'mcp__superone__miniapp_call',
    { appId: 'notes', tool: 'create_note', input: { body: 'private note body' } },
    JSON.stringify({ ok: true, noteId: 'n-42' }),
  )),
  example('superone/config-apply', 'SuperOne', 'config_apply', call(
    'mcp__superone__config_apply',
    { resource: { operation: 'update', recordId: 'provider-1' }, changes: [{ key: 'token', value: 'secret' }] },
    JSON.stringify({ ok: true }),
  )),
  example('superone/session-collab-send', 'SuperOne', 'session_collab_send', call(
    'mcp__superone__session_collab_send',
    { content: 'The rebase is done — main is at 4ff6b314.', to: 'peer-1' },
    JSON.stringify({ ok: true }),
  )),
  example('superone/automation-apply', 'SuperOne', 'automation_apply', call(
    'mcp__superone__automation_apply',
    { action: 'update', name: 'Daily review', enabled: true, prompt: 'private prompt' },
    JSON.stringify({ ok: true }),
  )),
  example('superone/session-cleanup', 'SuperOne', 'session_cleanup', call(
    'mcp__superone__session_cleanup',
    { action: 'delete', sessionIds: ['s-1', 's-2'] },
    JSON.stringify({ ok: true, deleted: 2 }),
  )),
  example('superone/mcp-generic', 'SuperOne', 'Third-party MCP tool', call(
    'mcp__context7__query-docs',
    { library: 'expo', question: 'How do I configure a dev client?' },
    'Expo dev clients are configured through `expo-dev-client`…',
  )),

  // States
  example('states/denied', 'States', 'Denied', call(
    'Read',
    { file_path: '/workspace/secrets/.env' },
    '[denied] The user does not want you to read credential files.',
    { toolFilePath: 'secrets/.env' },
  )),
  example('states/error', 'States', 'Errored', call(
    'Grep',
    { pattern: '(', path: '/workspace/super-one' },
    'Error: invalid regular expression: missing closing parenthesis',
    { toolSummary: '( in super-one' },
    true,
  )),
  example('states/unknown-tool', 'States', 'Unknown tool · generic row', call(
    'SomeFutureTool',
    { anything: 'the row falls back to the wrench header' },
    'Done.',
  )),
]

/** One assistant turn per example, titled so the catalog labels itself in the transcript. */
export function toolCatalogMessages(category?: ToolCatalogCategory): ChatMessage[] {
  const picked = category ? toolCatalogExamples.filter((item) => item.category === category) : toolCatalogExamples
  return picked.map((item) => ({
    id: `catalog-${item.id}`,
    role: 'assistant',
    // A settled turn seals its tool rows, so a streaming example has to sit in a
    // streaming turn or it renders as the completed row instead.
    status: item.blocks.some((block) => 'status' in block && block.status === 'streaming')
      ? 'streaming'
      : 'complete',
    createdAt: '2026-01-01T00:00:00.000Z',
    providerId: 'claude',
    content: [
      { type: 'text', text: `**${item.title}** · \`${item.id}\`` } as ContentBlock,
      ...item.blocks,
    ],
  }))
}
