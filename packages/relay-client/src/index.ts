export { PROCESSED_SEQ_CAP, SeqAckTracker, TransportAckRegistry } from './ack'
export { BUFFER_FIRST_ORDER, EventBuffer } from './buffer'
export { handleInboundFrame, makeDecrypt } from './frames'
export { LAN_SERVICE_TYPE, LAN_TXT_ROOM_ID, buildLanWsUrl, buildRelayWsUrl } from './connect'
export {
  LAN_PROBE_TIMEOUT_MS,
  RELAY_STATUS_TIMEOUT_MS,
  checkLanReachable,
  checkRelayDesktopOnline,
  parseLanHostPort,
  roomIdForSecret,
} from './presence'
export type { PresenceFetch, PresenceResponse } from './presence'
export { RpcInbox } from './rpc'
export { RelayClient } from './client'
export type { MobileIdentity, OpenSocket, SocketLike } from './client'
export { restoreSession } from './restore'
export {
  INLINE_UPLOAD_MAX_BYTES,
  MAX_UPLOAD_BYTES,
  classifyUpload,
  finishUpload,
  resolveLanUploadUrl,
  uploadBytes,
} from './attachments'
export {
  MAX_DOWNLOAD_BYTES,
  downloadDesktopFileBytes,
  downloadSharedFileBytes,
  type DesktopFileResponse,
  type DownloadDesktopFileOptions,
  type DownloadSharedFileOptions,
  type HttpGet,
  type HttpGetResponse,
} from './downloads'
export type { HttpPut, HttpPutResult, UploadBytesOptions } from './attachments'
export { TerminalAssembler } from './terminal'
export type { TerminalPaint } from './terminal'
export {
  PAIRINGS_KEY,
  MOBILE_ID_KEY,
  loadPairings,
  savePairings,
  parsePairings,
  serializePairings,
  upsertPairing,
  memoryKv,
} from './pairings'
export type { SavedPairing, Kv } from './pairings'
export {
  decryptPairResponse,
  encryptPairRequest,
  generatePairCode,
  pairWsUrl,
  parsePairQr,
  startPairingHandshake,
} from './pair'
export type { PairQr, PairResult } from './pair'
export type { FrameDecrypt, FrameEffect, InboundFrame, RelayControlFrame, TransportKind } from './frames'
export {
  FILE_CHUNK_SIZE,
  FILE_ENVELOPE_FORMAT_CHUNKED,
  FILE_ENVELOPE_HEADER_SIZE,
  FILE_ENVELOPE_VERSION,
  FILE_GCM_IV_SIZE,
  FILE_GCM_TAG_SIZE,
  bytesToBase64String,
  bytesToHexString,
  computeHmacToken,
  computeRoomId,
  decryptBytesChunked,
  decryptPayload,
  deriveKeys,
  encryptBytesChunked,
  encryptPayload,
  hexToByteArray,
} from './crypto'
