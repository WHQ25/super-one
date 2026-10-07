import type { PermissionRequest } from './agent-types'

export type PermissionDetailSectionId = 'action' | 'resources' | 'source' | 'toolInput' | 'metadata' | 'save'
export interface PermissionDetailSection {
  id: PermissionDetailSectionId
  value: string
}

/** Lossless review values shared by the desktop prompt and the native phone sheet. */
export function permissionDetailSections(request: PermissionRequest): PermissionDetailSection[] {
  const details = request.permissionDetails
  if (!details) return []
  const sections: PermissionDetailSection[] = [{ id: 'action', value: details.action }]
  if (details.resources.length) sections.push({ id: 'resources', value: details.resources.join('\n') })
  if (details.source) {
    const { input, ...identity } = details.source
    const source = [identity.toolName, identity.toolUseId, identity.messageId].filter(Boolean).join(' · ')
    if (source) sections.push({ id: 'source', value: source })
    if (input) sections.push({ id: 'toolInput', value: JSON.stringify(input, null, 2) })
  }
  if (details.metadata && Object.keys(details.metadata).length) {
    sections.push({ id: 'metadata', value: JSON.stringify(details.metadata, null, 2) })
  }
  if (details.save?.length) sections.push({ id: 'save', value: details.save.join('\n') })
  return sections
}

/** Older adapters used the message for resources; don't repeat those beneath a scope section. */
export function permissionDetailMessage(request: PermissionRequest): string {
  const message = request.message?.trim() ?? ''
  const details = request.permissionDetails
  return details && (message === details.resources.join('\n') || message === details.action) ? '' : message
}

export function permissionDetailSummary(request: PermissionRequest, toolSummary = ''): string {
  return request.permissionDetails?.resources.join('\n') || toolSummary || request.message || ''
}
