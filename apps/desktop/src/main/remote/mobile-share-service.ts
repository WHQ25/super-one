import { readFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import type { AgentEvent, ShareFilePayload } from '@superone/shared/agent-types'
import type { RelayUploadResult } from '../relay-file-uploader'
import { authorizeAndStat, FileBridgeError, type AuthorizedFile } from '../file-bridge'
import type { MobileShareToolResult } from '../mcp/superone-mcp-server'
import log from '../logger'

const INLINE_MAX_BYTES = 256 * 1024

export interface MobileShareTarget {
  deviceId: string
  projectPath: string
  allowedRoots: string[]
}

export interface MobileShareServiceDeps {
  resolveTarget(sessionId: string): MobileShareTarget | null
  resolveDeviceName(deviceId: string): string | null
  uploadFileToRelay(
    realPath: string,
    meta: { mimeType: string; size: number },
    sessionId: string,
    onProgress?: (loadedFraction: number) => void,
  ): Promise<RelayUploadResult>
  sendAgentEvent(event: AgentEvent, targetDeviceIds: string[]): Promise<void>
  emitToRenderer(event: AgentEvent): void
  now(): number
}

export class MobileShareService {
  constructor(private readonly deps: MobileShareServiceDeps) {}

  async shareFile(req: { sessionId: string; path: string; caption?: string }): Promise<MobileShareToolResult> {
    const target = this.deps.resolveTarget(req.sessionId)
    if (!target) {
      return { ok: false, error: 'No mobile device is connected to this session.' }
    }

    let authorized: AuthorizedFile
    try {
      authorized = await authorizeAndStat(req.path, { allowedRoots: target.allowedRoots })
    } catch (err) {
      if (err instanceof FileBridgeError) return { ok: false, error: err.message }
      return { ok: false, error: (err as Error).message }
    }

    const total = authorized.size
    const emitProgress = (loaded: number): void => {
      this.deps.emitToRenderer({
        type: 'shared_file_progress',
        path: req.path,
        loaded: Math.min(loaded, total),
        total,
        sessionId: req.sessionId,
        projectPath: target.projectPath,
      })
    }

    let payload: ShareFilePayload
    let transport: 'inline' | 'relay'
    let expiresAt: number | undefined
    try {
      emitProgress(0)
      if (total <= INLINE_MAX_BYTES) {
        const bytes = await readFile(authorized.realPath)
        payload = {
          name: authorized.name,
          mimeType: authorized.mimeType,
          size: total,
          caption: req.caption,
          inlineBase64: bytes.toString('base64'),
        }
        transport = 'inline'
      } else {
        const result = await this.deps.uploadFileToRelay(
          authorized.realPath,
          { mimeType: authorized.mimeType, size: total },
          req.sessionId,
          (fraction) => emitProgress(Math.round(total * fraction)),
        )
        payload = {
          name: authorized.name,
          mimeType: authorized.mimeType,
          size: total,
          caption: req.caption,
          downloadUrl: result.downloadUrl,
          expiresAt: result.expiresAt,
          encryption: result.encryption,
        }
        transport = 'relay'
        expiresAt = result.expiresAt
      }
      emitProgress(total)
    } catch (err) {
      log.error('[MobileShareService] prepare failed:', err)
      return { ok: false, error: (err as Error).message }
    }

    const sentAt = this.deps.now()
    const shareId = randomUUID()
    try {
      await this.deps.sendAgentEvent(
        { type: 'shared_file', shareId, file: payload, sentAt, sessionId: req.sessionId, projectPath: target.projectPath },
        [target.deviceId],
      )
    } catch (err) {
      log.error('[MobileShareService] delivery failed:', err)
      return { ok: false, error: `Failed to deliver file to device: ${(err as Error).message}` }
    }

    const deviceName = this.deps.resolveDeviceName(target.deviceId) ?? 'mobile device'
    return {
      ok: true,
      shareId,
      name: authorized.name,
      size: total,
      mimeType: authorized.mimeType,
      deviceName,
      sentAt,
      path: req.path,
      transport,
      expiresAt,
    }
  }
}
