const GROUP_TITLE = 'SuperOne'
const CHUNK_CHARS = 512 * 1024

const agentOwners = new Map()
const attached = new Set()
const recordings = new Map()
const expectedDownloads = new Map()
const downloadTabs = new Map()
const hostUrls = new Set()
const hostDownloads = new Map()
const chunks = new Map()

let port = null
let connected = false
let hostName = ''
let connecting = false

function post(message) {
  if (!port) return
  const json = JSON.stringify(message)
  if (json.length <= CHUNK_CHARS) {
    port.postMessage(message)
    return
  }
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const total = Math.ceil(json.length / CHUNK_CHARS)
  for (let index = 0; index < total; index++) {
    port.postMessage({ chunk: id, index, total, data: json.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS) })
  }
}

function acceptMessage(message) {
  if (!message || typeof message.chunk !== 'string') return message
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

async function sharedSet() {
  const stored = await chrome.storage.session.get('shared')
  return new Set(Array.isArray(stored.shared) ? stored.shared : [])
}

async function saveShared(ids) {
  await chrome.storage.session.set({ shared: [...ids] })
}

async function describe(tabId) {
  const tab = await chrome.tabs.get(tabId)
  const shared = await sharedSet()
  const owner = agentOwners.get(tabId)
  return {
    tabId,
    url: tab.url || '',
    title: tab.title || '',
    loading: tab.status === 'loading',
    active: tab.active === true,
    kind: owner ? 'agent' : 'shared',
    ...(owner ? { owner } : {}),
    shared: shared.has(tabId),
  }
}

async function controlledIds() {
  const shared = await sharedSet()
  return new Set([...shared, ...agentOwners.keys()])
}

async function pushTabs() {
  const ids = await controlledIds()
  const tabs = []
  for (const tabId of ids) {
    try { tabs.push(await describe(tabId)) } catch { /* tab gone */ }
  }
  post({ event: 'tabs.changed', params: { tabs } })
}

async function hostNameForThisExtension() {
  if (hostName) return hostName
  const response = await fetch(chrome.runtime.getURL('variant.json'))
  if (!response.ok) throw new Error('This extension is not stamped for a SuperOne variant')
  const variant = await response.json()
  if (!variant || typeof variant.host !== 'string' || !variant.host) throw new Error('variant.json is missing its host')
  hostName = variant.host
  return hostName
}

function connect() {
  if (connecting || port) return
  connecting = true
  hostNameForThisExtension().then((name) => {
    connecting = false
    try {
      port = chrome.runtime.connectNative(name)
    } catch {
      port = null
      scheduleReconnect()
      return
    }
    port.onMessage.addListener((raw) => {
      const message = acceptMessage(raw)
      if (!message?.method || typeof message.id !== 'number') return
      handle(message).catch((err) => post({ id: message.id, error: err instanceof Error ? err.message : String(err) }))
    })
    port.onDisconnect.addListener(() => {
      connected = false
      port = null
      scheduleReconnect()
    })
    connected = true
    post({ event: 'hello', params: { version: chrome.runtime.getManifest().version, extensionId: chrome.runtime.id } })
    pushTabs()
  }).catch(() => {
    connecting = false
    scheduleReconnect()
  })
}

let reconnectTimer = null
function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, 1000)
}

async function ensureAttached(tabId) {
  if (attached.has(tabId)) return
  await chrome.debugger.attach({ tabId }, '1.3')
  attached.add(tabId)
  await chrome.debugger.sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
}

async function sendCdp(tabId, method, params) {
  await ensureAttached(tabId)
  return chrome.debugger.sendCommand({ tabId }, method, params || {})
}

async function requireControlled(tabId) {
  const ids = await controlledIds()
  if (!ids.has(tabId)) throw new Error(`Chrome tab is not shared with SuperOne: ${tabId}`)
}

async function handle(message) {
  const params = message.params || {}
  let result
  switch (message.method) {
    case 'tabs.list':
      result = { tabs: await listTabs() }
      break
    case 'tabs.create':
      result = await createTab(params.owner, params.url)
      break
    case 'tabs.close':
      await requireControlled(params.tabId)
      await chrome.tabs.remove(params.tabId)
      result = { ok: true }
      break
    case 'tabs.navigate':
      await requireControlled(params.tabId)
      result = await navigate(params)
      break
    case 'tabs.activate':
      await requireControlled(params.tabId)
      await chrome.tabs.update(params.tabId, { active: true })
      result = { ok: true }
      break
    case 'cdp.send':
      await requireControlled(params.tabId)
      result = await sendCdp(params.tabId, params.method, params.params)
      break
    case 'cdp.detach':
      if (attached.has(params.tabId)) {
        await chrome.debugger.detach({ tabId: params.tabId }).catch(() => {})
        attached.delete(params.tabId)
      }
      result = { ok: true }
      break
    case 'record.start':
      await requireControlled(params.tabId)
      result = await startRecording(params.tabId)
      break
    case 'record.stop':
      await requireControlled(params.tabId)
      result = await stopRecording(params.tabId, params.recordingId)
      break
    case 'downloads.download':
      result = await downloadUrlForHost(params)
      break
    default:
      throw new Error(`Unknown Chrome bridge method: ${message.method}`)
  }
  post({ id: message.id, result })
}

async function listTabs() {
  const ids = await controlledIds()
  const tabs = []
  for (const tabId of ids) {
    try {
      const info = await describe(tabId)
      delete info.shared
      tabs.push(info)
    } catch { /* closed */ }
  }
  return tabs
}

async function createTab(owner, url) {
  if (!owner) throw new Error('tabs.create needs an owner')
  const tab = await chrome.tabs.create({ url: url || 'about:blank', active: false })
  agentOwners.set(tab.id, owner)
  const groups = await chrome.tabGroups.query({ title: GROUP_TITLE })
  const grouped = groups[0]
    ? await chrome.tabs.group({ tabIds: [tab.id], groupId: groups[0].id })
    : await chrome.tabs.group({ tabIds: [tab.id] })
  await chrome.tabGroups.update(grouped, { title: GROUP_TITLE, color: 'blue' })
  await pushTabs()
  return describe(tab.id).then((info) => {
    delete info.shared
    return info
  })
}

async function navigate(params) {
  const tabId = params.tabId
  if (params.action === 'back') await sendCdp(tabId, 'Runtime.evaluate', { expression: 'history.back()' })
  else if (params.action === 'forward') await sendCdp(tabId, 'Runtime.evaluate', { expression: 'history.forward()' })
  else if (params.action === 'reload') await chrome.tabs.reload(tabId)
  else if (params.url) await chrome.tabs.update(tabId, { url: params.url })
  else throw new Error('Provide url or action to navigate.')
  if (params.wait !== false) await waitComplete(tabId, params.timeoutMs || 15000)
  const info = await describe(tabId)
  delete info.shared
  return info
}

function waitComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      resolve()
    }
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') finish()
    }
    const timer = setTimeout(finish, timeoutMs)
    chrome.tabs.onUpdated.addListener(onUpdated)
  })
}

async function startRecording(tabId) {
  await ensureOffscreen()
  await ensureAttached(tabId)
  const recordingId = crypto.randomUUID()
  recordings.set(recordingId, { tabId, started: Date.now(), width: 0, height: 0 })
  await chrome.debugger.sendCommand({ tabId }, 'Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280, everyNthFrame: 1 })
  return { recordingId }
}

async function stopRecording(tabId, recordingId) {
  const recording = recordings.get(recordingId)
  if (!recording || recording.tabId !== tabId) throw new Error('Browser recording is not active')
  recordings.delete(recordingId)
  await chrome.debugger.sendCommand({ tabId }, 'Page.stopScreencast', {}).catch(() => {})
  const encoded = await chrome.runtime.sendMessage({ type: 'record-stop' })
  if (!encoded?.data) throw new Error('Browser recording produced an empty video')
  return {
    data: encoded.data,
    mimeType: 'video/webm',
    durationMs: Math.max(0, Date.now() - recording.started),
    width: encoded.width || recording.width,
    height: encoded.height || recording.height,
  }
}

let offscreenReady = null
function ensureOffscreen() {
  if (offscreenReady) return offscreenReady
  offscreenReady = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS', 'DOM_PARSER'],
    justification: 'Encode a short recording of a tab SuperOne is driving',
  }).catch((err) => {
    offscreenReady = null
    throw err
  })
  return offscreenReady
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId
  if (typeof tabId !== 'number') return
  if (method === 'Page.screencastFrame') {
    const recording = [...recordings.values()].find((item) => item.tabId === tabId)
    const meta = params?.metadata || {}
    if (recording) {
      recording.width = meta.deviceWidth || recording.width
      recording.height = meta.deviceHeight || recording.height
      chrome.runtime.sendMessage({
        type: 'record-frame',
        data: params.data,
        width: recording.width,
        height: recording.height,
      }).catch(() => {})
    }
    chrome.debugger.sendCommand({ tabId }, 'Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {})
    return
  }
  if (method === 'Page.downloadWillBegin' && params?.guid) {
    expectedDownloads.set(params.url, { guid: params.guid, tabId, at: Date.now() })
  }
  post({ event: 'cdp.event', params: { tabId, method, params } })
})

chrome.debugger.onDetach.addListener((source, reason) => {
  attached.delete(source.tabId)
  post({ event: 'cdp.detached', params: { tabId: source.tabId, reason: reason || 'detached' } })
})

chrome.downloads.onCreated.addListener((item) => {
  if (hostUrls.has(item.url) || (item.finalUrl && hostUrls.has(item.finalUrl))) return
  const match = expectedDownloads.get(item.url) || expectedDownloads.get(item.finalUrl)
  if (!match || Date.now() - match.at > 30_000) return
  downloadTabs.set(item.id, match)
  emitDownload(item, match)
})

chrome.downloads.onChanged.addListener((delta) => {
  if (hostDownloads.has(delta.id)) {
    chrome.downloads.search({ id: delta.id }).then((items) => {
      if (items[0]) settleHostDownload(items[0])
    }).catch(() => {})
    return
  }
  const match = downloadTabs.get(delta.id)
  if (!match) return
  chrome.downloads.search({ id: delta.id }).then((items) => {
    if (items[0]) emitDownload(items[0], match)
  })
})

function relativeDownloadName(name) {
  if (typeof name !== 'string') return ''
  const base = name.split(/[/\\]/).pop().replace(/^\.+/, '')
  return base.slice(0, 180)
}

async function downloadUrlForHost(params) {
  const url = typeof params.url === 'string' ? params.url : ''
  let parsed
  try { parsed = new URL(url) } catch { parsed = null }
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new Error('downloads.download needs an http(s) URL')
  }
  const filename = relativeDownloadName(params.filename)
  hostUrls.add(url)
  let id
  try {
    id = await chrome.downloads.download({
      url,
      ...(filename ? { filename } : {}),
      saveAs: false,
      conflictAction: 'uniquify',
    })
  } finally {
    hostUrls.delete(url)
  }
  return waitForHostDownload(id)
}

function waitForHostDownload(id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      hostDownloads.delete(id)
      chrome.downloads.cancel(id).catch(() => {})
      reject(new Error('Chrome download timed out'))
    }, 10 * 60 * 1000)
    hostDownloads.set(id, { resolve, reject, timer })
    chrome.downloads.search({ id }).then((items) => {
      if (items[0]) settleHostDownload(items[0])
    }).catch((err) => {
      clearTimeout(timer)
      hostDownloads.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    })
  })
}

function settleHostDownload(item) {
  const pending = hostDownloads.get(item.id)
  if (!pending) return
  if (item.state !== 'complete' && item.state !== 'interrupted') return
  clearTimeout(pending.timer)
  hostDownloads.delete(item.id)
  if (item.state === 'interrupted') {
    pending.reject(new Error(item.error || 'Chrome download was interrupted'))
    return
  }
  const path = item.filename || ''
  pending.resolve({
    path,
    filename: path.split(/[/\\]/).pop() || '',
    bytes: item.fileSize || item.bytesReceived || 0,
    mimeType: item.mime || 'application/octet-stream',
    state: 'completed',
  })
}

function emitDownload(item, match) {
  const state = item.state === 'complete' ? 'completed' : item.state === 'interrupted' ? 'interrupted' : 'progressing'
  post({
    event: 'downloads.progress',
    params: {
      guid: match.guid,
      url: item.finalUrl || item.url,
      filename: item.filename ? item.filename.split(/[/\\]/).pop() : '',
      path: item.filename || '',
      bytes: item.bytesReceived || 0,
      state,
      tabId: match.tabId,
    },
  })
}

chrome.tabs.onRemoved.addListener((tabId) => {
  agentOwners.delete(tabId)
  attached.delete(tabId)
  sharedSet().then((ids) => {
    if (!ids.delete(tabId)) return pushTabs()
    return saveShared(ids).then(pushTabs)
  })
})

chrome.tabs.onUpdated.addListener((tabId) => {
  controlledIds().then((ids) => { if (ids.has(tabId)) pushTabs() })
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type || message.type.startsWith('record-')) return false
  if (message.type === 'popup-status') {
    popupStatus().then(sendResponse)
    return true
  }
  if (message.type === 'share' || message.type === 'unshare') {
    toggleShare(message.type === 'share').then(sendResponse)
    return true
  }
  return false
})

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('No active tab')
  return tab
}

async function popupStatus() {
  const tab = await activeTab()
  const shared = await sharedSet()
  return { connected, shared: shared.has(tab.id), kind: agentOwners.has(tab.id) ? 'agent' : 'shared' }
}

async function toggleShare(share) {
  const tab = await activeTab()
  if (agentOwners.has(tab.id)) return popupStatus()
  const ids = await sharedSet()
  if (share) ids.add(tab.id)
  else {
    ids.delete(tab.id)
    if (attached.has(tab.id)) {
      await chrome.debugger.detach({ tabId: tab.id }).catch(() => {})
      attached.delete(tab.id)
    }
  }
  await saveShared(ids)
  await pushTabs()
  return popupStatus()
}

connect()
