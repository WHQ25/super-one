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
  LAYOUT_TARGET_DESCRIPTION,
} from '../superone-tool-descriptions'

const sessionRef = {
  type: 'object', properties: { environmentId: { type: 'string', minLength: 1 }, sessionId: { type: 'string', minLength: 1 } }, required: ['environmentId', 'sessionId'], additionalProperties: false,
}
const target = {
  description: LAYOUT_TARGET_DESCRIPTION,
  anyOf: [
    { type: 'string', enum: ['caller', 'foreground'] },
    sessionRef,
  ],
}

/**
 * `layout_*` descriptors (docs/features/layout-control.md). Defined once here: the desktop
 * built-in list spreads them and the Zod registration is derived from the JSON
 * Schema. Node sessions execute against their connected desktop's main window.
 */
export const HOST_ACTION_LAYOUT_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  {
    name: 'layout_snapshot',
    description: LAYOUT_SNAPSHOT_DESCRIPTION,
    inputSchema: { type: 'object', properties: { target }, additionalProperties: false },
  },
  {
    name: 'layout_act',
    description: LAYOUT_ACT_DESCRIPTION,
    inputSchema: {
      type: 'object',
      $defs: {
        splitLayout: { anyOf: [
          { type: 'integer', minimum: 0 },
          {
            type: 'object',
            properties: {
              direction: { type: 'string', enum: ['row', 'column'] },
              ratio: { type: 'number', minimum: 0.05, maximum: 0.95 },
              first: { $ref: '#/$defs/splitLayout' },
              second: { $ref: '#/$defs/splitLayout' },
            },
            required: ['direction', 'first', 'second'], additionalProperties: false,
          },
        ] },
      },
      properties: {
        target,
        action: { type: 'string', enum: [...LAYOUT_ACT_ACTIONS] },
        path: { type: 'string', description: LAYOUT_ACT_PATH_DESCRIPTION },
        line: { type: 'integer', minimum: 1, description: LAYOUT_ACT_LINE_DESCRIPTION },
        tab: { type: 'string', description: LAYOUT_ACT_TAB_DESCRIPTION },
        group: { type: 'integer', minimum: 0, description: LAYOUT_ACT_GROUP_DESCRIPTION },
        direction: { type: 'string', enum: [...LAYOUT_DIRECTIONS], description: LAYOUT_ACT_DIRECTION_DESCRIPTION },
        index: { type: 'integer', minimum: 0, description: LAYOUT_ACT_INDEX_DESCRIPTION },
        side: { type: 'string', enum: ['left', 'right'], description: 'panel_side.' },
        sessionId: { type: 'string', description: LAYOUT_ACT_SESSION_DESCRIPTION },
        sessionEnvironmentId: { type: 'string', description: 'split_session / close_split: peer environment ID; default the target session environment. localhost means the invoking session host.' },
        sessionIds: {
          type: 'array', minItems: 1,
          description: 'split_session: complete final list (current session included only if listed); automatic arrangement unless layout is supplied. close_split: tiles to remove together. Strings use sessionEnvironmentId or target environment; objects qualify each host. Excludes sessionId; batch split also excludes direction.',
          items: { anyOf: [
            { type: 'string', minLength: 1 },
            sessionRef,
          ] },
        },
        layout: {
          $ref: '#/$defs/splitLayout',
          description: 'split_session + sessionIds: explicit split tree. Each leaf is a 0-based sessionIds index, used exactly once. Branch: {direction: row (left/right) or column (top/bottom), first, second, ratio?}. Ratio is first share excluding divider, default 0.5. Nested splits and proportions must fit minimum tile sizes. Omit for automatic layout.',
        },
        closeAll: { type: 'boolean', description: 'close_split: retain the focused session alone and clear the saved mosaic. Excludes sessionId/sessionIds. Never stops tasks or deletes sessions.' },
        dividers: {
          type: 'array', minItems: 1,
          description: 'resize_splits: unique divider ids from layout_snapshot and target first-child ratios, applied together. Final tree must respect minimum tile sizes. Read fresh ids after topology changes.',
          items: { type: 'object', properties: { id: { type: 'string', minLength: 1 }, ratio: { type: 'number', minimum: 0.05, maximum: 0.95 } }, required: ['id', 'ratio'], additionalProperties: false },
        },
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
