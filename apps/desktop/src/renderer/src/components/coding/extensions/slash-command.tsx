import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { Extension, type Editor, type Range } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion'
import { Table } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

interface SlashItem {
  title: string
  subtitle: string
  keywords: string[]
  icon: ReactNode
  picker?: 'table'
  command?: (props: { editor: Editor; range: Range }) => void
}

const COMMANDS: SlashItem[] = [
  {
    title: 'Table',
    subtitle: 'Choose size',
    keywords: ['grid'],
    icon: <Table className="size-4" />,
    picker: 'table',
  },
]

const GRID_ROWS = 10
const GRID_COLS = 10

function TableGridPicker({ editor, range }: { editor: Editor; range: Range }) {
  const [hover, setHover] = useState({ rows: 1, cols: 1 })
  const insert = (rows: number, cols: number) =>
    editor.chain().focus().deleteRange(range).insertTable({ rows, cols, withHeaderRow: true }).run()

  return (
    <div className="p-1.5" onMouseDown={(e) => e.preventDefault()}>
      <div className="mb-1.5 text-center text-xs text-muted-foreground">
        {hover.rows} × {hover.cols}
      </div>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1.25rem)` }}
        onMouseLeave={() => setHover({ rows: 1, cols: 1 })}
      >
        {Array.from({ length: GRID_ROWS * GRID_COLS }).map((_, idx) => {
          const r = Math.floor(idx / GRID_COLS) + 1
          const c = (idx % GRID_COLS) + 1
          const active = r <= hover.rows && c <= hover.cols
          return (
            <button
              key={idx}
              type="button"
              onMouseEnter={() => setHover({ rows: r, cols: c })}
              onClick={() => insert(r, c)}
              className={cn(
                'size-5 rounded-[2px] border',
                active ? 'border-primary bg-primary/30' : 'border-border bg-background',
              )}
            />
          )
        })}
      </div>
    </div>
  )
}

interface SlashMenuRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

const SlashMenu = forwardRef<SlashMenuRef, SuggestionProps<SlashItem, SlashItem>>((props, ref) => {
  const { items, command } = props
  const [index, setIndex] = useState(0)
  const [picker, setPicker] = useState<SlashItem | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => setIndex(0), [items])

  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const select = (item: SlashItem) => {
    if (item.picker) setPicker(item)
    else command(item)
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (picker) return event.key === 'Enter' || event.key.startsWith('Arrow')
      if (!items.length) return false
      if (event.key === 'ArrowUp') {
        setIndex((i) => (i + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setIndex((i) => (i + 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        const item = items[index]
        if (item) select(item)
        return true
      }
      return false
    },
  }), [items, index, command, picker])

  if (!items.length && !picker) return null

  return (
    <div className="min-w-[200px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
      {picker ? (
        <TableGridPicker editor={props.editor} range={props.range} />
      ) : (
        <div ref={listRef} className="max-h-[320px] overflow-y-auto">
          {items.map((item, i) => (
            <button
              key={item.title}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setIndex(i)}
              onClick={() => select(item)}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                i === index && 'bg-accent text-accent-foreground',
              )}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded border bg-background">
                {item.icon}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{item.title}</span>
                <span className="truncate text-xs text-muted-foreground">{item.subtitle}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
SlashMenu.displayName = 'SlashMenu'

function positionMenu(el: HTMLElement, clientRect?: (() => DOMRect | null) | null) {
  const rect = clientRect?.()
  if (!rect) return
  el.style.position = 'fixed'
  const { height, width } = el.getBoundingClientRect()
  const top = rect.bottom + height + 6 > window.innerHeight ? rect.top - height - 6 : rect.bottom + 6
  const left = Math.min(rect.left, window.innerWidth - width - 8)
  el.style.top = `${Math.max(8, top)}px`
  el.style.left = `${Math.max(8, left)}px`
}

function renderSlashMenu() {
  let component: ReactRenderer<SlashMenuRef, SuggestionProps<SlashItem, SlashItem>> | null = null
  let el: HTMLElement | null = null

  return {
    onStart: (props: SuggestionProps<SlashItem, SlashItem>) => {
      component = new ReactRenderer(SlashMenu, { props, editor: props.editor })
      el = component.element as HTMLElement
      el.style.zIndex = '50'
      document.body.appendChild(el)
      positionMenu(el, props.clientRect)
    },
    onUpdate: (props: SuggestionProps<SlashItem, SlashItem>) => {
      component?.updateProps(props)
      if (el) positionMenu(el, props.clientRect)
    },
    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (props.event.key === 'Escape') return true
      return component?.ref?.onKeyDown(props) ?? false
    },
    onExit: () => {
      el?.remove()
      component?.destroy()
      el = null
      component = null
    },
  }
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: '/',
        command: ({ editor, range, props }) => props.command?.({ editor, range }),
        items: ({ query }) => {
          const q = query.toLowerCase().trim()
          if (!q) return COMMANDS
          return COMMANDS.filter((c) =>
            [c.title, ...c.keywords].some((k) => k.toLowerCase().includes(q)),
          )
        },
        allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name !== 'codeBlock',
        render: renderSlashMenu,
      }),
    ]
  },
})
