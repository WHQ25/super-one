export { BUFFER_FIRST_ORDER, EventBuffer } from './buffer'
export { handleInboundFrame } from './frames'
export { LAN_SERVICE_TYPE, LAN_TXT_ROOM_ID, buildLanWsUrl, buildRelayWsUrl } from './connect'
export {
  LAN_PROBE_TIMEOUT_MS,
  RELAY_STATUS_TIMEOUT_MS,
  checkLanReachable,
  checkRelayDesktopOnline,
  parseLanHostPort,
} from './presence'
export type { PresenceFetch, PresenceResponse } from './presence'
export { RelayClient } from './client'
export type { HostLink, MobileIdentity, OpenSocket, SocketLike } from './client'
export { DesktopUpgradeRequiredError, MIN_PHONE_DESKTOP_VERSION } from './phone-protocol'
export type { PhoneRpcOptions, PhoneTopicStream } from './phone-protocol'
export { RestoreRejectedError, restoreSession, mergeCachedHistory, appendHistory, dropIncompleteTail } from './restore'
export type { CachedTranscript, HistoryPage, RestoredSession, SessionSnapshot } from './restore'
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
  downloadEncryptedFileBytes,
  type DesktopFileResponse,
  type DownloadDesktopFileOptions,
  type DownloadEncryptedFileOptions,
  type DownloadProgress,
  type EncryptedFile,
  type HttpGet,
  type HttpGetResponse,
} from './downloads'
export type { HttpPut, HttpPutResult, UploadBytesOptions } from './attachments'
export { TerminalAssembler } from './terminal'
export type { TerminalPaint } from './terminal'
export type { PhoneTerminalStream } from './terminal-feed'
export {
  PAIRINGS_KEY,
  MOBILE_ID_KEY,
  loadPairings,
  savePairings,
  parsePairings,
  serializePairings,
  upsertPairing,
  memoryKv,
  pairingNeedsRepair,
  hostLinkOf,
} from './pairings'
export type { SavedPairing, Kv } from './pairings'
export {
  decryptPairResponse,
  encryptPairRequest,
  OutdatedDesktopPairingError,
  pairWsUrl,
  parsePairQr,
  startPairingHandshake,
} from './pair'
export type { PairQr, PairResult } from './pair'
export { generatePairCode, joinPairRoom, newPairRoomKeys, PAIR_ROOM_TIMEOUT_MS } from './pair-room'
export type { OpenPairRoomSocket, PairRoom, PairRoomFrame, PairRoomSocket } from './pair-room'
export {
  DESKTOP_PAIR_FRAMES,
  DesktopPairRejectedError,
  desktopPairQrKind,
  desktopPairQrUrl,
  parseDesktopPairQr,
  startControllerPairing,
  startNodePairing,
} from './desktop-pair'
export type { DesktopPairQr, DesktopPairQrKind, NodePairing } from './desktop-pair'
export type { FrameEffect, InboundFrame, RelayControlFrame, TransportKind } from './frames'
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
export { setCryptoBackend } from './crypto-backend'
export { LINK_CHANNEL_FRAME, openLinkFrame, sealLinkFrame } from './phone-link'
export type { LinkHandshakeInfo, LinkHeader, LinkKind } from './phone-link'
export type { ChannelCredential } from './secure-channel'
export type { AesGcm, Base64Codec, CryptoBackend } from './crypto-backend'

export { TransportLedger, type TransportMetric, type LedgerSnapshot } from './transport-ledger'
