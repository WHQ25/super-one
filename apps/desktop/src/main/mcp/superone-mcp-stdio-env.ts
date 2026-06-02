export const SUPERONE_MCP_IPC_ENDPOINT_ENV = 'SUPERONE_MCP_IPC_ENDPOINT'
export const SUPERONE_MCP_IPC_TOKEN_ENV = 'SUPERONE_MCP_IPC_TOKEN'
export const SUPERONE_MCP_SESSION_ID_ENV = 'SUPERONE_MCP_SESSION_ID'

// Codex aborts MCP server startup after this many seconds. The bridge's own IPC
// bring-up budget (see superone-mcp-stdio-startup.ts) is derived from this single
// source so the stdio handshake always completes before codex gives up.
export const SUPERONE_MCP_STARTUP_TIMEOUT_SEC = 60
