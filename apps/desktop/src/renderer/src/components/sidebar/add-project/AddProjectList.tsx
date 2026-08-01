import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { HighlightedText } from '@superone/ui/components/ui/HighlightedText'
import { PopupSectionHeader } from '@/components/chat/popup-groups'

export interface AddProjectListItem {
  key: string
  icon: ReactNode
  label: string
  /** Fuzzy-match positions to highlight, as produced by `fuzzyMatch`. */
  matchIndices?: number[]
  hint?: string
}

interface AddProjectListProps {
  sectionLabel: string
  items: AddProjectListItem[]
  selectedIndex: number
  onActivate: (index: number) => void
  onHover: (index: number) => void
}

/**
 * Keyboard-driven result list shared by every step of the add-project dialog —
 * same row shape as MentionPopup / AddDirPopup so the two feel like one system.
 */
export function AddProjectList({
  sectionLabel,
  items,
  selectedIndex,
  onActivate,
  onHover,
}: AddProjectListProps) {
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

  useEffect(() => {
    itemRefs.current.get(selectedIndex)?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, items.length])

  return (
    <>
      <PopupSectionHeader label={sectionLabel} count={items.length} />
      {items.map((item, index) => (
        <button
          key={item.key}
          ref={(el) => {
            if (el) itemRefs.current.set(index, el)
            else itemRefs.current.delete(index)
          }}
          type="button"
          // Keep focus in the input so typing never breaks mid-navigation.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onActivate(index)}
          onMouseEnter={() => onHover(index)}
          className={cn(
            'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
            index === selectedIndex
              ? 'bg-accent text-accent-foreground'
              : 'text-foreground hover:bg-accent/40',
          )}
        >
          <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
            {item.icon}
          </span>
          {/*
            Prefer the full label (repo name / folder name). Description/hint is
            secondary and absorbs overflow so long GitHub blurbs don't crush the name.
          */}
          <span className="shrink-0 font-medium whitespace-nowrap">
            {item.matchIndices && item.matchIndices.length > 0 ? (
              <HighlightedText text={item.label} indices={item.matchIndices} />
            ) : (
              item.label
            )}
          </span>
          {item.hint && (
            <span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground">
              {item.hint}
            </span>
          )}
        </button>
      ))}
    </>
  )
}
