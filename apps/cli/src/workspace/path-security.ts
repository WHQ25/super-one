/**
 * Re-export path security from @superone/runtime/fs so CLI call sites stay stable.
 */
export {
  resolveProjectPath,
  assertInsideRoot,
  pathKind,
} from '@superone/runtime/fs'
