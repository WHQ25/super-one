import { useEffect } from 'react'
import type { IDockviewPanelProps } from 'dockview-core'
import { IosSimulatorPanel } from './IosSimulatorPanel'

/**
 * The device keeps its proportions at any size, so a narrow panel only makes it
 * smaller — never squashed. It does become too small to aim at, though: this leaves
 * a full-height phone comfortably clear of the stage padding, with room for the
 * header's title and five buttons on one line.
 *
 * This panel's own number, not `LAYOUT.MIN_AP`. That constant sets the app's minimum
 * window width and validates mini-app `preferWidth`, so raising it to suit one panel
 * charges every window and every mini-app for elbow room only a phone wants. Asking
 * for more than the dock can afford is already handled below — the request is
 * clamped, and the device simply draws smaller.
 */
export const IOS_SIMULATOR_MIN_PANEL_WIDTH = 400

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
export function resolveIosSimulatorMinWidth(dockWidth: number, otherGroups = 0): number {
  const affordable = dockWidth - DOCKVIEW_DEFAULT_MIN_WIDTH * Math.max(0, otherGroups)
  if (!Number.isFinite(affordable)) return DOCKVIEW_DEFAULT_MIN_WIDTH
  return Math.max(
    DOCKVIEW_DEFAULT_MIN_WIDTH,
    Math.min(IOS_SIMULATOR_MIN_PANEL_WIDTH, Math.floor(affordable)),
  )
}

export function IosSimulatorDockPanel(props: IDockviewPanelProps<{ sessionId: string }>) {
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
      const next = resolveIosSimulatorMinWidth(containerApi.width, containerApi.groups.length - 1)
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

  return <IosSimulatorPanel sessionId={props.params.sessionId} />
}
