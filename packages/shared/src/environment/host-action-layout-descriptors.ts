import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'
import { LAYOUT_ACT_ACTIONS } from '../layout-control'
import {
  LAYOUT_SNAPSHOT_DESCRIPTION,
  LAYOUT_ACT_DESCRIPTION,
  LAYOUT_ACT_PATH_DESCRIPTION,
  LAYOUT_ACT_LINE_DESCRIPTION,
  LAYOUT_ACT_TAB_DESCRIPTION,
  LAYOUT_ACT_DIRECTION_DESCRIPTION,
  LAYOUT_ACT_SESSION_DESCRIPTION,
} from '../superone-tool-descriptions'

/**
 * `layout_*` descriptors (docs/features/layout-control.md). Defined once here: the desktop
 * built-in list spreads them and the Zod registration is derived from the JSON
 * Schema. Remote-node sessions get an explicit unsupported result from the executor.
 */
export const HOST_ACTION_LAYOUT_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  {
    name: 'layout_snapshot',
    description: LAYOUT_SNAPSHOT_DESCRIPTION,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'layout_act',
    description: LAYOUT_ACT_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...LAYOUT_ACT_ACTIONS] },
        path: { type: 'string', description: LAYOUT_ACT_PATH_DESCRIPTION },
        line: { type: 'integer', minimum: 1, description: LAYOUT_ACT_LINE_DESCRIPTION },
        tab: { type: 'string', description: LAYOUT_ACT_TAB_DESCRIPTION },
        direction: { type: 'string', enum: ['right', 'down'], description: LAYOUT_ACT_DIRECTION_DESCRIPTION },
        side: { type: 'string', enum: ['left', 'right'], description: 'panel_side.' },
        sessionId: { type: 'string', description: LAYOUT_ACT_SESSION_DESCRIPTION },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
]
