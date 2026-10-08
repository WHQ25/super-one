import { mkdir, writeFile } from 'node:fs/promises'
import type { InputRequestUploadBinding, MobileUploadProgress, UploadFileCompleteResponse, UploadFileError, UploadFileResponse } from '@superone/shared/agent-types'
import { authorizeWriteTarget, FileBridgeError } from '../file-bridge'
import log from '../logger'

export interface MobileReceiveTarget {
  deviceId: string
  deviceName?: string
  projectPath: string
  allowedRoots: string[]
}

export interface MobileReceiveServiceDeps {
  resolveTarget(sessionId: string | undefined): MobileReceiveTarget | null
  /** Host-chosen directory for a file answering an input-request field; throws when the form no longer asks for it. */
  resolveInputRequestUploadDir?(sessionId: string | undefined, binding: InputRequestUploadBinding, fileName: string): string
  signLanUploadUrl(savedPath: string): Promise<string | null>
  computeRelayKey(name: string): Promise<string>
  signRelayUploadUrl(key: string, meta: { mimeType: string; size: number }): Promise<string>
  /** Opens a file the phone `deviceId` sealed under its own keys. */
  downloadAndDecryptRelayFile(key: string, deviceId: string, onProgress?: (loadedFraction: number) => void): Promise<Buffer>
  deleteRelayFile(key: string): Promise<void>
  emitProgress(event: MobileUploadProgress): void
  now(): number
}

export interface UploadFileRequest {
  requestId: string
  sessionId?: string
  targetDir: string
  /** When set, `targetDir` is ignored in favour of the request's staging directory. */
  inputRequest?: InputRequestUploadBinding
  name: string
  mimeType: string
  size: number
  inlineBase64?: string
  transport?: 'lan' | 'relay'
}

interface UploadMeta {
  requestId: string
  deviceId: string
  deviceName?: string
  targetDir: string
  fileName: string
  savedPath: string
  size: number
}

interface PendingRelayUpload extends UploadMeta {
  key: string
}

function mapFileBridgeError(err: FileBridgeError): UploadFileError {
  const error = err.code === 'not_found' ? 'forbidden_path' : err.code
  return { ok: false, error, message: err.message }
}

export class MobileReceiveService {
  private readonly pending = new Map<string, PendingRelayUpload>()
  private readonly lanPending = new Map<string, UploadMeta>()

  constructor(private readonly deps: MobileReceiveServiceDeps) {}

  private emit(
    meta: UploadMeta,
    transport: MobileUploadProgress['transport'],
    status: MobileUploadProgress['status'],
    receivedBytes: number,
    error?: string,
  ): void {
    this.deps.emitProgress({
      requestId: meta.requestId,
      deviceId: meta.deviceId,
      deviceName: meta.deviceName,
      fileName: meta.fileName,
      targetDir: meta.targetDir,
      savedPath: meta.savedPath,
      size: meta.size,
      receivedBytes,
      status,
      transport,
      error,
    })
  }

  async handleUploadFile(req: UploadFileRequest): Promise<UploadFileResponse> {
    const target = this.deps.resolveTarget(req.sessionId)
    if (!target) {
      return { ok: false, error: 'no_session', message: 'No mobile session is connected.' }
    }

    let targetDir = req.targetDir
    let allowedRoots = target.allowedRoots
    if (req.inputRequest) {
      try {
        if (!this.deps.resolveInputRequestUploadDir) throw new Error('Form uploads are unavailable')
        targetDir = this.deps.resolveInputRequestUploadDir(req.sessionId, req.inputRequest, req.name)
        await mkdir(targetDir, { recursive: true })
      } catch (err) {
        return { ok: false, error: 'forbidden_path', message: (err as Error).message }
      }
      allowedRoots = [targetDir]
    }

    let savedPath: string
    try {
      const authorized = await authorizeWriteTarget(targetDir, req.name, { allowedRoots })
      savedPath = authorized.savedPath
    } catch (err) {
      if (err instanceof FileBridgeError) return mapFileBridgeError(err)
      return { ok: false, error: 'internal_error', message: (err as Error).message }
    }

    const meta: UploadMeta = {
      requestId: req.requestId,
      deviceId: target.deviceId,
      deviceName: target.deviceName,
      targetDir,
      fileName: req.name,
      savedPath,
      size: req.size,
    }

    if (req.inlineBase64 != null) {
      this.emit(meta, 'inline', 'receiving', 0)
      try {
        const bytes = Buffer.from(req.inlineBase64, 'base64')
        await writeFile(savedPath, bytes)
        this.emit(meta, 'inline', 'completed', bytes.byteLength)
        return { ok: true, status: 'saved', savedPath }
      } catch (err) {
        this.emit(meta, 'inline', 'failed', 0, (err as Error).message)
        return { ok: false, error: 'internal_error', message: (err as Error).message }
      }
    }

    if (req.transport === 'lan') {
      try {
        const uploadUrl = await this.deps.signLanUploadUrl(savedPath)
        if (uploadUrl) {
          this.lanPending.set(savedPath, meta)
          this.emit(meta, 'lan', 'receiving', 0)
          return { ok: true, status: 'need_lan_put', uploadUrl, savedPath }
        }
      } catch (err) {
        log.error('[MobileReceiveService] LAN upload url failed:', err)
      }
    }

    try {
      const key = await this.deps.computeRelayKey(req.name)
      const uploadUrl = await this.deps.signRelayUploadUrl(key, { mimeType: req.mimeType, size: req.size })
      this.pending.set(req.requestId, { ...meta, key })
      this.emit(meta, 'relay', 'receiving', 0)
      return { ok: true, status: 'need_r2_put', uploadUrl, key, savedPath }
    } catch (err) {
      log.error('[MobileReceiveService] relay upload url failed:', err)
      return { ok: false, error: 'no_transport', message: (err as Error).message }
    }
  }

  handleLanUploadProgress(info: { savedPath: string; receivedBytes: number; done: boolean; error?: string }): void {
    const meta = this.lanPending.get(info.savedPath)
    if (!meta) return
    if (info.error) {
      this.lanPending.delete(info.savedPath)
      this.emit(meta, 'lan', 'failed', info.receivedBytes, info.error)
      return
    }
    if (info.done) {
      this.lanPending.delete(info.savedPath)
      this.emit(meta, 'lan', 'completed', info.receivedBytes || meta.size)
      return
    }
    this.emit(meta, 'lan', 'receiving', info.receivedBytes)
  }

  async handleUploadComplete(req: { requestId: string }): Promise<UploadFileCompleteResponse> {
    const pending = this.pending.get(req.requestId)
    if (!pending) {
      return { ok: false, error: 'internal_error', message: 'No pending upload for this request.' }
    }
    this.pending.delete(req.requestId)
    try {
      const bytes = await this.deps.downloadAndDecryptRelayFile(pending.key, pending.deviceId, (fraction) => {
        this.emit(pending, 'relay', 'receiving', Math.round(fraction * pending.size))
      })
      await writeFile(pending.savedPath, bytes)
      this.emit(pending, 'relay', 'completed', bytes.byteLength)
      return { ok: true, savedPath: pending.savedPath }
    } catch (err) {
      this.emit(pending, 'relay', 'failed', 0, (err as Error).message)
      log.error('[MobileReceiveService] relay upload finalize failed:', err)
      return { ok: false, error: 'download_failed', message: (err as Error).message }
    } finally {
      this.deps.deleteRelayFile(pending.key).catch((err) => {
        log.error('[MobileReceiveService] R2 cleanup failed:', err)
      })
    }
  }
}
