import { MCP_APPS_EXTENSION } from '@superone/shared/mcp-apps'
import { OPENAI_FORM_ELICITATION_EXTENSION } from '@superone/shared/schema-form'

/** standard-form-input stays in Codex; the others are forwarded to MCP servers. */
export const CODEX_CLIENT_EXTENSIONS = {
  ...MCP_APPS_EXTENSION,
  ...OPENAI_FORM_ELICITATION_EXTENSION,
  'openai/standard-form-input': {},
}
