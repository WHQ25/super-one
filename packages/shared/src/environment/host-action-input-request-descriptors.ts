import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'
import {
  COMPOSER_REQUEST_DESCRIPTION,
  COMPOSER_REQUEST_FORM_DESCRIPTION,
  COMPOSER_REQUEST_SCHEMA_DESCRIPTION,
  COMPOSER_REQUEST_SUBMIT_LABEL_DESCRIPTION,
  COMPOSER_REQUEST_TITLE_DESCRIPTION,
} from '../superone-tool-descriptions'

/**
 * `composer_request`: one descriptor for desktop and nodes. It runs where the
 * session lives (node-local on remote nodes), never as a Host Action.
 */
export const INPUT_REQUEST_TOOL_DEFS: HostActionSuperoneToolDescriptor[] = [
  {
    name: 'composer_request',
    description: COMPOSER_REQUEST_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, description: COMPOSER_REQUEST_TITLE_DESCRIPTION },
        description: { type: 'string', description: COMPOSER_REQUEST_FORM_DESCRIPTION },
        requestedSchema: { type: 'object', description: COMPOSER_REQUEST_SCHEMA_DESCRIPTION },
        submitLabel: { type: 'string', description: COMPOSER_REQUEST_SUBMIT_LABEL_DESCRIPTION },
      },
      required: ['title', 'requestedSchema'],
      additionalProperties: false,
    },
  },
]
