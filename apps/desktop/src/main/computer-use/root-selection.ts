import { ComputerUseError, type UiRootIdentity } from './types'

/** Exclude tiny window chrome while retaining real menu/popover surfaces. */
export function isUsableAppRoot(root: UiRootIdentity): boolean {
  return root.visible && !root.minimized && (root.modal || root.kind === 'menu' || root.kind === 'popover'
    || (root.bounds.width >= 80 && root.bounds.height >= 80))
}

/** Pick the app's content window, not a screen-sharing strip or other tiny helper. */
export function selectAppRoot(roots: UiRootIdentity[]): UiRootIdentity | undefined {
  const visible = roots.filter(isUsableAppRoot)
  const modal = visible.find((root) => root.modal && root.focused) ?? visible.find((root) => root.modal)
  if (modal) return modal
  // Open menus/popovers remain the active surface even when smaller than a window.
  const transient = visible.find((root) => root.kind !== 'window' && root.focused)
  if (transient) return transient
  return visible.filter((root) => root.kind === 'window' && root.title.trim()
    && root.bounds.width >= 80 && root.bounds.height >= 80)
    .sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height)[0]
}

export function resolveUiRoot(
  roots: UiRootIdentity[],
  options: { rootId?: string; bundleId?: string; preferredBundleId?: string | null } = {},
): UiRootIdentity {
  if (options.rootId) {
    const exact = roots.find((root) => root.rootId === options.rootId)
    if (!exact) throw new ComputerUseError('UNKNOWN_ROOT', `Unknown root ${options.rootId}`, { rootId: options.rootId })
    return exact
  }
  const bundleId = options.bundleId ?? options.preferredBundleId
  if (bundleId) {
    const preferred = selectAppRoot(roots.filter((root) => root.bundleId === bundleId))
    if (preferred) return preferred
    if (options.bundleId) throw new ComputerUseError('UNKNOWN_ROOT', 'The app has no usable window. Launch it with computer_apps or choose an explicit root.')
  }
  const front = roots.find((root) => root.focused) ?? roots[0]
  const selected = front && selectAppRoot(roots.filter((root) => root.bundleId === front.bundleId))
  if (!selected) throw new ComputerUseError('UNKNOWN_ROOT', 'No usable UI roots available. Choose an explicit root for an auxiliary window.')
  return selected
}
