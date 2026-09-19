/** Semantic facts shared by the browser, desktop, and device adapters. */

export interface RawElement {
  node: number
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
}

export interface RunObservation {
  url: string
  title: string
  text: string
  elements: RawElement[]
  omitted: number
  scroll: { y: number; height: number; viewport: number }
  loading: boolean
}

