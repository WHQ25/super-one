/**
 * Modal Radix layers lock scroll; non-modal ones (Popover/DropdownMenu) only mount a popper
 * wrapper. A prompt that owns window-level Escape/Tab/Enter shortcuts must swallow keys while
 * either kind is open, so dismissing a picker never reaches the reject/submit shortcut.
 */
export function hasOpenRadixOverlay(): boolean {
  return document.body.hasAttribute('data-scroll-locked')
    || !!document.querySelector('[data-radix-popper-content-wrapper]')
}
