import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactElement } from 'react'
import { en } from '../../../packages/shared/src/i18n/en'
const permissionListPath = '../../../apps/desktop/src/renderer/src/components/chat/PermissionModeList'
const { modes } = await import(permissionListPath) as { modes: { id: keyof typeof en.chat.permissionModes; icon: unknown; color: string }[] }
import { cursorPermissionModeOptions } from '../../../apps/desktop/src/renderer/src/components/chat/CursorPermissionModeList'
import { acpPermissionModeOptions } from '../../../apps/desktop/src/renderer/src/components/chat/AcpPermissionModeList'
import { codexPermissionPresetOptions } from '../../../apps/desktop/src/renderer/src/components/chat/CodexPermissionPresetList'
import { hex, parseOklch } from './color-tokens'

const theme = readFileSync(resolve(import.meta.dirname, '../../../node_modules/tailwindcss/theme.css'), 'utf8')
const iconName = (icon: unknown) => ((icon as ReactElement).type as unknown as { displayName: string }).displayName
function color(classes: string, dark: boolean) {
  const choices = classes.split(' ')
  const selected = (dark ? choices.find((name) => name.startsWith('dark:text-')) : undefined) ?? choices.find((name) => name.startsWith('text-'))!
  const name = selected.replace(/^(dark:)?text-/, '')
  if (!/^(blue|amber|purple|orange)-\d+$/.test(name)) return `$${name === 'muted-foreground' ? 'mutedForeground' : name}`
  return hex(parseOklch(theme, `color-${name}`))
}
function entry(id: string, copy: { label: string; description: string }, icon: string, tone: string, triggerIcon = icon) {
  return { id, ...copy, icon, triggerIcon, light: color(tone, false), dark: color(tone, true) }
}
const claude = modes.map((mode) => entry(mode.id, en.chat.permissionModes[mode.id], iconName(mode.icon), mode.color))
const acp = acpPermissionModeOptions.map((mode) => entry(mode.id, en.chat.acpPermissionModes[mode.labelKey], iconName(mode.icon), mode.color))
const cursor = cursorPermissionModeOptions.map((mode) => entry(mode.id, en.chat.cursorPermissionModes[mode.labelKey], iconName(mode.icon), mode.color))
const codex = codexPermissionPresetOptions.map((mode) => entry(mode.id, {
  label: en.resources.automation[mode.labelKey.split('.').at(-1)! as keyof typeof en.resources.automation] as string,
  description: en.resources.automation[mode.descriptionKey.split('.').at(-1)! as keyof typeof en.resources.automation] as string,
}, iconName(mode.icon), mode.triggerToneClass, iconName(mode.triggerIcon)))
// DeepSeek's renderer attaches these three marks in DeepseekPermissionSelector.
const dsh = [
  entry('plan', en.chat.deepseekPermissionPresets.readOnly, 'Eye', 'text-blue-600 dark:text-blue-400'),
  entry('default', en.chat.deepseekPermissionPresets.workspaceWrite, 'ShieldCheck', 'text-muted-foreground'),
  entry('bypassPermissions', en.chat.deepseekPermissionPresets.fullAccess, 'ShieldOff', 'text-destructive'),
]
const output = `${JSON.stringify({ claude, opencode: claude.filter((mode) => mode.id !== 'auto'), acp, cursor, codex, dsh }, null, 2)}\n`
const target = resolve(import.meta.dirname, '../src/ui/permission-modes.generated.json')
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('Permission presentation is stale. Run generate-permission-modes.ts')
} else writeFileSync(target, output)
console.log('Generated permission labels, descriptions, icons and tones for all harnesses')
