import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'
import { LAYOUT_ACT_ACTIONS, LAYOUT_CHAT_MODES, LAYOUT_CHAT_POSITIONS, LAYOUT_DIRECTIONS } from '../layout-control'
import {
  LAYOUT_SNAPSHOT_DESCRIPTION,
  LAYOUT_ACT_DESCRIPTION,
  LAYOUT_ACT_PATH_DESCRIPTION,
  LAYOUT_ACT_LINE_DESCRIPTION,
  LAYOUT_ACT_TAB_DESCRIPTION,
  LAYOUT_ACT_DIRECTION_DESCRIPTION,
  LAYOUT_ACT_GROUP_DESCRIPTION,
  LAYOUT_ACT_INDEX_DESCRIPTION,
  LAYOUT_ACT_HEIGHT_DESCRIPTION,
  LAYOUT_ACT_SESSION_DESCRIPTION,
  LAYOUT_ACT_WIDTH_DESCRIPTION,
  LAYOUT_ACT_MODE_DESCRIPTION,
  LAYOUT_ACT_POSITION_DESCRIPTION,
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
        group: { type: 'integer', minimum: 0, description: LAYOUT_ACT_GROUP_DESCRIPTION },
        direction: { type: 'string', enum: [...LAYOUT_DIRECTIONS], description: LAYOUT_ACT_DIRECTION_DESCRIPTION },
        index: { type: 'integer', minimum: 0, description: LAYOUT_ACT_INDEX_DESCRIPTION },
        side: { type: 'string', enum: ['left', 'right'], description: 'panel_side.' },
        sessionId: { type: 'string', description: LAYOUT_ACT_SESSION_DESCRIPTION },
        width: { type: 'integer', minimum: 1, description: LAYOUT_ACT_WIDTH_DESCRIPTION },
        height: { type: 'integer', minimum: 1, description: LAYOUT_ACT_HEIGHT_DESCRIPTION },
        mode: { type: 'string', enum: [...LAYOUT_CHAT_MODES], description: LAYOUT_ACT_MODE_DESCRIPTION },
        position: { type: 'string', enum: [...LAYOUT_CHAT_POSITIONS], description: LAYOUT_ACT_POSITION_DESCRIPTION },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
]
