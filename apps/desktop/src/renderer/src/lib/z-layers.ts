/**
 * The renderer's global stacking ladder.
 *
 * Every layer that is `position: fixed` and portalled (or otherwise escapes its
 * subtree) competes with every other one in a single order. Those numbers live here,
 * named, so a new layer is placed by picking a neighbour instead of by picking a
 * number that looked big enough.
 *
 * ## The ladder
 *
 * ```
 *    20  HOST_BROWSER                browser host layer, at rest
 *    30  HOST_MINIAPP                mini-app host layer
 *    30  HOST_COMPUTER_USE           computer-use pip host layer
 *    40  HOST_DEVICE                 device/simulator host layer, at rest
 *    40  MOSAIC_DROP                 single-session drop overlay
 *    45  HOST_BROWSER_EXPANDED       browser host layer, overlay open
 *    46  HOST_DEVICE_EXPANDED        device host layer, overlay open
 *  ┌ 50  MODAL ───────────────────── pinned; see below
 *   198  PLAN_MARKER                 plan-review underline strokes
 *   200  PLAN_STICKY                 plan-review sticky buttons
 *   210  PLAN_NOTE                   plan-review open note
 *   300  SESSION_SWITCHER            Ctrl+Tab switcher
 *  9998  DRAG_SCRIM                  mosaic divider cursor scrim
 *  9999  DRAG_GHOST                  cross-window session drag preview
 *  9999  DEBUG_PANEL                 DEV-only debug panel
 * ```
 *
 * ## `MODAL` is an anchor, not a choice
 *
 * 50 is where shadcn/Radix puts every overlay it ships — `packages/ui` hardcodes
 * `z-50` across dialog, popover, tooltip, select, dropdown-menu, context-menu and
 * hover-card, and the shadcn CLI regenerates those files with 50 baked in. Desktop's
 * hand-rolled overlays (`LinkSafetyModal`, `SelectionContextMenu`, `TableContextMenu`,
 * `MiniAppOverlayPortal`, `MiniAppClipboardGuard`, `FullscreenGlassDialog`) match it
 * on purpose. So `MODAL` cannot be moved; everything else arranges around it.
 *
 * Concretely: **a host layer must stay below 50.** A device overlay once sat at 51 to
 * beat the browser's expanded 50, which also put it over the entire modal tier — a
 * link-confirm dialog opened *behind* the simulator. Beat your neighbour, not the
 * modals.
 *
 * ## A number here only means something if it can escape
 *
 * `z-index` is resolved within the nearest ancestor that forms a stacking context, so
 * a layer rendered deep in the app shell is ranked against its siblings, not against
 * this ladder. `App.tsx`'s main-area wrapper is `relative z-20`, and the Ctrl+Tab
 * switcher used to render inside it: its `z-[60]` was 60 *within a box that painted at
 * 20*, so the device host layer (40) covered it. Portal to `document.body` first —
 * then pick a number from this file.
 *
 * ## Adding a layer
 *
 * Add a key here, add the matching class to `Z_CLASS` if it is used from `className`,
 * and say in one line what the layer is. The `satisfies` clause makes the two tables
 * fail to compile if they ever disagree.
 */
export const Z = {
  // Host layers — the persistent fixed surfaces that own webviews, simulators and
  // mini-apps. All of them stay below MODAL, expanded or not.
  HOST_BROWSER: 20,
  HOST_MINIAPP: 30,
  HOST_COMPUTER_USE: 30,
  HOST_DEVICE: 40,
  HOST_BROWSER_EXPANDED: 45,
  HOST_DEVICE_EXPANDED: 46,

  // Layout affordances that ride along with the host layers.
  MOSAIC_DROP: 40,

  /** Pinned by shadcn/Radix. Read the note above before touching anything near it. */
  MODAL: 50,

  // Plan-review chrome — annotations anchored to chat lines, above the modal tier.
  PLAN_MARKER: 198,
  PLAN_STICKY: 200,
  PLAN_NOTE: 210,

  // Global overlays that outrank everything they are shown over.
  SESSION_SWITCHER: 300,

  // Drag feedback — follows the pointer across the whole window, so it is last.
  DRAG_SCRIM: 9998,
  DRAG_GHOST: 9999,

  /** DEV-only, and deliberately on top of everything it is used to inspect. */
  DEBUG_PANEL: 9999,
} as const

/**
 * The same ladder as Tailwind classes, for the layers written in `className`.
 *
 * Tailwind's scanner reads source text, so `z-[${Z.SESSION_SWITCHER}]` would generate
 * no class at all — the values have to be literals. The `satisfies` clause below ties
 * each literal back to `Z`, so a class that drifts from its number is a type error
 * rather than a layer that quietly changes rank.
 *
 * Layers at `MODAL` are intentionally absent: those sites write literal `z-50` to stay
 * uniform with `packages/ui`, which cannot import from here.
 */
export const Z_CLASS = {
  HOST_COMPUTER_USE: 'z-[30]',
  PLAN_MARKER: 'z-[198]',
  PLAN_STICKY: 'z-[200]',
  PLAN_NOTE: 'z-[210]',
  SESSION_SWITCHER: 'z-[300]',
  DRAG_SCRIM: 'z-[9998]',
  DRAG_GHOST: 'z-[9999]',
  DEBUG_PANEL: 'z-[9999]',
} satisfies { [K in keyof typeof Z]?: `z-[${(typeof Z)[K]}]` }
