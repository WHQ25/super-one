/**
 * Claude MCP config (`~/.claude.json`, `.claude/settings.json`, `.mcp.json`):
 * the runtime implementation every node client edits too.
 */
export {
  listClaudeMcpConfigs as listMcpConfigs,
  saveClaudeMcpConfig as saveMcpConfig,
  toggleClaudeMcpConfig as toggleMcpConfig,
  deleteClaudeMcpConfig as deleteMcpConfig,
} from '@superone/runtime/fs'
