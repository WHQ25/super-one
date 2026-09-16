import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'
import {
  TERMINAL_TABS_DESCRIPTION,
  TERMINAL_SNAPSHOT_DESCRIPTION,
  TERMINAL_ACT_DESCRIPTION,
  TERMINAL_WAIT_FOR_DESCRIPTION,
} from '../superone-tool-descriptions'

/**
 * `terminal_*` descriptors (docs/design/terminal-agent-tools.md). Defined once here:
 * the desktop built-in list spreads them and the Zod registration is derived from
 * the JSON Schema, so Claude, the stdio bridge, and remote nodes cannot drift.
 * Remote-node sessions receive an explicit unsupported result from the executor.
 */

/** Shared by `terminal_act.expect` and `terminal_wait_for`; conditions AND-combine. */
const TERMINAL_WAIT_CONDITION_PROPERTIES = {
  text: { type: 'string', description: 'Substring that must appear on screen or in recent output.' },
  textGone: { type: 'string', description: 'Substring that must be absent from the screen.' },
  idleMs: { type: 'number', description: 'No output for this many milliseconds.' },
  exited: { type: 'boolean', description: 'The controlled command has left the foreground (or the tab exited).' },
} as const

export const TERMINAL_ACTION_INPUT_SCHEMA = {
  type: 'object',
  description: 'type: text (+Enter unless enter=false) · key: named key (Enter, Tab, Escape, Up, Ctrl+C, Alt+b, F1…) with optional repeat · raw: bytes verbatim · resize: cols/rows · wait: ms (≤5000, inside a batch).',
  properties: {
    type: { type: 'string', enum: ['type', 'key', 'raw', 'resize', 'wait'] },
    text: { type: 'string' },
    enter: { type: 'boolean', description: 'type only. Default true.' },
    key: { type: 'string' },
    repeat: { type: 'number', description: 'key only. 1–100.' },
    bytes: { type: 'string' },
    cols: { type: 'number' },
    rows: { type: 'number' },
    ms: { type: 'number' },
  },
  required: ['type'],
  additionalProperties: false,
} as const

export const HOST_ACTION_TERMINAL_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  {
    name: 'terminal_tabs',
    description: TERMINAL_TABS_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'run', 'attach', 'close'], description: 'Default list.' },
        tab: {
          type: ['string', 'array'],
          items: { type: 'string' },
          minItems: 1,
          description: 'Tab id from list. run: reuse this idle tab instead of opening one. attach/close: the target (close accepts an array).',
        },
        command: { type: 'string', description: 'run only. The command the user approves and that is typed into the shell.' },
        rule: {
          type: 'string',
          description:
            'run only. The rule offered as "always allow in this project" next to the approval: the command cut down to its stable leading words plus ":*", e.g. "bun run:*" for "bun run dev", "git commit:*" for "git commit -m …". It must match `command`; keep it as narrow as the user would want (never a bare "sudo:*" / "ssh:*"). Default: derived from the command.',
        },
        cwd: { type: 'string', description: 'run only. Absolute working directory for a new tab. Default: the session working directory.' },
        title: { type: 'string', description: 'run only. Tab title shown to the user. Default: the command name.' },
        size: {
          type: 'object',
          properties: { cols: { type: 'number' }, rows: { type: 'number' } },
          required: ['cols', 'rows'],
          additionalProperties: false,
          description: 'run only. Initial size of a new tab. Default 120×40.',
        },
        yieldMs: { type: 'number', description: 'run only. How long to wait for the command to start and go quiet before returning. Default 5000, max 30000.' },
        description: { type: 'string', description: 'Shown to the user instead of raw arguments.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'terminal_snapshot',
    description: TERMINAL_SNAPSHOT_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        tab: { type: 'string', description: 'Tab id from terminal_tabs.' },
        include: {
          type: 'array',
          items: { type: 'string', enum: ['screen', 'scrollback', 'cursor', 'meta'] },
          description: 'Sections to return. Default [screen].',
        },
        tail: { type: 'number', description: 'scrollback only. Lines from the end. Default 200, max 2000.' },
      },
      required: ['tab'],
      additionalProperties: false,
    },
  },
  {
    name: 'terminal_act',
    description: TERMINAL_ACT_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        tab: { type: 'string', description: 'Tab id from terminal_tabs.' },
        actions: {
          type: 'array',
          items: TERMINAL_ACTION_INPUT_SCHEMA,
          minItems: 1,
          maxItems: 20,
          description: 'Normally one action. Use 2–20 only for a single uninterruptible sequence; they run in order, fail-fast.',
        },
        expect: {
          type: 'object',
          properties: TERMINAL_WAIT_CONDITION_PROPERTIES,
          additionalProperties: false,
          description: 'Completion condition to wait for after the batch.',
        },
        timeoutMs: { type: 'number', description: 'Maximum wait for expect. Default 15000, max 60000.' },
        description: { type: 'string', description: 'Shown to the user instead of raw keystrokes.' },
      },
      required: ['tab', 'actions'],
      additionalProperties: false,
    },
  },
  {
    name: 'terminal_wait_for',
    description: TERMINAL_WAIT_FOR_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        tab: { type: 'string', description: 'Tab id from terminal_tabs.' },
        ...TERMINAL_WAIT_CONDITION_PROPERTIES,
        timeoutMs: { type: 'number', description: 'Maximum wait in milliseconds. Default 15000, max 120000.' },
      },
      required: ['tab'],
      additionalProperties: false,
    },
  },
]
