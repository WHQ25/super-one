/**
 * Re-export path security from @superone/runtime/fs so CLI call sites stay stable.
 */
export {
  resolveProjectPath,
  assertInsideRoot,
  pathKind,
  TOOL_OUTPUT_REL_PREFIX,
  normalizeProjectRelativePath,
  isToolOutputRelativePath,
  toProjectRelativePath,
} from '@superone/runtime/fs'
