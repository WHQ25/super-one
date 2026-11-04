import {
  chmodSync,
  closeSync,
  createReadStream,
  createWriteStream,
  openSync,
  readSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createInflateRaw } from 'node:zlib'
import type { AntigravityReleaseAsset } from './antigravity-release'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_DIR_SIGNATURE = 0x02014b50
const LOCAL_FILE_SIGNATURE = 0x04034b50
const MAX_EOCD_SEARCH = 65_557

interface ZipMemberEntry {
  fileName: string
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  externalAttributes: number
  generalPurposeBitFlag: number
}

function parseZipCentralDirectory(zipPath: string): ZipMemberEntry[] {
  const st = statSync(zipPath)
  const fileSize = st.size
  if (fileSize < 22) {
    throw new Error('Antigravity zip archive is truncated')
  }
  const searchLen = Math.min(fileSize, MAX_EOCD_SEARCH)
  const tailBuf = Buffer.alloc(searchLen)
  const fd = openSync(zipPath, 'r')
  try {
    readSync(fd, tailBuf, 0, searchLen, fileSize - searchLen)
    let eocdOffset = -1
    for (let i = searchLen - 22; i >= 0; i--) {
      if (tailBuf.readUInt32LE(i) === EOCD_SIGNATURE) {
        const commentLen = tailBuf.readUInt16LE(i + 20)
        if (i + 22 + commentLen === searchLen) {
          eocdOffset = i
          break
        }
      }
    }
    if (eocdOffset < 0) {
      throw new Error('Could not find End of Central Directory in Antigravity zip archive')
    }
    const entryCount = tailBuf.readUInt16LE(eocdOffset + 10)
    const cdSize = tailBuf.readUInt32LE(eocdOffset + 12)
    const cdOffset = tailBuf.readUInt32LE(eocdOffset + 16)
    if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      throw new Error('ZIP64 archives are not expected for Antigravity release assets')
    }
    if (cdOffset + cdSize > fileSize) {
      throw new Error('Antigravity zip central directory exceeds file bounds')
    }
    const cdBuf = Buffer.alloc(cdSize)
    readSync(fd, cdBuf, 0, cdSize, cdOffset)

    const entries: ZipMemberEntry[] = []
    let ptr = 0
    for (let idx = 0; idx < entryCount; idx++) {
      if (ptr + 46 > cdSize || cdBuf.readUInt32LE(ptr) !== CENTRAL_DIR_SIGNATURE) {
        throw new Error('Invalid central directory header in Antigravity zip archive')
      }
      const generalPurposeBitFlag = cdBuf.readUInt16LE(ptr + 8)
      const compressionMethod = cdBuf.readUInt16LE(ptr + 10)
      const compressedSize = cdBuf.readUInt32LE(ptr + 20)
      const uncompressedSize = cdBuf.readUInt32LE(ptr + 24)
      const fileNameLen = cdBuf.readUInt16LE(ptr + 28)
      const extraLen = cdBuf.readUInt16LE(ptr + 30)
      const commentLen = cdBuf.readUInt16LE(ptr + 32)
      const externalAttributes = cdBuf.readUInt32LE(ptr + 38)
      const localHeaderOffset = cdBuf.readUInt32LE(ptr + 42)
      const headerEnd = ptr + 46 + fileNameLen + extraLen + commentLen
      if (headerEnd > cdSize) {
        throw new Error('Truncated central directory entry in Antigravity zip archive')
      }
      const fileName = cdBuf.subarray(ptr + 46, ptr + 46 + fileNameLen).toString('utf8')
      entries.push({
        fileName,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        externalAttributes,
        generalPurposeBitFlag,
      })
      ptr = headerEnd
    }
    return entries
  } finally {
    closeSync(fd)
  }
}

export async function extractVerifiedAntigravityZip(
  zipPath: string,
  destDir: string,
  asset: Pick<AntigravityReleaseAsset, 'executable' | 'harness'>,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const entries = parseZipCentralDirectory(zipPath)
  if (entries.length !== 2) {
    throw new Error('The Antigravity archive must contain exactly the executable and its harness')
  }
  const seen = new Set<string>()
  const fileSize = statSync(zipPath).size

  for (const entry of entries) {
    const expected = [asset.executable, asset.harness].find((f) => f.name === entry.fileName)
    const unixType = (entry.externalAttributes >>> 16) & 0o170000
    if (
      !expected ||
      seen.has(entry.fileName) ||
      entry.fileName.includes('/') ||
      entry.fileName.includes('\\') ||
      entry.fileName.includes('\0') ||
      (unixType !== 0 && unixType !== 0o100000) ||
      (entry.externalAttributes & 0x10) !== 0 ||
      (entry.generalPurposeBitFlag & 1) !== 0 ||
      (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) ||
      entry.uncompressedSize !== expected.bytes
    ) {
      throw new Error(`Unexpected or invalid member in Antigravity archive: ${entry.fileName}`)
    }
    seen.add(entry.fileName)

    const localHeaderBuf = Buffer.alloc(30)
    const fd = openSync(zipPath, 'r')
    let dataStart: number
    try {
      if (entry.localHeaderOffset + 30 > fileSize) {
        throw new Error('Local file header exceeds archive size')
      }
      readSync(fd, localHeaderBuf, 0, 30, entry.localHeaderOffset)
      if (localHeaderBuf.readUInt32LE(0) !== LOCAL_FILE_SIGNATURE) {
        throw new Error('Invalid local file header signature in Antigravity archive')
      }
      const localNameLen = localHeaderBuf.readUInt16LE(26)
      const localExtraLen = localHeaderBuf.readUInt16LE(28)
      dataStart = entry.localHeaderOffset + 30 + localNameLen + localExtraLen
      if (dataStart + entry.compressedSize > fileSize) {
        throw new Error('Compressed member exceeds Antigravity archive bounds')
      }
    } finally {
      closeSync(fd)
    }

    const outPath = join(destDir, entry.fileName)
    let writtenBytes = 0
    const sizeLimiter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        writtenBytes += chunk.byteLength
        if (writtenBytes > expected.bytes) {
          cb(new Error(`Archive member ${entry.fileName} exceeded expected size`))
          return
        }
        cb(null, chunk)
      },
    })

    const readStream = createReadStream(zipPath, {
      start: dataStart,
      end: dataStart + entry.compressedSize - 1,
    })
    const writeStream = createWriteStream(outPath, { flags: 'wx', mode: 0o755 })

    if (entry.compressionMethod === 8) {
      await pipeline(readStream, createInflateRaw(), sizeLimiter, writeStream)
    } else {
      await pipeline(readStream, sizeLimiter, writeStream)
    }

    if (writtenBytes !== expected.bytes) {
      throw new Error(`Archive member ${entry.fileName} was truncated (${writtenBytes} !== ${expected.bytes})`)
    }
    if (platform !== 'win32') {
      chmodSync(outPath, 0o755)
    }
  }

  if (!seen.has(asset.executable.name) || !seen.has(asset.harness.name)) {
    throw new Error('Antigravity archive is missing the executable or its harness')
  }
}
