import { McpAppsError, type McpAppAttachmentUpdate, type ToolAppAttachment } from '@superone/shared/mcp-apps'
import type { McpAppResourceSnapshot, McpAppResourceStore } from '@superone/shared/mcp-app-resource'
import { validateMcpAppAttachmentUpdate } from '@superone/shared/mcp-apps-state'

/** The saved HTML of an App, inline or from the host's resource store. */
export function hydrateMcpAppResource(app: ToolAppAttachment, store: McpAppResourceStore | undefined): McpAppResourceSnapshot {
  if (!app.resource) throw new McpAppsError('invalid', 'Saved MCP App resource is unavailable')
  if (app.resource.html !== undefined) return app.resource as McpAppResourceSnapshot
  if (!store) throw new McpAppsError('invalid', 'Saved MCP App HTML is unavailable')
  return store.hydrate(app.resource)
}

/**
 * A remote host's state write as the owning host persists it: HTML moves into
 * the resource store and model context is attributed to the App it came from.
 */
export function mcpAppStatePatch(app: ToolAppAttachment, update: McpAppAttachmentUpdate, store: McpAppResourceStore | undefined): McpAppAttachmentUpdate {
  // A remote writer must supply bytes; accepting a caller-chosen CAS reference
  // could attach another session's blob to an otherwise authorized View.
  if (update.resource && update.resource.html === undefined) throw new McpAppsError('invalid', 'MCP App resource updates must include HTML')
  const patch: McpAppAttachmentUpdate = {
    ...(update.resource ? { resource: update.resource.html !== undefined && store ? store.put(update.resource as McpAppResourceSnapshot) : update.resource } : {}),
    ...(update.presentation ? { presentation: update.presentation } : {}),
    ...(update.modelContext !== undefined ? { modelContext: update.modelContext ? { ...update.modelContext, source: { appInstanceId: app.appInstanceId, server: app.binding.server } } : null } : {}),
  }
  validateMcpAppAttachmentUpdate(patch)
  return patch
}
