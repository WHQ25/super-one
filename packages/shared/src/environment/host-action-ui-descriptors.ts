import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'
import { UI_ACT_ACTIONS } from '../ui-control'
import {
  UI_SNAPSHOT_DESCRIPTION,
  UI_ACT_DESCRIPTION,
  UI_ACT_PATH_DESCRIPTION,
  UI_ACT_LINE_DESCRIPTION,
  UI_ACT_COMMIT_DESCRIPTION,
  UI_ACT_TAB_DESCRIPTION,
  UI_ACT_DIRECTION_DESCRIPTION,
  UI_ACT_SESSION_DESCRIPTION,
} from '../superone-tool-descriptions'

/**
 * `ui_*` descriptors (docs/features/ui-control.md). Defined once here: the desktop
 * built-in list spreads them and the Zod registration is derived from the JSON
 * Schema. Remote-node sessions get an explicit unsupported result from the executor.
 */
export const HOST_ACTION_UI_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  {
    name: 'ui_snapshot',
    description: UI_SNAPSHOT_DESCRIPTION,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ui_act',
    description: UI_ACT_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...UI_ACT_ACTIONS] },
        path: { type: 'string', description: UI_ACT_PATH_DESCRIPTION },
        line: { type: 'integer', minimum: 1, description: UI_ACT_LINE_DESCRIPTION },
        commit: { type: 'string', description: UI_ACT_COMMIT_DESCRIPTION },
        tab: { type: 'string', description: UI_ACT_TAB_DESCRIPTION },
        direction: { type: 'string', enum: ['right', 'down'], description: UI_ACT_DIRECTION_DESCRIPTION },
        side: { type: 'string', enum: ['left', 'right'], description: 'panel_side.' },
        sessionId: { type: 'string', description: UI_ACT_SESSION_DESCRIPTION },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
]
