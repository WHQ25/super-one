import type { AskUserQuestionRequest, PermissionRequest, PlanApprovalRequest } from '@superone/shared/agent-types'
import { ordinaryPermission, permissionExamples, permissionRequest } from './permissions'

type ScenarioMeta = { id: string; title: string; description: string }
export type NativeScenario = ScenarioMeta & (
  | { category: 'Permissions'; request: PermissionRequest }
  | { category: 'Questions'; request: AskUserQuestionRequest }
  | { category: 'Plans'; request: PlanApprovalRequest; continueMode?: 'auto' | 'acceptEdits' }
)

const choice = {
  header: 'Layout', question: 'Which layout should we use?', multiSelect: false,
  options: [
    { label: 'Compact', description: 'Keep the conversation visible above the input.' },
    { label: 'Comfortable', description: 'Use more spacing between controls for easier reading.' },
  ],
}
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
  ...Object.keys(permissionExamples).map((key): NativeScenario => {
    const kind = key as NonNullable<PermissionRequest['requestKind']>
    return { id: `permission/${kind}`, category: 'Permissions', title: kind.replaceAll('_', ' '), description: `Production PermissionSheet · ${kind}`, request: permissionRequest(kind) }
  }),
  { id: 'permission/delete-config', category: 'Permissions', title: 'Delete configuration', description: 'Destructive resource confirmation.', request: {
    requestId: 'preview-delete-config', toolName: 'mcp__superone__config_apply', input: {}, allowAlwaysAllow: false, requestKind: 'config_confirm',
    configConfirm: { resource: { resource: 'provider', operation: 'delete', title: 'Preview provider', fields: [] } },
  } },
  { id: 'permission/delete-automation', category: 'Permissions', title: 'Delete automation', description: 'Destructive schedule confirmation.', request: {
    requestId: 'preview-delete-automation', toolName: 'mcp__superone__automation_delete', input: {}, allowAlwaysAllow: false, requestKind: 'automation_confirm',
    automationConfirm: { operation: 'delete', items: [{ name: 'Daily review', scheduleSummary: 'Every weekday at 09:00' }] },
  } },
  { id: 'question/single', category: 'Questions', title: 'Single choice', description: 'Selection, custom answer, submit, and dismiss.', request: { requestId: 'preview-question-single', questions: [choice] } },
  { id: 'question/multiple', category: 'Questions', title: 'Multiple questions / multi-select', description: 'Question tabs, completion markers, and multiple answers.', request: {
    requestId: 'preview-question-multiple', questions: [choice, { header: 'Platforms', question: 'Which platforms should be checked? / 检查哪些平台？', multiSelect: true, options: [
      { label: 'iOS', description: 'Phone and tablet safe areas.' }, { label: 'Android', description: 'Back button and keyboard behavior.' },
    ] }],
  } },
  { id: 'question/preview', category: 'Questions', title: 'Preview and notes', description: 'Option previews, default selection, and annotations.', request: {
    requestId: 'preview-question-notes', previewFormat: 'markdown', questions: [{ ...choice, options: choice.options.map((option) => ({ ...option, preview: `# ${option.label}\n\n${option.description}\n\nAdd a note to explain your preference.` })) }],
  } },
  { id: 'question/html-preview', category: 'Questions', title: 'HTML option preview', description: 'The production embedded preview WebView inside a native sheet.', request: {
    requestId: 'preview-question-html', previewFormat: 'html', questions: [{ ...choice, options: choice.options.map((option) => ({ ...option, preview: `<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><h2>${option.label}</h2><p>${option.description}</p></body></html>` })) }],
  } },
  { id: 'plan/default', category: 'Plans', title: 'Plan approval', description: 'Approve, reject with feedback, or continue with accepted edits.', request: plan, continueMode: 'acceptEdits' },
  { id: 'plan/long', category: 'Plans', title: 'Long plan / auto continuation', description: 'Scroll a long plan and inspect the action footer.', continueMode: 'auto', request: {
    ...plan, requestId: 'preview-plan-long', planContent: `${plan.planContent}\n\n${Array.from({ length: 24 }, (_, index) => `## Check ${index + 1}\n\nVerify typography, spacing, and the visible action labels. 检查长内容滚动和按钮位置。`).join('\n\n')}`,
  } },
]
