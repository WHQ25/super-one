import { create } from 'zustand'

/**
 * One sidebar list target. The pane under the app drawer belongs to this
 * object until the person steps back out. App drawer and everything above
 * it stay put.
 */
export type SidebarFocus =
  | { kind: 'environment'; environmentId: string }
  | { kind: 'project'; folderPath: string; environmentId: string | null }
  | { kind: 'session'; folderPath: string; sessionId: string; environmentId: string | null }

interface SidebarFocusState {
  target: SidebarFocus | null
}

export const useSidebarFocusStore = create<SidebarFocusState>(() => ({
  target: null,
}))

function environmentOf(target: SidebarFocus | null): string | null {
  if (!target) return null
  if (target.kind === 'environment') return target.environmentId
  return target.environmentId
}

/** `environmentId` omitted keeps the environment already in focus, if any. */
export function focusProject(folderPath: string, environmentId?: string | null): void {
  const resolved = environmentId !== undefined
    ? environmentId
    : environmentOf(useSidebarFocusStore.getState().target)
  useSidebarFocusStore.setState({
    target: { kind: 'project', folderPath, environmentId: resolved },
  })
}

export function focusEnvironment(environmentId: string): void {
  useSidebarFocusStore.setState({ target: { kind: 'environment', environmentId } })
}

/**
 * A parent session. `environmentId` omitted keeps the environment already in
 * focus. An explicit `null` does not.
 */
export function focusSession(folderPath: string, sessionId: string, environmentId?: string | null): void {
  const resolved = environmentId !== undefined
    ? environmentId
    : environmentOf(useSidebarFocusStore.getState().target)
  useSidebarFocusStore.setState({
    target: {
      kind: 'session',
      folderPath,
      sessionId,
      environmentId: resolved,
    },
  })
}

/** A level menu sets the target directly. Inheritance stays in the drill helpers. */
export function applySidebarFocus(target: SidebarFocus | null): void {
  useSidebarFocusStore.setState({ target })
}

export interface SidebarFocusCrumb {
  id: 'root' | 'environment' | 'project' | 'session'
  label: string
  /** `null` leaves focus. */
  target: SidebarFocus | null
  current: boolean
}

/**
 * Every level from the full list down to the focused object. The last crumb
 * is the current one. A missing label falls back to the id or path.
 */
export function sidebarFocusCrumbs(
  focus: SidebarFocus,
  labels: {
    root: string
    environment?: string | null
    project?: string | null
    session?: string | null
  },
): SidebarFocusCrumb[] {
  const environmentId = focus.environmentId
  const crumbs: SidebarFocusCrumb[] = [
    { id: 'root', label: labels.root, target: null, current: false },
  ]
  if (environmentId) {
    crumbs.push({
      id: 'environment',
      label: labels.environment || environmentId,
      target: { kind: 'environment', environmentId },
      current: false,
    })
  }
  if (focus.kind === 'project' || focus.kind === 'session') {
    crumbs.push({
      id: 'project',
      label: labels.project || focus.folderPath,
      target: { kind: 'project', folderPath: focus.folderPath, environmentId: focus.environmentId },
      current: false,
    })
  }
  if (focus.kind === 'session') {
    crumbs.push({
      id: 'session',
      label: labels.session || focus.sessionId,
      target: focus,
      current: false,
    })
  }
  const last = crumbs[crumbs.length - 1]
  if (last) last.current = true
  return crumbs
}

/** Session steps up to its project. Project steps up to its environment, or leaves focus. */
export function focusBack(): void {
  const target = useSidebarFocusStore.getState().target
  if (!target || target.kind === 'environment') {
    useSidebarFocusStore.setState({ target: null })
    return
  }
  if (target.kind === 'session') {
    useSidebarFocusStore.setState({
      target: { kind: 'project', folderPath: target.folderPath, environmentId: target.environmentId },
    })
    return
  }
  useSidebarFocusStore.setState({
    target: target.environmentId ? { kind: 'environment', environmentId: target.environmentId } : null,
  })
}
