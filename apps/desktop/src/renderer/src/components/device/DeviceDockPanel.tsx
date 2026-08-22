import { useEffect } from 'react'
import type { IDockviewPanelProps } from 'dockview-core'
import { LAYOUT } from '@/lib/layout-constants'
import { DeviceView } from './DeviceView'

/**
 * Same floor as the activity panel (`LAYOUT.MIN_AP`). A group that demands more
 * than the dock is laid out oversized and clipped — taking the right of the
 * device with it — so the request is still clamped to what the dock can afford.
 */
export const DEVICE_MIN_PANEL_WIDTH = LAYOUT.MIN_AP

/** dockview's own floor, restored when this panel lets go of the group. */
const DOCKVIEW_DEFAULT_MIN_WIDTH = 100

/**
 * A group minimum is a demand, not a preference: dockview lays the group out at that
 * width even when the dock has less to give, and the activity panel clips the excess —
 * taking the right of the device and the last header button with it. So the floor is
 * capped by what the dock can actually hand over.
 *
 * Sibling groups are charged their own default floor. That over-reserves for groups
 * stacked vertically, which never compete for width, but erring toward a smaller floor
 * only costs a little elbow room; erring the other way clips.
 */
export function resolveDeviceMinWidth(dockWidth: number, otherGroups = 0): number {
  const affordable = dockWidth - DOCKVIEW_DEFAULT_MIN_WIDTH * Math.max(0, otherGroups)
  if (!Number.isFinite(affordable)) return DOCKVIEW_DEFAULT_MIN_WIDTH
  return Math.max(
    DOCKVIEW_DEFAULT_MIN_WIDTH,
    Math.min(DEVICE_MIN_PANEL_WIDTH, Math.floor(affordable)),
  )
}

export function DeviceDockPanel(props: IDockviewPanelProps<{ sessionId: string }>) {
  const { api, containerApi } = props

  useEffect(() => {
    // Constraints belong to the group, not the panel, so the floor has to travel
    // when the tab is dragged elsewhere — and the group it leaves gets its width back.
    let held = api.group
    let applied: number | null = null
    const release = () => {
      applied = null
      held.api.setConstraints({ minimumWidth: DOCKVIEW_DEFAULT_MIN_WIDTH })
    }
    const apply = () => {
      const next = resolveDeviceMinWidth(containerApi.width, containerApi.groups.length - 1)
      // Writing a constraint relays out the dock, which lands right back here. Only
      // writing on a real change is what keeps that from spinning.
      if (next === applied) return
      applied = next
      held.api.setConstraints({ minimumWidth: next })
    }

    apply()
    const moved = api.onDidGroupChange(() => {
      release()
      held = api.group
      apply()
    })
    const relaid = containerApi.onDidLayoutChange(apply)
    return () => {
      moved.dispose()
      relaid.dispose()
      release()
    }
  }, [api, containerApi])

  // A hole, not the panel. `DeviceHostLayer` holds the one real panel for this
  // session and positions it over whichever slot is winning, so the tab and the
  // floating preview can hand the device back and forth without either of them
  // owning — and so being able to destroy — the frame stream.
  return <DeviceView sessionId={props.params.sessionId} mode="panel" />
}
