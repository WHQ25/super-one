import type { ComputerUseState, ZoomResult } from './types'
import type { PlatformAdapter } from './platform/types'

export async function zoomState(adapter: PlatformAdapter, state: ComputerUseState, stateId: string, region: [number, number, number, number]): Promise<ZoomResult> {
  const image = adapter.zoom
    ? await adapter.zoom(state.root, region, state.coordinateSpace)
    : {
        mimeType: 'image/png' as const,
        data: `zoom:${region.join(',')}`,
        width: Math.max(1, region[2] - region[0]),
        height: Math.max(1, region[3] - region[1]),
      }

  return {
    image,
    region,
    // Critical invariant: zoom never establishes a new coordinate space.
    coordinateSpace: { ...state.coordinateSpace },
    stateId,
    // Surface target identity so chat UI can show the app icon without a second lookup.
    root: {
      app: state.root.app,
      bundleId: state.root.bundleId,
      title: state.root.title,
    },
  }
}
