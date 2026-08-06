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
  /**
   * When true, the label is shown in full and may wrap (used for the
   * create-missing-path row which needs the entire absolute path visible).
   */
  wrapLabel?: boolean
}

export interface AddProjectListSection {
  key: string
  label: string
  items: AddProjectListItem[]
}

interface AddProjectListProps {
  sections: AddProjectListSection[]
  selectedIndex: number
  onActivate: (index: number) => void
  onHover: (index: number) => void
}

/**
 * Keyboard-driven result list shared by every step of the add-project dialog —
 * same row shape as MentionPopup / AddDirPopup so the two feel like one system.
 *
 * `selectedIndex` is global across sections (flattened in section order).
 */
export function AddProjectList({
  sections,
  selectedIndex,
  onActivate,
  onHover,
}: AddProjectListProps) {
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

  const flatCount = sections.reduce((n, s) => n + s.items.length, 0)

  useEffect(() => {
    itemRefs.current.get(selectedIndex)?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, flatCount])

  let offset = 0
  return (
    <>
      {sections.map((section) => {
        const start = offset
        offset += section.items.length
        return (
          <div key={section.key}>
            <PopupSectionHeader label={section.label} count={section.items.length} />
            {section.items.map((item, localIndex) => {
              const index = start + localIndex
              return (
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
                    'flex w-full gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                    item.wrapLabel ? 'items-start' : 'items-center',
                    index === selectedIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-accent/40',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center text-muted-foreground',
                      item.wrapLabel && 'mt-0.5',
                    )}
                  >
                    {item.icon}
                  </span>
                  {item.wrapLabel ? (
                    // Create-path row: full absolute path, wrap freely; hint under it.
                    <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                      <span className="font-mono font-medium break-all whitespace-normal">
                        {item.label}
                      </span>
                      {item.hint ? (
                        <span className="text-[11px] text-muted-foreground">{item.hint}</span>
                      ) : null}
                    </span>
                  ) : (
                    <>
                      {/*
                        Prefer the full label (repo name / folder name). Description/hint
                        is secondary and absorbs overflow so long GitHub blurbs don't
                        crush the name.
                      */}
                      <span className="min-w-0 shrink font-medium truncate">
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
                    </>
                  )}
                </button>
              )
            })}
          </div>
        )
      })}
    </>
  )
}
