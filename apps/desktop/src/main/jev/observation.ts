/** Semantic facts shared by the browser, desktop, and device adapters. */

export interface RawElement {
  node: number
  /** Adapter capability. Absent preserves browser defaults. */
  clickable?: boolean
  canSubmit?: boolean
  /** Native ref for inspection by the caller, never interpreted by Jev. */
  ref?: string
  role: string
  label: string
  /** Current value for inputs / contenteditable, '' otherwise. */
  value: string
  checked?: string
  selected?: string
  expanded?: string
  href?: string
  /** Editable text target (textbox / searchbox / spinbutton / editable combobox). */
  editable: boolean
  /** `<input type=password>` — never a type target, never sent a preset. */
  password: boolean
  /** type=submit, or a button inside a <form>. */
  submit: boolean
  disabled: boolean
  /**
   * A scroll area, and where it can still move. Only the desktop adapter sets
   * it: a window holds several (Finder's sidebar and its list), and a scroll
   * aimed at the first one found scrolled the sidebar when the goal was three
   * pages down the list.
   */
  scroll?: { up: boolean; down: boolean }
  /** An editable text area that takes keystrokes at its end, keeping what it holds. */
  appendable?: boolean
  /**
   * Another root (window, sheet, panel) of the same app this element stands
   * for; choosing it re-observes that root. Desktop only.
   */
  root?: string
  /** A right-click here opens a context menu the next observation lands on. Desktop only. */
  contextMenu?: boolean
  /** A selected item that can be dragged; one `drag_target_for_*` head is asked for it. Desktop only. */
  dragSource?: boolean
  /** A folder, mailbox or group a dragged item can be dropped into. Desktop only. */
  dropTarget?: boolean
  /**
   * A picture or canvas with no controls of its own: nothing the loop can do
   * to it, but the place a handed-over point or path would land (§11.4). It
   * is listed so the `hand_target` head can name it.
   */
  picture?: boolean
  /** A menu-bar command (Desktop only): pressed like a button, but not a place on the window an input could be handed to. */
  menuCommand?: boolean
  /** Where the element is, in the adapter's coordinate space, for a hand-over's `context.target`. */
  bounds?: { x: number; y: number; width: number; height: number }
}

export interface RunObservation {
  url: string
  title: string
  text: string
  elements: RawElement[]
  omitted: number
  scroll: { y: number; height: number; viewport: number }
  loading: boolean
  stateId?: string
  target?: Record<string, string>
  blocked?: { reason: 'no-progress'; why: string }
  canScroll?: { down: boolean; up: boolean }
  /** The adapter can press Escape — the one closed-set key the loop offers (research doc §11.2). */
  canEscape?: boolean
}
