/**
 * Desktop path helpers — re-export shared runtime fs + git ref sanitize.
 */
export {
  resolveRealPath,
  isPathWithinAllowed,
  isPathAtOrWithinAllowed,
  getReadableAssetRoots,
} from '@superone/runtime/fs'

export { sanitizeGitRef } from '@superone/runtime/git'
