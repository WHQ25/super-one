/** Read-only access to files under the serving host's OS temporary directories. */
export const TEMP_FILE_RPC_METHODS = {
  stat: 'fs.statTempFile',
  read: 'fs.readTempFile',
} as const

export interface TempFileStatResult {
  exists: boolean
  size: number
  mtimeMs: number
}

export interface TempFileReadRequest {
  path: string
  offset: number
  maxBytes: number
}

export interface TempFileReadResult {
  chunk: string
  total: number
  mtimeMs: number
  eof: boolean
}

/** Leaves room for base64 and the envelope within the RPC frame budget. */
export const TEMP_FILE_CHUNK_BYTES = 4 * 1024 * 1024
