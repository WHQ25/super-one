import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Search, Star, User } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { HighlightedText } from '@superone/ui/components/ui/HighlightedText'
import { formatStarCount } from '@/lib/format-star-count'

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
  /** Two-line GitHub repo row: description under owner/repo. */
  subtitle?: string
  /** Star count shown on the right of the title row. */
  stars?: number | null
  /** Larger leading avatar (repo rows). */
  largeIcon?: boolean
  /** Larger icon + label for the source picker. */
  prominent?: boolean
}

export interface AddProjectListSection {
  key: string
  label: string
  items: AddProjectListItem[]
  /** Public-repo group: append the cycling ellipsis to the title. */
  searching?: boolean
  /** Leading icon on the section header. */
  icon?: 'search' | 'user'
}

function SearchingEllipsis() {
  const [dots, setDots] = useState(1)
  useEffect(() => {
    const id = window.setInterval(() => {
      setDots((n) => (n % 3) + 1)
    }, 400)
    return () => window.clearInterval(id)
  }, [])
  return <span aria-hidden>{'.'.repeat(dots)}</span>
}

function AddProjectSectionHeader({ section }: { section: AddProjectListSection }) {
  const Icon = section.icon === 'search' ? Search : section.icon === 'user' ? User : null
  return (
    <div
      onMouseDown={(e) => e.preventDefault()}
      className="mb-1.5 flex select-none items-center gap-1.5 px-2 pb-0.5 pt-2 text-xs font-medium text-muted-foreground"
    >
      {Icon ? <Icon className="size-3 shrink-0" aria-hidden /> : null}
      <span>
        {section.label}
        {section.searching ? <SearchingEllipsis /> : null}
      </span>
      {section.searching ? null : (
        <span className="text-muted-foreground/60">· {section.items.length}</span>
      )}
    </div>
  )
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
            <AddProjectSectionHeader section={section} />
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
                    'flex w-full gap-2 rounded px-2 text-left text-xs transition-colors',
                    item.prominent ? 'py-2' : 'py-1.5',
                    item.wrapLabel ? 'items-start' : 'items-center',
                    index === selectedIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-accent/40',
                  )}
                >
                  <span
                    className={cn(
                      'flex shrink-0 items-center justify-center text-muted-foreground',
                      item.largeIcon ? 'size-8' : item.prominent ? 'size-[18px]' : 'size-4',
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
                  ) : item.subtitle != null || item.stars != null ? (
                    <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-medium">
                          {item.matchIndices && item.matchIndices.length > 0 ? (
                            <HighlightedText text={item.label} indices={item.matchIndices} />
                          ) : (
                            item.label
                          )}
                        </span>
                        {item.stars != null ? (
                          <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
                            <Star className="size-3 shrink-0" aria-hidden />
                            {formatStarCount(item.stars)}
                          </span>
                        ) : null}
                      </span>
                      {item.subtitle ? (
                        <span className="truncate text-[11px] text-muted-foreground">
                          {item.subtitle}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <>
                      {/*
                        Prefer the full label (repo name / folder name). Description/hint
                        is secondary and absorbs overflow so long GitHub blurbs don't
                        crush the name.
                      */}
                      {/* text-sm: repo/folder names; source picker is slightly larger. */}
                      <span
                        className={cn(
                          'min-w-0 shrink truncate font-medium',
                          item.prominent ? 'text-[15px]' : 'text-sm',
                        )}
                      >
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
