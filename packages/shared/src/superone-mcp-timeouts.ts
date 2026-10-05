/**
 * Codex `mcp_servers.superone.tool_timeout_sec`. Codex otherwise ends any MCP
 * call after its default (300 s upstream), which cuts off tools that wait for a
 * person — host confirmations have no deadline of their
 * own and end with the turn instead. SuperOne tools keep their own work limits.
 */
export const SUPERONE_MCP_TOOL_TIMEOUT_SEC = 24 * 60 * 60
