import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { slashCommandKey, type MatchedSlashCommand } from '@superone/shared/slash-command-match'
import { HighlightedText } from '@superone/ui/components/ui/HighlightedText'
import { groupItems, PopupSectionHeader } from './popup-groups'

interface SlashCommandSuggestionsProps {
  commands: MatchedSlashCommand[]
  selectedIndex: number
  onSelect: (command: MatchedSlashCommand) => void
  itemRefs?: Map<number, HTMLButtonElement>
}

export function SlashCommandSuggestions({ commands, selectedIndex, onSelect, itemRefs }: SlashCommandSuggestionsProps) {
  const { t } = useTranslation()
  const groups = useMemo(() => {
    const groupKey = (command: MatchedSlashCommand) => command.isSkill ? 'skill' : 'command'
    const order = [...new Set(commands.map(groupKey))]
    return groupItems(commands, groupKey, order)
  }, [commands])

  return groups.map((group) => (
    <div key={group.key}>
      <PopupSectionHeader
        label={t(group.key === 'skill' ? 'chat.slashCommand.groupSkills' : 'chat.slashCommand.groupCommands')}
        count={group.items.length}
      />
      {group.items.map((cmd, j) => {
        const i = group.startIndex + j
        return (
          <button
            key={slashCommandKey(cmd)}
            ref={(el) => {
              if (el) itemRefs?.set(i, el)
              else itemRefs?.delete(i)
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              onSelect(cmd)
            }}
            className={`flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left text-xs transition-colors ${
              i === selectedIndex
                ? 'bg-primary/15 text-foreground'
                : 'text-foreground hover:bg-muted/40'
            }`}
          >
            <span className="flex min-w-0 items-center gap-1.5 font-medium">
              <HighlightedText
                text={`/${cmd.name}`}
                indices={[0, ...cmd.matchIndices.map((idx) => idx + 1)]}
                highlightClassName="text-highlighted font-semibold"
                className="shrink-0 whitespace-nowrap"
              />
              {cmd.argumentHint && (
                <span className="min-w-0 flex-1 truncate text-muted-foreground font-normal">{cmd.argumentHint}</span>
              )}
            </span>
            {cmd.description && (
              <span className="line-clamp-2 text-muted-foreground leading-snug">
                {cmd.description}
              </span>
            )}
          </button>
        )
      })}
    </div>
  ))
}
