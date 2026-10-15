import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'
import {
  AGENT_PROFILE_APPLY_DESCRIPTION,
  AGENT_PROFILE_DELETE_DESCRIPTION,
  AGENT_PROFILE_LIST_DESCRIPTION,
} from '../superone-tool-descriptions'

export const AGENT_PROFILE_LIST_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'Profile id. Returns full instructions, launch defaults, and the harness model options.',
    },
  },
  additionalProperties: false,
}

export const AGENT_PROFILE_APPLY_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['create', 'update'], description: 'create a new profile, or update an existing one.' },
    id: { type: 'string', description: 'Required for update. Profile id from agent_profile_list.' },
    harnessId: {
      type: 'string',
      enum: ['claude', 'codex', 'acp', 'opencode', 'cursor', 'dsh'],
      description: 'Required for create; fixed afterwards.',
    },
    name: { type: 'string', description: 'Display name and @-mention label. Required for create.' },
    description: { type: 'string', description: 'What this agent is for, read by other agents choosing a delegate. Required for create.' },
    instructions: { type: 'string', description: 'Added to the agent\'s system prompt on every launch.' },
    model: { type: 'string', description: 'Base model id from the harness catalog. Omit to follow the user\'s default.' },
    effort: { type: 'string', description: 'Effort level the model supports.' },
    options: {
      type: 'object',
      description: 'The harness\'s own settings; agent_profile_list({ id }) lists which ones its models accept. null clears one.',
      properties: {
        ultracode: { type: ['boolean', 'null'], description: 'Claude: Ultracode, on models with xhigh effort.' },
        fastMode: { type: ['boolean', 'null'], description: 'Codex: the model\'s Fast service tier.' },
        contextWindow: { type: ['integer', 'null'], description: 'ACP: one of the model\'s context windows, in tokens.' },
        mode: { type: ['string', 'null'], description: 'ACP: a session mode the agent lists.' },
        agent: { type: ['string', 'null'], description: 'OpenCode: native agent id.' },
        agentPreset: { type: ['string', 'null'], description: 'DeepSeek: agent preset id.' },
        modelParams: {
          type: ['object', 'null'],
          additionalProperties: { type: 'string' },
          description: 'Cursor: model parameter values by parameter id.',
        },
      },
      additionalProperties: false,
    },
  },
  required: ['action'],
  additionalProperties: false,
}

export const AGENT_PROFILE_DELETE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    ids: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 20,
      description: 'Profile ids from agent_profile_list.',
    },
  },
  required: ['ids'],
  additionalProperties: false,
}

export const HOST_ACTION_AGENT_PROFILE_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  { name: 'agent_profile_list', description: AGENT_PROFILE_LIST_DESCRIPTION, inputSchema: AGENT_PROFILE_LIST_INPUT_SCHEMA },
  { name: 'agent_profile_apply', description: AGENT_PROFILE_APPLY_DESCRIPTION, inputSchema: AGENT_PROFILE_APPLY_INPUT_SCHEMA },
  { name: 'agent_profile_delete', description: AGENT_PROFILE_DELETE_DESCRIPTION, inputSchema: AGENT_PROFILE_DELETE_INPUT_SCHEMA },
]
