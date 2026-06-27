import { writeFile } from 'node:fs/promises'
import type { UploadFileCompleteResponse, UploadFileError, UploadFileResponse } from '@superone/shared/agent-types'
import { authorizeWriteTarget, FileBridgeError } from '../file-bridge'
import log from '../logger'

export interface MobileReceiveTarget {
  deviceId: string
  projectPath: string
  allowedRoots: string[]
}

export interface MobileReceiveServiceDeps {
  resolveTarget(sessionId: string | undefined): MobileReceiveTarget | null
  signLanUploadUrl(savedPath: string): Promise<string | null>
  computeRelayKey(name: string): Promise<string>
  signRelayUploadUrl(key: string, meta: { mimeType: string; size: number }): Promise<string>
  downloadAndDecryptRelayFile(key: string): Promise<Buffer>
  deleteRelayFile(key: string): Promise<void>
  now(): number
}

export interface UploadFileRequest {
  requestId: string
  sessionId?: string
  targetDir: string
  name: string
  mimeType: string
  size: number
  inlineBase64?: string
  transport?: 'lan' | 'relay'
}

interface PendingRelayUpload {
  key: string
  savedPath: string
}

function mapFileBridgeError(err: FileBridgeError): UploadFileError {
  const error = err.code === 'not_found' ? 'forbidden_path' : err.code
  return { ok: false, error, message: err.message }
}

export class MobileReceiveService {
  private readonly pending = new Map<string, PendingRelayUpload>()

  constructor(private readonly deps: MobileReceiveServiceDeps) {}

  async handleUploadFile(req: UploadFileRequest): Promise<UploadFileResponse> {
    const target = this.deps.resolveTarget(req.sessionId)
    if (!target) {
      return { ok: false, error: 'no_session', message: 'No mobile session is connected.' }
    }

    let savedPath: string
    try {
      const authorized = await authorizeWriteTarget(req.targetDir, req.name, { allowedRoots: target.allowedRoots })
      savedPath = authorized.savedPath
    } catch (err) {
      if (err instanceof FileBridgeError) return mapFileBridgeError(err)
      return { ok: false, error: 'internal_error', message: (err as Error).message }
    }

    if (req.inlineBase64 != null) {
      try {
        await writeFile(savedPath, Buffer.from(req.inlineBase64, 'base64'))
        return { ok: true, status: 'saved', savedPath }
      } catch (err) {
        return { ok: false, error: 'internal_error', message: (err as Error).message }
      }
    }

    if (req.transport === 'lan') {
      try {
        const uploadUrl = await this.deps.signLanUploadUrl(savedPath)
        if (uploadUrl) return { ok: true, status: 'need_lan_put', uploadUrl, savedPath }
      } catch (err) {
        log.error('[MobileReceiveService] LAN upload url failed:', err)
      }
    }

    try {
      const key = await this.deps.computeRelayKey(req.name)
      const uploadUrl = await this.deps.signRelayUploadUrl(key, { mimeType: req.mimeType, size: req.size })
      this.pending.set(req.requestId, { key, savedPath })
      return { ok: true, status: 'need_r2_put', uploadUrl, key, savedPath }
    } catch (err) {
      log.error('[MobileReceiveService] relay upload url failed:', err)
      return { ok: false, error: 'no_transport', message: (err as Error).message }
    }
  }

  async handleUploadComplete(req: { requestId: string }): Promise<UploadFileCompleteResponse> {
    const pending = this.pending.get(req.requestId)
    if (!pending) {
      return { ok: false, error: 'internal_error', message: 'No pending upload for this request.' }
    }
    this.pending.delete(req.requestId)
    try {
      const bytes = await this.deps.downloadAndDecryptRelayFile(pending.key)
      await writeFile(pending.savedPath, bytes)
      return { ok: true, savedPath: pending.savedPath }
    } catch (err) {
      log.error('[MobileReceiveService] relay upload finalize failed:', err)
      return { ok: false, error: 'download_failed', message: (err as Error).message }
    } finally {
      this.deps.deleteRelayFile(pending.key).catch((err) => {
        log.error('[MobileReceiveService] R2 cleanup failed:', err)
      })
    }
  }
}
