import { useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { SectionDef } from '../components/Section'
import { Btn, Row, Out } from '../components/kit'

function Demo() {
  const [out, setOut] = useState('Host-rendered overlays escape the iframe sandbox.')
  const popBtn = useRef<HTMLButtonElement>(null)

  const tip = (el: HTMLElement, show: boolean) => {
    if (!show) return window.superone.ui.hideTooltip()
    const r = el.getBoundingClientRect()
    window.superone.ui.showTooltip(
      { x: r.left, y: r.top, width: r.width, height: r.height },
      'Host-rendered tooltip 👋',
      'top',
    )
  }

  const menu = async (e: React.MouseEvent) => {
    e.preventDefault()
    const id = await window.superone.ui.showContextMenu(
      { x: e.clientX, y: e.clientY },
      [
        { id: 'edit', label: 'Edit', icon: 'pencil', group: 'Actions' },
        { id: 'copy', label: 'Duplicate', icon: 'copy', group: 'Actions' },
        { id: 's', label: '', separator: true },
        { id: 'del', label: 'Delete', icon: 'trash-2', variant: 'destructive' },
      ],
    )
    setOut(id ? `Context menu → ${id}` : 'Context menu dismissed')
  }

  const popover = () => {
    if (!popBtn.current) return
    const r = popBtn.current.getBoundingClientRect()
    const handle = window.superone.ui.showPopover({
      template: 'detail',
      data: { title: 'Detail popover', description: 'Rendered from a separate Vite entry, two-way messaging.' },
      anchorRect: { x: r.left, y: r.top, width: r.width, height: r.height },
      side: 'bottom',
      align: 'start',
      width: 280,
    })
    handle.onMessage((msg) => {
      setOut('Popover → ' + JSON.stringify(msg))
      handle.postMessage({ reply: 'got it' })
    })
    handle.onClose(() => setOut('Popover closed'))
  }

  return (
    <div>
      <Row>
        <Btn onClick={() => window.superone.ui.toast('Saved ✓', 'success')}>
          toast.success
        </Btn>
        <Btn variant="ghost" onClick={() => window.superone.ui.toast('Oops', 'error')}>
          toast.error
        </Btn>
        <span
          className="text-[13px] px-2.5 py-1.5 rounded-md bg-accent text-accent-fg cursor-default"
          onMouseEnter={(e) => tip(e.currentTarget, true)}
          onMouseLeave={(e) => tip(e.currentTarget, false)}
        >
          hover: tooltip
        </span>
        <span
          className="text-[13px] px-2.5 py-1.5 rounded-md bg-accent text-accent-fg cursor-default"
          onContextMenu={menu}
        >
          right-click: menu
        </span>
        <button
          ref={popBtn}
          onClick={popover}
          className="px-3 py-1.5 rounded-md text-[13px] font-medium border border-border bg-card text-fg hover:bg-accent hover:text-accent-fg"
        >
          showPopover()
        </button>
      </Row>
      <Out>{out}</Out>
    </div>
  )
}

const react = `import { useRef } from 'react'

function Overlays() {
  const btn = useRef(null)

  const tip = (el, show) => {
    if (!show) return window.superone.ui.hideTooltip()
    const r = el.getBoundingClientRect()
    window.superone.ui.showTooltip(
      { x: r.left, y: r.top, width: r.width, height: r.height },
      'Host-rendered tooltip',
      'top',
    )
  }

  const menu = async (e) => {
    e.preventDefault()
    const id = await window.superone.ui.showContextMenu(
      { x: e.clientX, y: e.clientY },
      [
        { id: 'edit', label: 'Edit', icon: 'pencil' },
        { id: 'del', label: 'Delete', icon: 'trash-2', variant: 'destructive' },
      ],
    )
    console.log('picked', id)
  }

  const popover = () => {
    const r = btn.current.getBoundingClientRect()
    const h = window.superone.ui.showPopover({
      template: 'detail', // manifest.templates key
      data: { title: 'Detail' },
      anchorRect: { x: r.left, y: r.top, width: r.width, height: r.height },
      side: 'bottom',
    })
    h.onMessage(() => h.postMessage({ reply: 'got it' }))
    h.onClose(() => {})
  }

  return (
    <>
      <button onClick={() => window.superone.ui.toast('Saved ✓', 'success')}>Toast</button>
      <span
        onMouseEnter={(e) => tip(e.currentTarget, true)}
        onMouseLeave={(e) => tip(e.currentTarget, false)}
        onContextMenu={menu}
      >
        Hover / right-click
      </span>
      <button ref={btn} onClick={popover}>Popover</button>
    </>
  )
}`

const vanilla = `superone.ui.toast('Saved', 'success')   // success|error|warning|info

el.onmouseenter = () => {
  const r = el.getBoundingClientRect()
  superone.ui.showTooltip({ x: r.left, y: r.top, width: r.width, height: r.height },
                          'Tooltip', 'top')
}
el.onmouseleave = () => superone.ui.hideTooltip()

el.oncontextmenu = async (e) => {
  e.preventDefault()
  const id = await superone.ui.showContextMenu({ x: e.clientX, y: e.clientY }, [
    { id: 'edit', label: 'Edit', icon: 'pencil' },
    { id: 'del',  label: 'Delete', icon: 'trash-2', variant: 'destructive' },
  ])
}

const h = superone.ui.showPopover({ template: 'detail', data: {...},
  anchorRect: el.getBoundingClientRect() })
h.onMessage((m) => h.postMessage({ ack: true }))
h.onClose(() => {})`

export const uiSection: SectionDef = {
  id: 'ui',
  icon: Sparkles,
  title: 'UI Overlays',
  api: 'superone.ui',
  blurb:
    'toast, tooltip, context menu and template-driven popovers — all rendered by the host outside the sandbox.',
  Demo,
  react,
  vanilla,
}
