/**
 * Claude MCP config (`~/.claude.json`, `.claude/settings.json`, `.mcp.json`)
 * and per-tool permission rules (`permissions` in the settings layers):
 * the runtime implementation every node client edits too.
 */
export {
  listClaudeMcpConfigs as listMcpConfigs,
  saveClaudeMcpConfig as saveMcpConfig,
  toggleClaudeMcpConfig as toggleMcpConfig,
  deleteClaudeMcpConfig as deleteMcpConfig,
  listClaudeMcpToolPermissions as listMcpToolPermissions,
  setClaudeMcpToolPermission as setMcpToolPermission,
} from '@superone/runtime/fs'
