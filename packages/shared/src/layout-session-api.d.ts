/** Standalone session-layout types shared by desktop tools and generated mini-app declarations. */
export interface LayoutSessionIdentity { environmentId: string; sessionId: string }

/** A sessionIds index, or a nested split. Each index must occur exactly once. */
export type SessionSplitLayout = number | {
  /** row divides left/right; column divides top/bottom. */
  direction: 'row' | 'column'
  /** First child's share excluding the divider; defaults to 0.5. */
  ratio?: number
  first: SessionSplitLayout
  second: SessionSplitLayout
}

export interface LayoutBox { x: number; y: number; width: number; height: number }
/** Native bounds and display work area use device-independent pixels, including window chrome. */
export interface NativeWindowLayoutState {
  bounds: LayoutBox
  minSize: { width: number; height: number }
  workArea: LayoutBox
  fullscreen: boolean
  maximized: boolean
  transitioning: boolean
}
export interface LayoutSessionTile { id: string; session: LayoutSessionIdentity }
export interface LayoutDivider {
  /** Stable through resizing/focus; changes when tree topology changes. */
  id: string
  /** row divides left/right; column divides top/bottom. Ratio is first child's share excluding the divider. */
  direction: 'row' | 'column'
  ratio: number
}
export interface SessionLayoutSnapshot {
  mode: 'single' | 'mosaic' | 'maximized'
  /** Available mosaic content box in viewport CSS pixels, including tile headers. */
  area: LayoutBox
  minTile: { width: number; height: number }
  dividerSize: number
  maxSessions: number
  focusedSession: LayoutSessionIdentity | null
  /** Only currently displayed tiles. Boxes use area-relative top-left coordinates, in CSS pixels. */
  tiles: (LayoutSessionTile & LayoutBox)[]
  dividers: (LayoutDivider & LayoutBox)[]
  /** Hidden/restorable tree: identities and proportions only; no visible geometry. */
  saved?: { tiles: LayoutSessionTile[]; dividers: LayoutDivider[] }
}
