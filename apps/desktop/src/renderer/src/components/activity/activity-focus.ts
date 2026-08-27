/**
 * Keeping focus owned by the activity panel.
 *
 * Panel-scoped shortcuts — ⌘T above all — are gated on `document.activeElement`
 * sitting inside the panel. That gate has no owner for "focus is nowhere": the
 * host keydown handler needs a live element to attribute the key to, and the
 * main-process forwarder only fires while a guest webview itself holds keyboard
 * focus (guest keys never bubble to the host). Focus lands nowhere easily, because
 * the element holding it either gets unmounted — the browser new-tab grid vanishes
 * the instant a bookmark navigates, taking the clicked tile with it — or hands it
 * back explicitly, as the omnibox does on commit. Both drop it to `<body>` and the
 * shortcuts go silently dead until the user clicks something.
 *
 * So the panel root doubles as a focus sink: it carries `tabIndex={-1}` and these
 * moments route focus there rather than letting it evaporate.
 */

const ACTIVITY_PANEL_SELECTOR = '[data-activity-inner]'

/**
 * Hand focus back to the activity panel containing `from`. A no-op when `from`
 * lives outside a panel (a picture-in-picture or preview browser view), or when
 * something else already claimed focus — this only rescues an empty focus.
 */
export function returnFocusToActivityPanel(from: Element | null): void {
  if (document.activeElement !== document.body) return
  from?.closest<HTMLElement>(ACTIVITY_PANEL_SELECTOR)?.focus({ preventScroll: true })
}
