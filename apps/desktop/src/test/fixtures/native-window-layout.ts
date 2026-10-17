import type { NativeWindowLayoutState } from '@superone/shared/window-layout'

export function nativeWindowLayoutFixture(overrides: Partial<NativeWindowLayoutState> = {}): NativeWindowLayoutState {
  return {
    bounds: { x: 0, y: 0, width: 1200, height: 900 },
    minSize: { width: 680, height: 400 },
    workArea: { x: 0, y: 0, width: 1600, height: 1000 },
    fullscreen: false, maximized: false, transitioning: false,
    ...overrides,
  }
}
