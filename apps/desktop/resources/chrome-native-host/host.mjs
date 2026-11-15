#!/usr/bin/env node
// Chrome native-messaging host. Chrome speaks length-prefixed JSON on stdio
// (1 MiB per message). SuperOne speaks the same framing on a unix socket, with
// no size cap. This process rejoins Chrome chunks and splits oversized socket
// frames. Keep the chunk shape in sync with packages/shared/src/chrome-bridge-protocol.ts.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join } from 'node:path'

// Keep in sync with browserIdFromAppPath in packages/shared/src/chrome-extension-browsers.ts.
const APP_BUNDLE_IDS = [
  ['google chrome canary.app', 'chrome-canary'],
  ['google chrome beta.app', 'chrome-beta'],
  ['google chrome.app', 'chrome'],
  ['chromium.app', 'chromium'],
  ['microsoft edge.app', 'edge'],
  ['brave browser.app', 'brave'],
  ['arc.app', 'arc'],
]

function browserIdFromAppPath(command) {
  const names = []
  const pattern = /([^/\\]+)\.app(?=[/\\]|$)/gi
  for (const match of command.matchAll(pattern)) {
    if (match[1]) names.push(`${match[1].toLowerCase()}.app`)
  }
  for (const name of names) {
    for (const [needle, id] of APP_BUNDLE_IDS) {
      if (name === needle) return id
    }
  }
  return undefined
}

function browserIdFromParents() {
  let pid = process.ppid
  for (let i = 0; i < 8 && pid > 1; i++) {
    let output
    try {
      output = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'ppid=,command='], { encoding: 'utf8', timeout: 1000 })
    } catch {
      break
    }
    const match = String(output).match(/^\s*(\d+)\s+([\s\S]*)$/)
    if (!match) break
    const id = browserIdFromAppPath(match[2])
    if (id) return id
    const next = Number(match[1])
    if (!Number.isInteger(next) || next === pid) break
    pid = next
  }
  return 'unknown'
}

const CHUNK_CHARS = 512 * 1024
const home = process.env.SUPERONE_HOME
if (!home) {
  process.stderr.write('SUPERONE_HOME is not set\n')
  process.exit(1)
}

const token = readFileSync(join(home, 'chrome-bridge.token'), 'utf8').trim()
const socket = createConnection(join(home, 'chrome-bridge.sock'))
socket.on('error', () => process.exit(1))
socket.on('close', () => process.exit(0))

let stdinBuf = Buffer.alloc(0)
let socketBuf = Buffer.alloc(0)
const chunks = new Map()

function frame(json) {
  const body = Buffer.from(json)
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length, 0)
  return Buffer.concat([header, body])
}

function splitForChrome(json) {
  if (json.length <= CHUNK_CHARS) return [json]
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const total = Math.ceil(json.length / CHUNK_CHARS)
  const parts = []
  for (let index = 0; index < total; index++) {
    parts.push(JSON.stringify({ chunk: id, index, total, data: json.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS) }))
  }
  return parts
}

function acceptChunk(message) {
  if (!message || typeof message.chunk !== 'string' || typeof message.index !== 'number' || typeof message.total !== 'number' || typeof message.data !== 'string') {
    return message
  }
  let parts = chunks.get(message.chunk)
  if (!parts) {
    parts = new Array(message.total)
    chunks.set(message.chunk, parts)
  }
  parts[message.index] = message.data
  for (let i = 0; i < message.total; i++) if (parts[i] === undefined) return null
  chunks.delete(message.chunk)
  return JSON.parse(parts.join(''))
}

function consume(buffer, onMessage) {
  let rest = buffer
  while (rest.length >= 4) {
    const length = rest.readUInt32LE(0)
    if (length <= 0 || length > 64 * 1024 * 1024) process.exit(1)
    if (rest.length < 4 + length) break
    onMessage(rest.subarray(4, 4 + length).toString('utf8'))
    rest = rest.subarray(4 + length)
  }
  return rest
}

socket.on('connect', () => {
  socket.write(frame(JSON.stringify({ auth: token, browser: browserIdFromParents() })))
})

socket.on('data', (chunk) => {
  socketBuf = consume(Buffer.concat([socketBuf, chunk]), (json) => {
    for (const part of splitForChrome(json)) process.stdout.write(frame(part))
  })
})

process.stdin.on('data', (chunk) => {
  stdinBuf = consume(Buffer.concat([stdinBuf, chunk]), (json) => {
    let parsed
    try { parsed = JSON.parse(json) } catch { return }
    const message = acceptChunk(parsed)
    if (message) socket.write(frame(JSON.stringify(message)))
  })
})

process.stdin.on('end', () => process.exit(0))
