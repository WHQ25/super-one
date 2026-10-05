import type { PermissionRequest, PlanApprovalRequest } from '@superone/shared/agent-types'
import { elicitationFormRequest, parseSchemaForm } from '@superone/shared/schema-form'
import { ordinaryPermission, permissionExamples, permissionRequest } from './permissions'

type ScenarioMeta = { id: string; title: string; description: string }
export type NativeScenario = ScenarioMeta & (
  | { category: 'Permissions'; request: PermissionRequest }
  | { category: 'Plans'; request: PlanApprovalRequest; continueMode?: 'auto' | 'acceptEdits' }
  | { category: 'Input forms'; request: PermissionRequest; behavior?: 'retry' | 'pending' | 'offline' | 'upload-failed' }
)

const plan: PlanApprovalRequest = {
  requestId: 'preview-plan', planFilePath: '/workspace/docs/mobile-preview-plan.md',
  planContent: '# Native preview\n\n1. Render the existing native sheets.\n2. Add deterministic scenarios.\n3. Verify approval and rejection callbacks.\n\nNo desktop connection is required.\n\n## Acceptance\n\n- [x] Offline fixtures\n- [ ] Native review\n\n**Approval** and `rejection` must remain distinct.\n\n| Surface | Expected |\n| --- | --- |\n| Permission | Command and diff |\n| Plan | Rendered Markdown |',
  allowedPrompts: [{ tool: 'Bash', prompt: 'Run the scoped mobile type check' }],
}

export const nativeScenarios: NativeScenario[] = [
  { id: 'permission/command', category: 'Permissions', title: 'Command approval', description: 'Allow, always allow, suggestions, and rejection feedback.', request: ordinaryPermission },
  { id: 'permission/blocked-path', category: 'Permissions', title: 'Blocked path / long content', description: 'Long remote paths and mixed Chinese / English content.', request: {
    ...ordinaryPermission, requestId: 'preview-blocked-path', toolName: 'Read', allowAlwaysAllow: false, suggestions: [], decisionReason: undefined,
    blockedPath: '/workspace/移动端迁移/design-references/permission-prompts/very-long-directory-name/native-preview-comparison.md',
    input: { file_path: '/workspace/移动端迁移/design-references/permission-prompts/very-long-directory-name/native-preview-comparison.md' },
  } },
  { id: 'permission/edit-diff', category: 'Permissions', title: 'Edit file / diff', description: 'File identity, line changes, and source-aligned syntax tokens, line numbers, and diff expansion.', request: {
    requestId: 'preview-edit-diff', toolName: 'Edit', allowAlwaysAllow: false,
    input: { file_path: '/workspace/super-one/apps/mobile/src/config.ts', old_string: 'const previewEnabled = false', new_string: 'const previewEnabled = true' },
    toolDiff: '@@ -1,3 +1,3 @@\n export const settings = {\n-  previewEnabled: false,\n+  previewEnabled: true,\n }', toolLineDelta: { added: 1, removed: 1 },
    toolDiffTokens: { added: [[['export const ', '#c678dd'], ['settings = {', null]], [['  previewEnabled: ', null], ['true', '#d19a66'], [',', null]], [['}', null]]], removed: [[['export const ', '#c678dd'], ['settings = {', null]], [['  previewEnabled: ', null], ['false', '#d19a66'], [',', null]], [['}', null]]] },
    suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
  } },
  { id: 'permission/sandbox', category: 'Permissions', title: 'Sandbox override', description: 'Command, reason, and semantic warning.', request: {
    ...ordinaryPermission, requestId: 'preview-sandbox', suggestions: [], input: { command: 'bun run test:mobile', dangerouslyDisableSandbox: true, description: 'The local test server needs to bind a loopback port.' },
  } },
  { id: 'permission/network', category: 'Permissions', title: 'Network permission', description: 'Requested host and reason.', request: {
    ...ordinaryPermission, requestId: 'preview-network', toolName: 'SandboxNetworkAccess', suggestions: [], input: { host: 'registry.npmjs.org' }, decisionReason: 'Download the package required by this project.',
  } },
  ...Object.keys(permissionExamples).filter(key => key !== 'input_request').map((key): NativeScenario => {
    const kind = key as NonNullable<PermissionRequest['requestKind']>
    return { id: `permission/${kind}`, category: 'Permissions', title: kind.replaceAll('_', ' '), description: `Production PermissionSheet · ${kind}`, request: permissionRequest(kind) }
  }),
  ...(['default', 'retry', 'pending', 'offline'] as const).map((behavior): NativeScenario => ({
    id: `input/${behavior}`, category: 'Input forms', title: `Composer form · ${behavior}`, description: 'Native composer-slot form with growing text and an explicit submit action.',
    request: permissionRequest('input_request'), ...(behavior === 'default' ? {} : { behavior }),
  })),
  { id: 'input/files', category: 'Input forms', title: 'Widget file upload', description: 'Upload a file bound to this form; submit sends a user message.', request: {
    ...permissionRequest('input_request'), inputRequest: { title: 'Attach a reference', output: 'agent', origin: { kind: 'widget', messageId: 'preview-widget' } },
    schemaForm: parseSchemaForm({ type: 'object', properties: { files: { type: 'array', title: 'Reference files', items: { type: 'string', format: 'uri' }, 'x-openai-input': { type: 'file', options: [], userOptions: { kind: 'file' } } } } }, { userResources: true }),
  } },
  { id: 'input/upload-failed', category: 'Input forms', title: 'Upload failure', description: 'A failed upload leaves the form editable.', behavior: 'upload-failed', request: {
    ...permissionRequest('input_request'), schemaForm: parseSchemaForm({ type: 'object', properties: { files: { type: 'array', items: { type: 'string', format: 'uri' }, 'x-openai-input': { type: 'file', options: [], userOptions: { kind: 'file' } } } } }, { userResources: true }),
  } },
  { id: 'input/unsupported-directory', category: 'Input forms', title: 'Unsupported directory', description: 'The phone explains the capability boundary and allows cancellation.', request: {
    ...permissionRequest('input_request'), schemaForm: parseSchemaForm({ type: 'object', properties: { directory: { type: 'string', 'x-openai-input': { type: 'file', options: [], userOptions: { kind: 'directory' } } } } }, { userResources: true }),
  } },
  { id: 'permission/mcp-form-unsupported', category: 'Permissions', title: 'Unsupported form', description: 'A form with an input the phone cannot render is reported, never partially shown.', request: {
    requestId: 'preview-form-unsupported', toolName: 'bits-and-bolts', input: {}, allowAlwaysAllow: false, requestKind: 'mcp_elicitation', serverName: 'Bits & Bolts', message: 'Choose CAD references',
    ...elicitationFormRequest({ type: 'object', properties: { references: { type: 'array', items: { type: 'string', format: 'uri' }, 'x-openai-input': { type: 'resource', selection: 'implicit', options: [] } } } }),
  } },
  { id: 'permission/delete-config', category: 'Permissions', title: 'Delete configuration', description: 'Destructive resource confirmation.', request: {
    requestId: 'preview-delete-config', toolName: 'mcp__superone__config_apply', input: {}, allowAlwaysAllow: false, requestKind: 'config_confirm',
    configConfirm: { resource: { resource: 'provider', operation: 'delete', title: 'Preview provider', fields: [] } },
  } },
  { id: 'permission/delete-automation', category: 'Permissions', title: 'Delete automation', description: 'Destructive schedule confirmation.', request: {
    requestId: 'preview-delete-automation', toolName: 'mcp__superone__automation_delete', input: {}, allowAlwaysAllow: false, requestKind: 'automation_confirm',
    automationConfirm: { operation: 'delete', items: [{ name: 'Daily review', scheduleSummary: 'Every weekday at 09:00' }] },
  } },
  { id: 'plan/default', category: 'Plans', title: 'Plan approval', description: 'Approve, reject with feedback, or continue with accepted edits.', request: plan, continueMode: 'acceptEdits' },
  { id: 'plan/long', category: 'Plans', title: 'Long plan / auto continuation', description: 'Scroll a long plan and inspect the action footer.', continueMode: 'auto', request: {
    ...plan, requestId: 'preview-plan-long', planContent: `${plan.planContent}\n\n${Array.from({ length: 24 }, (_, index) => `## Check ${index + 1}\n\nVerify typography, spacing, and the visible action labels. 检查长内容滚动和按钮位置。`).join('\n\n')}`,
  } },
]
