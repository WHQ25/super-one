import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  AGENT_PROFILE_LIST_DESCRIPTION, AGENT_PROFILE_APPLY_DESCRIPTION, AGENT_PROFILE_DELETE_DESCRIPTION,
} from '@superone/shared/superone-tool-descriptions'
import {
  AGENT_PROFILE_APPLY_INPUT_SCHEMA, AGENT_PROFILE_DELETE_INPUT_SCHEMA, AGENT_PROFILE_LIST_INPUT_SCHEMA,
} from '@superone/shared/environment/host-action-agent-profile-descriptors'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'
import { isAgentProfilesEnabled } from '../session/agent-profile-feature'

export function registerAgentProfileTools(server: McpServer, deps: BuiltInSuperoneToolDeps): void {
  if (!isAgentProfilesEnabled()) return
  server.registerTool(
    'agent_profile_list',
    {
      description: AGENT_PROFILE_LIST_DESCRIPTION,
      inputSchema: {
        id: z.string().optional().describe(agentProfileField(AGENT_PROFILE_LIST_INPUT_SCHEMA, 'id')),
      },
    },
    async (args) => (await import('./agent-profile-tools')).agentProfileListHandler(args),
  )

  server.registerTool(
    'agent_profile_apply',
    {
      description: AGENT_PROFILE_APPLY_DESCRIPTION,
      inputSchema: {
        action: z.enum(['create', 'update']).describe(agentProfileField(AGENT_PROFILE_APPLY_INPUT_SCHEMA, 'action')),
        id: z.string().optional().describe(agentProfileField(AGENT_PROFILE_APPLY_INPUT_SCHEMA, 'id')),
        harnessId: z.enum(['claude', 'codex', 'acp', 'opencode', 'cursor', 'dsh']).optional()
          .describe(agentProfileField(AGENT_PROFILE_APPLY_INPUT_SCHEMA, 'harnessId')),
        name: z.string().optional().describe(agentProfileField(AGENT_PROFILE_APPLY_INPUT_SCHEMA, 'name')),
        description: z.string().optional().describe(agentProfileField(AGENT_PROFILE_APPLY_INPUT_SCHEMA, 'description')),
        instructions: z.string().optional().describe(agentProfileField(AGENT_PROFILE_APPLY_INPUT_SCHEMA, 'instructions')),
        model: z.string().optional().describe(agentProfileField(AGENT_PROFILE_APPLY_INPUT_SCHEMA, 'model')),
        effort: z.string().optional().describe(agentProfileField(AGENT_PROFILE_APPLY_INPUT_SCHEMA, 'effort')),
        permissionMode: z.string().optional().describe(agentProfileField(AGENT_PROFILE_APPLY_INPUT_SCHEMA, 'permissionMode')),
        options: z.object({
          ultracode: z.boolean().nullable().optional().describe(agentProfileOptionField('ultracode')),
          fastMode: z.boolean().nullable().optional().describe(agentProfileOptionField('fastMode')),
          contextWindow: z.number().int().positive().nullable().optional().describe(agentProfileOptionField('contextWindow')),
          mode: z.string().nullable().optional().describe(agentProfileOptionField('mode')),
          agent: z.string().nullable().optional().describe(agentProfileOptionField('agent')),
          agentPreset: z.string().nullable().optional().describe(agentProfileOptionField('agentPreset')),
          modelParams: z.record(z.string(), z.string()).nullable().optional().describe(agentProfileOptionField('modelParams')),
        }).strict().optional().describe(agentProfileField(AGENT_PROFILE_APPLY_INPUT_SCHEMA, 'options')),
      },
    },
    async (args, extra) => (await import('./agent-profile-tools')).agentProfileApplyHandler(args, {
      ...deps,
      signal: extra?.signal ?? deps.signal,
    }),
  )

  server.registerTool(
    'agent_profile_delete',
    {
      description: AGENT_PROFILE_DELETE_DESCRIPTION,
      inputSchema: {
        ids: z.array(z.string()).min(1).max(20).describe(agentProfileField(AGENT_PROFILE_DELETE_INPUT_SCHEMA, 'ids')),
      },
    },
    async (args, extra) => (await import('./agent-profile-tools')).agentProfileDeleteHandler(args, {
      ...deps,
      signal: extra?.signal ?? deps.signal,
    }),
  )

}

/** Field description from the shared JSON schema, so the Zod surface cannot drift from it. */
function agentProfileField(schema: { properties: Record<string, { description?: string }> }, field: string): string {
  return schema.properties[field]?.description ?? ''
}

function agentProfileOptionField(option: string): string {
  const options = AGENT_PROFILE_APPLY_INPUT_SCHEMA.properties.options as { properties: Record<string, { description?: string }> }
  return options.properties[option]?.description ?? ''
}
