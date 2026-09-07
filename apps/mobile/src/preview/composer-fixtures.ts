import type { MentionItem } from '../mentions'
import type { SlashCommandInfo } from '../slash'

/**
 * Catalogs the composer overlays run against in the offline preview.
 *
 * They are deliberately awkward: a skill that outranks every command, an
 * argument hint long enough to collide with the command name, a CJK filename,
 * and a description that has to wrap. A tidy fixture would let a layout bug
 * ship — the states worth reviewing are the ones a healthy session never
 * produces.
 *
 * The preview feeds these through the real `filterSlashCommands` and the real
 * row components, never through a copy.
 */
export const previewSlashCatalog: SlashCommandInfo[] = [
  { name: 'clear', description: 'Clear the conversation and start over', argumentHint: '', isSkill: false },
  { name: 'compact', description: 'Summarise the conversation to reclaim context', argumentHint: '[instructions]', isSkill: false },
  { name: 'add-dir', description: 'Give the session another project directory', argumentHint: '[project|session] [dir]', isSkill: false },
  { name: 'review', description: 'Review the current diff for correctness and cleanups', argumentHint: '', isSkill: false },
  // Exists so one query can score a skill above every command: `/rel` matches
  // this only mid-word, while the `release` skill matches from index 0. The
  // overlay must then lead with Skills — this row is what proves it does.
  { name: 'create-release-notes', description: 'Draft release notes from the commit range', argumentHint: '', isSkill: false },
  { name: 'resume', description: '', argumentHint: '', isSkill: false },
  {
    name: 'release',
    description: 'Version bump, per-platform build, npm publish, promote artifacts and publish the release',
    argumentHint: '[alpha|stable] [major|feature|patch]',
    isSkill: true,
  },
  { name: 'tdd', description: 'Test-driven development workflow', isSkill: true, argumentHint: '' },
  { name: 'wiki', description: '为文件、模块、特性或整个仓库创建或更新 wiki 文档', isSkill: true, argumentHint: '' },
]

/** What the host returns: files, project agents, mini-apps, desktop apps. */
export const previewMentionItems: MentionItem[] = [
  { kind: 'agent', path: 'reviewer', label: 'reviewer', description: 'claude-opus-5' },
  { kind: 'session', path: 'sess-7f3c', label: 'Align the mention popup with desktop', description: 'super-one' },
  { kind: 'miniapp', path: 'board', label: 'Board', description: 'Kanban mini-app' },
  { kind: 'desktop-app', path: 'com.apple.Safari', label: 'Safari', description: 'com.apple.Safari' },
  { kind: 'directory', path: 'src/renderer/src/components', isDirectory: true, matchIndices: [17, 18, 19] },
  { kind: 'file', path: 'src/ui/composer-suggestions.tsx', matchIndices: [7, 8, 9] },
  { kind: 'file', path: 'docs/设计/移动端组合器说明.md' },
]

/** Launchable identities, which arrive on a separate response field. */
export const previewAgentProfiles: MentionItem[] = [
  { kind: 'agent-profile', path: 'codex-base', label: 'Codex', description: '@codex', aliases: ['gpt'] },
  { kind: 'agent-profile', path: 'claude-base', label: 'Claude', description: '@claude', aliases: [] },
]

/** Only these are switched on, so the rest render disabled rather than absent. */
export const previewCapabilityIds = ['widget', 'debug']

/** Long enough that both the label and the second line have to truncate. */
export const previewLongMentionItems: MentionItem[] = [
  {
    kind: 'file',
    path: 'apps/mobile/src/navigation/use-composer-suggestions-with-a-very-long-name.ts',
    label: 'use-composer-suggestions-with-a-very-long-name.ts',
    description: 'apps/mobile/src/navigation/use-composer-suggestions-with-a-very-long-name.ts',
  },
  { kind: 'file', path: 'no-label-so-the-basename-is-derived/from/the/path/report.md' },
]
