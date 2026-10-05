import { parseSchemaForm } from '@superone/shared/schema-form'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { elicitationFormRequest } from '@superone/shared/schema-form'

const SWATCHES = [
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGPgW/qSJMQwqmFUw/DVAAAs+pwQl/3XWgAAAABJRU5ErkJggg==',
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGP4WSxGEmIY1TCqYfhqAAAYwIIQghBcrQAAAABJRU5ErkJggg==',
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGNQOhpHEmIY1TCqYfhqAACML0UQHuDXpwAAAABJRU5ErkJggg==',
]
const swatch = (index: number) => `data:image/png;base64,${SWATCHES[index]}`

type PermissionKind = NonNullable<PermissionRequest['requestKind']>
type PermissionExample = Omit<PermissionRequest, 'requestId' | 'allowAlwaysAllow'> & {
  allowAlwaysAllow?: boolean
}

// Exhaustive by protocol kind: a new native confirmation needs a preview too.
export const permissionExamples = {
  // An OpenAI extended form through the shared parser, as Codex delivers it.
  mcp_elicitation: {
    toolName: 'bits-and-bolts', input: {},
    serverName: 'Bits & Bolts', message: 'Review a CAD reference',
    ...elicitationFormRequest({
      type: 'object',
      required: ['reference', 'part', 'priority'],
      properties: {
        reference: { type: 'string', title: 'CAD or file URI', format: 'uri', pattern: '^(cad|file):' },
        part: { type: 'string', title: 'CAD part', oneOf: [
          { const: 'hex-bolt', title: 'M6 hex bolt', description: 'Main joint', 'x-openai-thumbnail': { src: swatch(0) } },
          { const: 'washer', title: 'M6 washer', 'x-openai-thumbnail': { src: swatch(1) } },
          { const: 'bracket', title: 'L-bracket, 40 mm', 'x-openai-thumbnail': { src: swatch(2) } },
          { const: 'spacer', title: 'Nylon spacer' },
        ] },
        priority: { type: 'string', title: 'Priority', oneOf: [
          { const: 'normal', title: 'Normal', description: 'Review this week.' },
          { const: 'high', title: 'High', description: 'Blocks the next build.' },
        ], default: 'normal' },
        tolerance: { type: 'number', title: 'Tolerance (mm)', minimum: 0, maximum: 10 },
        approved: { type: 'boolean', title: 'Approved' },
        accessories: { type: 'array', title: 'Accessories', items: { type: 'string', 'x-openai-suggestions': [{ const: 'washer', title: 'M6 washer' }, { const: 'nut', title: 'M6 nut' }] } },
        references: {
          type: 'array', title: 'CAD references', items: { type: 'string', format: 'uri' },
          'x-openai-input': { type: 'resource', selection: 'explicit', options: [
            { uri: 'cad://parts/hex-bolt', name: 'hex-bolt.stl', title: 'M6 hex bolt', size: 48213, _meta: { 'openai/thumbnail': { src: swatch(0) } } },
            { uri: 'cad://parts/washer', name: 'washer.step', title: 'M6 washer', size: 9120 },
          ] },
          default: ['cad://parts/washer'],
        },
      },
    }),
  },
  video_gen_confirm: {
    toolName: 'mcp__superone__media_generate_video', input: {},
    videoGenConfirm: {
      params: { prompt: 'A quiet mountain lake at sunrise, with soft reflections and a slow camera orbit.', provider: 'Preview provider', model: 'Preview model', aspectRatio: '16:9', resolution: '720p', duration: 5, generateAudio: false, watermark: false, cameraFixed: false },
      providers: [{ id: 'Preview provider', label: 'Preview provider', models: [{ id: 'Preview model', label: 'Preview model' }, { id: 'Preview fast', label: 'Preview fast' }], aspectRatios: ['16:9', '9:16', '1:1'], resolutions: ['720p', '1080p'] }], referenceImages: [],
    },
  },
  config_confirm: {
    toolName: 'mcp__superone__config_apply', input: {},
    configConfirm: { fields: [
      { key: 'theme', domain: 'app', label: 'Theme', type: 'enum', enumValues: ['system', 'light', 'dark'], currentValue: 'dark', proposedValue: 'light' },
      { key: 'previewCredential', domain: 'provider', label: 'API key', type: 'string', secret: true, currentValue: 'example-old', proposedValue: 'example-new' },
    ] },
  },
  session_agents_confirm: {
    toolName: 'mcp__superone__session_collab_request', input: {},
    sessionAgentsConfirm: {
      profiles: ['codex', 'claude'].map((harnessId) => ({ id: `preview-${harnessId}`, name: harnessId, harnessId: harnessId as 'codex' | 'claude', defaultConfig: {}, models: [{ id: 'Preview model', name: 'Preview model', serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Fast service tier' }] }, { id: 'Review model', name: 'Review model' }], efforts: ['low', 'medium', 'high'], apiProviders: [{ id: 'preview-api', name: 'Preview API' }] })),
      launches: [
        { launchId: 'preview-spawn', agentId: 'preview-codex', mode: 'spawn', name: 'Reviewer', role: 'Code review', summary: 'Review the mobile permission flow.', config: { model: 'Preview model', cwd: '/workspace/super-one', permissionMode: 'default' } },
        { launchId: 'preview-handoff', agentId: 'preview-claude', mode: 'handoff', name: 'Designer', role: 'Visual review', summary: 'Check layout and typography.', config: {} },
        { launchId: 'preview-link', agentId: '', mode: 'link', sessionId: 'preview-peer', peerTitle: 'Existing review session', name: 'Peer', role: 'Review', summary: 'Connect an existing review session.', config: {} },
      ],
    },
  },
  computer_use_grant: {
    toolName: 'mcp__superone__computer_snapshot', input: {}, allowAlwaysAllow: true,
    computerUseGrant: { app: 'Preview Browser', bundleId: 'com.example.preview', toolName: 'computer_snapshot' },
  },
  session_cleanup_confirm: {
    toolName: 'mcp__superone__session_cleanup', input: {},
    sessionCleanupConfirm: { sessions: Array.from({ length: 12 }, (_, index) => ({
      id: `preview-session-${index}`, title: index === 0 ? '移动端视觉对齐 — permission prompts and a deliberately long session title' : `Archived review ${index + 1}`,
      harness: index % 2 ? 'codex' : 'claude', messageCount: 24 + index,
    })) },
  },
  automation_confirm: {
    toolName: 'mcp__superone__automation_create', input: {},
    automationConfirm: { operation: 'create', items: [
      { name: 'Daily review', scheduleSummary: 'Every weekday at 09:00', enabled: true, agent: { type: 'codex', model: 'Preview model', permissionMode: 'default' }, promptPreview: 'Review open changes and summarize actionable findings.' },
    ] },
  },
  webmcp_trust_confirm: {
    toolName: 'mcp__superone__browser_page_tools', input: {}, allowAlwaysAllow: true,
    webmcpTrustConfirm: {
      origin: 'https://preview.example', reason: 'tool_changed', changedTools: ['create_issue'],
      tools: [
        { name: 'list_issues', title: 'List issues', description: 'Read issues in the selected project.', annotations: { readOnlyHint: true } },
        { name: 'create_issue', title: 'Create issue', description: 'Create an issue and notify subscribers.', annotations: { readOnlyHint: false }, changed: true },
      ],
    },
  },
  device_control_confirm: {
    toolName: 'mcp__superone__device_request_control', allowAlwaysAllow: true,
    input: { device: 'Preview iPhone', platform: 'iOS', description: 'Inspect the current screen and interact with this device during the session.' },
  },
  terminal_command_confirm: {
    toolName: 'mcp__superone__terminal_tabs', allowAlwaysAllow: true,
    input: { action: 'run', command: 'bun run storybook --ci', cwd: '/Users/me/app', rule: 'bun run storybook( .*)?', description: 'Start Storybook to check the new story.' },
  },
  input_request: {
    toolName: 'superone_input_request', input: {}, message: 'Review notes',
    inputRequest: { title: 'Review notes', description: 'Add context before the next change.', origin: { kind: 'agent' }, output: 'caller' },
    schemaForm: parseSchemaForm({ type: 'object', required: ['notes'], properties: { notes: { type: 'string', title: 'Notes' } } }),
  },
  folder_trust: {
    toolName: 'FolderTrust',
    input: { cwd: '/Users/me/app/packages/web', workspace: '/Users/me/app', configKinds: ['rules', 'mcp', 'hooks', 'skills'] },
  },
} satisfies Record<PermissionKind, PermissionExample>

export function permissionRequest(kind: PermissionKind): PermissionRequest {
  return { requestId: `preview-${kind}`, allowAlwaysAllow: false, ...permissionExamples[kind], requestKind: kind }
}

export const ordinaryPermission: PermissionRequest = {
  requestId: 'preview-command', toolName: 'Bash', input: { command: 'bun run typecheck', description: 'Check mobile TypeScript types' },
  allowAlwaysAllow: true, decisionReason: 'This command needs your approval before it can run.',
  suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'bun run typecheck' }], destination: 'session' }],
}
