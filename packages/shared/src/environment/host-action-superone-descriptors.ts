/** Remote Host Action catalog. Family modules preserve the desktop tool order.
 * Shared description constants prevent prompt drift; parity tests guard schemas. */
import { INTERACTION_MEMORY_TOOL_DEFS } from '../interaction-memory'
import { HOST_ACTION_COLLABORATION_DESCRIPTORS } from './host-action-collaboration-descriptors'
import { HOST_ACTION_SETUP_DESCRIPTORS } from './host-action-setup-descriptors'
import { HOST_ACTION_ARCHIVE_DESCRIPTORS } from './host-action-archive-descriptors'
import { HOST_ACTION_MEDIA_DESCRIPTORS } from './host-action-media-descriptors'
import { HOST_ACTION_BROWSER_DESCRIPTORS } from './host-action-browser-descriptors'
import { HOST_ACTION_MINIAPP_DESCRIPTORS } from './host-action-miniapp-descriptors'
import { HOST_ACTION_COMPUTER_DESCRIPTORS } from './host-action-computer-descriptors'
import { HOST_ACTION_WIDGET_DESCRIPTORS } from './host-action-widget-descriptors'
import { HOST_ACTION_AUTOMATION_DESCRIPTORS } from './host-action-automation-descriptors'
import { HOST_ACTION_DEVICE_DESCRIPTORS } from './host-action-device-descriptors'
import { HOST_ACTION_BROWSER_PERF_DESCRIPTORS } from './host-action-browser-perf-descriptors'

export interface HostActionSuperoneToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** Optional MCP tool meta (e.g. anthropic/alwaysLoad). */
  _meta?: Record<string, unknown>
}

export const HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  ...INTERACTION_MEMORY_TOOL_DEFS,
  ...HOST_ACTION_COLLABORATION_DESCRIPTORS,
  ...HOST_ACTION_SETUP_DESCRIPTORS,
  ...HOST_ACTION_ARCHIVE_DESCRIPTORS,
  ...HOST_ACTION_MEDIA_DESCRIPTORS,
  ...HOST_ACTION_BROWSER_DESCRIPTORS,
  ...HOST_ACTION_MINIAPP_DESCRIPTORS,
  ...HOST_ACTION_COMPUTER_DESCRIPTORS,
  ...HOST_ACTION_WIDGET_DESCRIPTORS,
  ...HOST_ACTION_AUTOMATION_DESCRIPTORS,
  ...HOST_ACTION_DEVICE_DESCRIPTORS,
  ...HOST_ACTION_BROWSER_PERF_DESCRIPTORS,
]
