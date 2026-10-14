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
    fastMode: { type: 'boolean', description: 'Run on the model\'s fast tier, where it has one.' },
    context: { type: 'string', enum: ['default', '1m'], description: '"1m" picks the model\'s 1M-context variant; needs model.' },
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
