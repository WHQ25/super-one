import { Trans, useTranslation } from 'react-i18next'
import type { TerminalCommandRuleScope } from '@superone/shared/terminal-command-rules'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { CheckCircle2, Circle } from 'lucide-react'
import { modes as permissionModes } from '../PermissionModeSelector'

/** The two lifetimes a terminal command rule can be remembered for; keys 1 and 2. */
const TERMINAL_RULE_SCOPES: ReadonlyArray<{ scope: TerminalCommandRuleScope; i18nKey: string; kbd: string }> = [
  { scope: 'session', i18nKey: 'chat.permission.terminal.allowRuleForSession', kbd: '1' },
  { scope: 'project', i18nKey: 'chat.permission.terminal.alwaysAllowRule', kbd: '2' },
]

const DEST_LABELS: Record<string, string> = {
  session: 'session',
  localSettings: 'folder',
  projectSettings: 'project',
  userSettings: 'all projects',
  cliArg: 'CLI',
}

function destLabel(destination: string): string {
  return DEST_LABELS[destination] ?? destination
}

function SuggestionContent({ s }: { s: Record<string, unknown> }) {
  const { t } = useTranslation()
  const type = s.type as string | undefined
  const destination = (s.destination as string) ?? 'session'
  const rules = s.rules as Array<{ toolName?: string; ruleContent?: string }> | undefined
  const directories = s.directories as string[] | undefined

  switch (type) {
    case 'addRules':
      return (
        <>
          Allow{' '}
          {rules?.map((r, i) => (
            <span key={i}>
              {i > 0 && ', '}
              <span className="font-medium">{r.toolName}</span>
              {r.ruleContent && <span className="text-muted-foreground">({r.ruleContent})</span>}
            </span>
          ))}
          {' '}for this {destLabel(destination)}
        </>
      )
    case 'setMode': {
      const mode = permissionModes.find((m) => m.id === s.mode)
      if (!mode) return <>Switch to {String(s.mode)}</>
      return (
        <>
          Switch to{' '}
          <span className={`inline-flex items-center gap-0.5 font-medium ${mode.color}`}>
            {mode.icon}
            {t(`chat.permissionModes.${mode.id}.label`)}
          </span>
        </>
      )
    }
    case 'addDirectories':
      return (
        <>
          Allow access to{' '}
          <span className="font-mono font-medium">{directories?.join(', ')}</span>
          {' '}for this {destLabel(destination)}
        </>
      )
    case 'replaceRules':
      return <>Replace {rules?.map((r) => [r.toolName, r.ruleContent].filter(Boolean).join(': ')).join(', ')}</>
    case 'removeRules':
      return <>Remove {rules?.map((r) => [r.toolName, r.ruleContent].filter(Boolean).join(': ')).join(', ')}</>
    case 'removeDirectories':
      return <>Remove directory: {directories?.join(', ')}</>
    default:
      return <>{JSON.stringify(s)}</>
  }
}

export function TerminalRuleRows({
  terminalRule,
  rememberRule,
  onToggle,
}: {
  terminalRule: string
  rememberRule: TerminalCommandRuleScope | null
  onToggle: (scope: TerminalCommandRuleScope) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-1.5">
      {TERMINAL_RULE_SCOPES.map(({ scope, i18nKey, kbd }) => {
        const isSelected = rememberRule === scope
        return (
          <button
            key={scope}
            type="button"
            aria-pressed={isSelected}
            className={`flex h-7 w-full cursor-pointer items-center gap-1.5 rounded border px-2.5 text-xs transition-colors ${
              isSelected
                ? 'border-success/50 bg-success/10 text-success hover:bg-success/20'
                : 'border-border text-muted-foreground hover:bg-success/10 hover:text-success'
            }`}
            onClick={() => onToggle(scope)}
          >
            {isSelected
              ? <CheckCircle2 className="size-3.5 shrink-0 text-success" />
              : <Circle className="size-3.5 shrink-0 text-muted-foreground/40" />}
            <span className="min-w-0 truncate">
              <Trans
                i18nKey={i18nKey}
                values={{ rule: terminalRule }}
                components={{ rule: <span className="font-mono font-medium" /> }}
              />
            </span>
            <Kbd variant="square" className="ml-auto">{kbd}</Kbd>
          </button>
        )
      })}
    </div>
  )
}

export function PermissionSuggestionRows({
  suggestions,
  selectedSuggestions,
  onToggle,
}: {
  suggestions: Array<Record<string, unknown>>
  selectedSuggestions: Set<number>
  onToggle: (idx: number) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-1.5">
      {suggestions.map((s, i) => {
        const isSelected = selectedSuggestions.has(i)
        const mode = s.type === 'setMode' ? permissionModes.find((m) => m.id === s.mode) : undefined
        return (
          <button
            key={i}
            type="button"
            className={`flex h-7 w-full cursor-pointer items-center gap-1.5 rounded border px-2.5 text-xs transition-colors ${
              isSelected
                ? (mode
                    ? `border-transparent ${mode.activeBg} ${mode.color}`
                    : 'border-success/50 bg-success/10 text-success hover:bg-success/20')
                : (mode
                    ? `border-border text-muted-foreground ${mode.hoverBg}`
                    : 'border-border text-muted-foreground hover:bg-success/10 hover:text-success')
            }`}
            onClick={() => onToggle(i)}
          >
            {isSelected
              ? <CheckCircle2 className={`size-3.5 shrink-0 ${mode ? '' : 'text-success'}`} />
              : <Circle className="size-3.5 shrink-0 text-muted-foreground/40" />}
            <span className="flex min-w-0 items-center gap-1 truncate"><SuggestionContent s={s} /></span>
            <Kbd variant="square" className="ml-auto">{i + 1}</Kbd>
          </button>
        )
      })}
    </div>
  )
}
