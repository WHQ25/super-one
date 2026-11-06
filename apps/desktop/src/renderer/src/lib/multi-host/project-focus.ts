import { checkoutMergeKey } from './group-projects'
import type { HostCheckout } from './types'

/** A project focus follows its normalized origin across hosts, never its display name. */
export function projectFocusPaths(
  folderPath: string,
  environments: readonly { checkouts?: readonly HostCheckout[] }[],
): string[] {
  const checkouts = environments.flatMap((bucket) => bucket.checkouts ?? [])
  const focused = checkouts.find((checkout) => checkout.pathKey === folderPath)
  if (!focused) return [folderPath]
  const key = checkoutMergeKey(focused)
  return checkouts.filter((checkout) => checkoutMergeKey(checkout) === key).map((checkout) => checkout.pathKey)
}
