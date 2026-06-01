/**
 * Shared mini-app API runtime.
 *
 * Used in two ways:
 * 1. Imported as module in miniapp-preload.ts
 * 2. Imported as ?raw string and inlined in bridge <script> tags
 *
 * Must be valid ES2020 JS (runs in Chromium iframe and Electron preload).
 * No external imports allowed.
 *
 * @param {object} transport - { send, request, on }
 * @param {string} version
 * @param {object} [opts]
 * @param {string} [opts.initialLocale]
 * @returns {object} The window.superone API object
 */

// eslint-disable-next-line no-unused-vars
function createSuperoneApi(transport, version, opts) {
  const toolHandlers = new Map()
  const watchCallbacks = new Map()
  const gitHeadListeners = []
  const contextConsumedListeners = []
  const darkModeListeners = []
  const themeListeners = []
  const localeListeners = []
  const peerListenersByEvent = new Map()
  let currentLocale = (opts && opts.initialLocale) || 'en'

  // --- drag image helpers (build an "icon + filename" pill for non-image files) ---
  const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|ico|tiff?)$/i
  const DRAG_FILE_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgb(220,220,220)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>'
  let dragFileIcon = null
  if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
    try {
      dragFileIcon = new Image()
      dragFileIcon.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(DRAG_FILE_SVG)
    } catch (e) { dragFileIcon = null }
  }
  function dragBasename(p) {
    const s = String(p).replace(/[/\\]+$/, '')
    const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
    return i >= 0 ? s.slice(i + 1) : s
  }
  function buildFilenamePillPng(name) {
    if (typeof document === 'undefined') return null
    const icon = dragFileIcon && dragFileIcon.complete && dragFileIcon.naturalWidth > 0 ? dragFileIcon : null
    const ICON = 18, PADX = 12, PADY = 8, GAP = 6, FONT = '13px -apple-system, system-ui, sans-serif', MAXW = 220
    const dpr = Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
    const mc = document.createElement('canvas').getContext('2d')
    if (!mc) return null
    mc.font = FONT
    let label = String(name), tw = mc.measureText(label).width
    if (tw > MAXW) {
      while (mc.measureText(label + '…').width > MAXW && label.length > 1) label = label.slice(0, -1)
      label += '…'
      tw = mc.measureText(label).width
    }
    const iconW = icon ? ICON + GAP : 0
    const width = PADX * 2 + iconW + Math.ceil(tw)
    const height = PADY * 2 + ICON
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width * dpr)
    canvas.height = Math.ceil(height * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.scale(dpr, dpr)
    ctx.fillStyle = 'rgba(40,40,40,0.92)'
    const r = 6
    ctx.beginPath()
    ctx.moveTo(r, 0)
    ctx.arcTo(width, 0, width, height, r)
    ctx.arcTo(width, height, 0, height, r)
    ctx.arcTo(0, height, 0, 0, r)
    ctx.arcTo(0, 0, width, 0, r)
    ctx.closePath()
    ctx.fill()
    if (icon) ctx.drawImage(icon, PADX, (height - ICON) / 2, ICON, ICON)
    ctx.fillStyle = 'rgb(245,245,245)'
    ctx.font = FONT
    ctx.textBaseline = 'middle'
    ctx.fillText(label, PADX + iconW, height / 2)
    try {
      const base64 = canvas.toDataURL('image/png').split(',')[1]
      if (!base64) return null
      const bin = atob(base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return { buffer: bytes.buffer, scaleFactor: dpr }
    } catch (e) { return null }
  }

  transport.on('miniapp-tool-call', (data) => {
    const handler = toolHandlers.get(data.toolName)
    if (handler) {
      Promise.resolve()
        .then(() => handler(data.arguments))
        .then((result) => {
          transport.send('miniapp-tool-result', { callId: data.callId, result })
        })
        .catch((err) => {
          transport.send('miniapp-tool-result', { callId: data.callId, error: err.message || String(err) })
        })
    } else {
      transport.send('miniapp-tool-result', { callId: data.callId, error: 'No handler for tool: ' + data.toolName })
    }
  })

  transport.on('miniapp-fs-watch-event', (data) => {
    const cb = watchCallbacks.get(data.watchId)
    if (cb) cb({ type: data.eventType, path: data.path })
  })

  transport.on('miniapp-git-head-change', () => {
    gitHeadListeners.forEach((cb) => cb())
  })

  transport.on('miniapp-context-consumed', () => {
    contextConsumedListeners.forEach((cb) => cb())
  })

  transport.on('miniapp-theme', (data) => {
    const root = document.documentElement
    if (data.isDark) root.classList.add('dark')
    else root.classList.remove('dark')
    if (data.vars) {
      const keys = Object.keys(data.vars)
      for (let i = 0; i < keys.length; i++) {
        root.style.setProperty('--' + keys[i], data.vars[keys[i]])
      }
    }
    darkModeListeners.forEach((cb) => cb(data.isDark))
    themeListeners.forEach((cb) => cb(data.vars || {}))
  })

  transport.on('miniapp-locale', (data) => {
    if (!data || typeof data.locale !== 'string') return
    if (data.locale === currentLocale) return
    currentLocale = data.locale
    localeListeners.forEach((cb) => cb(currentLocale))
  })

  transport.on('miniapp-peer-event', (data) => {
    if (!data || typeof data.event !== 'string') return
    const arr = peerListenersByEvent.get(data.event)
    if (!arr) return
    for (let i = 0; i < arr.length; i++) {
      try { arr[i](data.payload) } catch { /* ignore listener throws */ }
    }
  })

  function makeSub(arr) {
    return (cb) => {
      arr.push(cb)
      return () => {
        const idx = arr.indexOf(cb)
        if (idx >= 0) arr.splice(idx, 1)
      }
    }
  }

  function makeDb(scope, extra) {
    const api = {
      query(sql, params) {
        return transport.request('miniapp-db-request', 'miniapp-db-response', { op: 'query', scope: scope, args: { sql, params } })
      },
      exec(sql, params) {
        return transport.request('miniapp-db-request', 'miniapp-db-response', { op: 'exec', scope: scope, args: { sql, params } })
      },
      batch(statements) {
        return transport.request('miniapp-db-request', 'miniapp-db-response', { op: 'batch', scope: scope, args: { statements } })
      },
      pragma(name, value) {
        return transport.request('miniapp-db-request', 'miniapp-db-response', { op: 'pragma', scope: scope, args: { name, value } })
      },
    }
    if (extra) for (const k in extra) api[k] = extra[k]
    return api
  }

  function makeKv(scope, extra) {
    const api = {
      get(key) {
        return transport.request('miniapp-kv-request', 'miniapp-kv-response', { op: 'get', scope: scope, args: { key } })
      },
      set(key, value) {
        return transport.request('miniapp-kv-request', 'miniapp-kv-response', { op: 'set', scope: scope, args: { key, value } })
      },
      delete(key) {
        return transport.request('miniapp-kv-request', 'miniapp-kv-response', { op: 'delete', scope: scope, args: { key } })
      },
      list(prefix) {
        return transport.request('miniapp-kv-request', 'miniapp-kv-response', { op: 'list', scope: scope, args: { prefix } })
      },
    }
    if (extra) for (const k in extra) api[k] = extra[k]
    return api
  }

  return {
    version: version || '0.0.0',
    tools: {
      handle(name, callback) { toolHandlers.set(name, callback) },
      // Exposed so the standalone bridge can do its own callId-filtered dispatch
      // by reading the same handler registry that .handle() populates.
      _handlers: toolHandlers,
    },
    db: makeDb('project', { project: makeDb('project'), user: makeDb('user') }),
    kv: makeKv('project', { project: makeKv('project'), user: makeKv('user') }),
    peer: {
      on(event, callback) {
        if (typeof event !== 'string' || typeof callback !== 'function') return () => {}
        let arr = peerListenersByEvent.get(event)
        if (!arr) { arr = []; peerListenersByEvent.set(event, arr) }
        arr.push(callback)
        return () => {
          const cur = peerListenersByEvent.get(event)
          if (!cur) return
          const idx = cur.indexOf(callback)
          if (idx >= 0) cur.splice(idx, 1)
          if (cur.length === 0) peerListenersByEvent.delete(event)
        }
      },
      emit(event, payload) {
        if (typeof event !== 'string') return
        transport.send('miniapp-peer-emit', { event: event, payload: payload })
      },
    },
    fs: {
      readFile(path, opts) {
        const op = opts && opts.binary ? 'readFileBinary' : 'readFile'
        return transport.request('miniapp-fs-request', 'miniapp-fs-response', { op, args: { path } })
      },
      readDir(path) {
        return transport.request('miniapp-fs-request', 'miniapp-fs-response', { op: 'readDir', args: { path: path || '.' } })
      },
      writeFile(path, content, opts) {
        return transport.request('miniapp-fs-request', 'miniapp-fs-response', { op: 'writeFile', args: { path, content, append: opts?.append === true } })
      },
      deleteFile(path) {
        return transport.request('miniapp-fs-request', 'miniapp-fs-response', { op: 'deleteFile', args: { path } })
      },
      trashFile(path) {
        return transport.request('miniapp-fs-request', 'miniapp-fs-response', { op: 'trashFile', args: { path } })
      },
      rename(from, to) {
        return transport.request('miniapp-fs-request', 'miniapp-fs-response', { op: 'rename', args: { from, to } })
      },
      stat(path) {
        return transport.request('miniapp-fs-request', 'miniapp-fs-response', { op: 'stat', args: { path } })
      },
      mkdir(path) {
        return transport.request('miniapp-fs-request', 'miniapp-fs-response', { op: 'mkdir', args: { path } })
      },
      exists(path) {
        return transport.request('miniapp-fs-request', 'miniapp-fs-response', { op: 'exists', args: { path } })
      },
      glob(pattern) {
        return transport.request('miniapp-fs-request', 'miniapp-fs-response', { op: 'glob', args: { pattern } })
      },
      watch(path, callback) {
        return transport.request('miniapp-fs-watch', 'miniapp-fs-watch-ack', { path }, 'watchId').then((res) => {
          watchCallbacks.set(res, callback)
          return res
        })
      },
      unwatch(watchId) {
        watchCallbacks.delete(watchId)
        transport.send('miniapp-fs-unwatch', { watchId })
      },
    },
    agent: {
      sendPrompt(text) { transport.send('miniapp-sendPrompt', { text }) },
      setContext(opts) { transport.send('miniapp-context-set', { summary: opts.summary, content: opts.content, mode: opts.mode || 'inject', color: opts.color }) },
      clearContext() { transport.send('miniapp-context-clear', {}) },
      onContextConsumed: makeSub(contextConsumedListeners),
    },
    openFolder(path) { transport.send('miniapp-open-folder', { path }) },
    openExternalLink(url) { transport.send('miniapp-open-external-link', { url }) },
    clipboard: {
      read() { return transport.request('miniapp-clipboard-read', 'miniapp-clipboard-response', {}, 'text') },
      write(text) { transport.send('miniapp-clipboard-write', { text }) },
    },
    git: {
      info() { return transport.request('miniapp-git-request', 'miniapp-git-response', { op: 'info', args: {} }) },
      branches() { return transport.request('miniapp-git-request', 'miniapp-git-response', { op: 'branches', args: {} }) },
      log(opts) { return transport.request('miniapp-git-request', 'miniapp-git-response', { op: 'log', args: opts || {} }) },
      status() { return transport.request('miniapp-git-request', 'miniapp-git-response', { op: 'status', args: {} }) },
      diff(path, staged) { return transport.request('miniapp-git-request', 'miniapp-git-response', { op: 'diff', args: { path, staged: !!staged } }) },
      show(ref, path) { return transport.request('miniapp-git-request', 'miniapp-git-response', { op: 'show', args: { ref, path } }) },
      blame(path) { return transport.request('miniapp-git-request', 'miniapp-git-response', { op: 'blame', args: { path } }) },
      diffSummary(ref1, ref2) { return transport.request('miniapp-git-request', 'miniapp-git-response', { op: 'diffSummary', args: { ref1, ref2 } }) },
      getCommit(ref) { return transport.request('miniapp-git-request', 'miniapp-git-response', { op: 'getCommit', args: { ref } }) },
      tags() { return transport.request('miniapp-git-request', 'miniapp-git-response', { op: 'tags', args: {} }) },
      remotes() { return transport.request('miniapp-git-request', 'miniapp-git-response', { op: 'remotes', args: {} }) },
      branchDetail(name) { return transport.request('miniapp-git-request', 'miniapp-git-response', { op: 'branchDetail', args: { name } }) },
      stashList() { return transport.request('miniapp-git-request', 'miniapp-git-response', { op: 'stashList', args: {} }) },
      logFile(path, opts) { return transport.request('miniapp-git-request', 'miniapp-git-response', { op: 'logFile', args: { path, ...(opts || {}) } }) },
      onHeadChange: makeSub(gitHeadListeners),
    },
    locale: {
      get() { return currentLocale },
      onChange: makeSub(localeListeners),
    },
    theme: {
      getVars() {
        const style = document.documentElement.style
        const vars = {}
        for (let i = 0; i < style.length; i++) {
          const prop = style[i]
          if (prop.startsWith('--')) vars[prop.slice(2)] = style.getPropertyValue(prop).trim()
        }
        return vars
      },
      onChange: makeSub(themeListeners),
    },
    ui: {
      toast(message, type) { transport.send('miniapp-ui-toast', { message, toastType: type || 'info' }) },
      showTooltip(anchorRect, text, side) { transport.send('miniapp-ui-tooltip-show', { anchorRect, text, side: side || 'top' }) },
      hideTooltip() { transport.send('miniapp-ui-tooltip-hide', {}) },
      startDrag(paths, dragOpts) {
        var list = (Array.isArray(paths) ? paths : [paths]).filter(function (p) {
          return typeof p === 'string' && p
        })
        if (!list.length) return
        var msg = { paths: list }
        var o = dragOpts || {}
        if (o.iconPng) {
          // Caller-supplied icon wins.
          msg.iconPng = o.iconPng
          msg.scaleFactor = o.scaleFactor || 1
        } else if (!IMAGE_EXT.test(list[0])) {
          // Non-image: render an icon + filename pill (image files get a faded
          // thumbnail built in the host from the file itself).
          var pill = buildFilenamePillPng(dragBasename(list[0]))
          if (pill) {
            msg.iconPng = pill.buffer
            msg.scaleFactor = pill.scaleFactor
          }
        }
        transport.send('miniapp-ui-start-drag', msg)
      },
      showContextMenu(position, items) {
        return transport.request('miniapp-ui-contextmenu', 'miniapp-ui-contextmenu-result', { position, items }, 'itemId')
          .then((v) => v != null ? v : null)
      },
      showPopover: (function() {
        var active = null

        transport.on('miniapp-popover-msg', function(d) {
          if (active) active.msgListeners.forEach(function(cb) { cb(d.data) })
        })
        transport.on('miniapp-popover-closed', function() {
          if (!active) return
          var h = active
          active = null
          h.closed = true
          h.closeListeners.forEach(function(cb) { cb() })
        })

        function dismiss() {
          if (!active) return
          var h = active
          active = null
          h.closed = true
          h.closeListeners.forEach(function(cb) { cb() })
        }

        return function showPopover(options) {
          dismiss()

          var state = { msgListeners: [], closeListeners: [], closed: false }
          var handle = {
            postMessage: function(data) {
              if (!state.closed) transport.send('miniapp-popover-msg', { data: data })
            },
            onMessage: function(cb) { state.msgListeners.push(cb) },
            close: function() {
              if (state.closed) return
              state.closed = true
              if (active === state) active = null
              transport.send('miniapp-popover-close', {})
              state.closeListeners.forEach(function(cb) { cb() })
            },
            onClose: function(cb) { state.closeListeners.push(cb) },
          }
          active = state

          transport.send('miniapp-popover-show', {
            template: options.template,
            data: options.data,
            anchorRect: options.anchorRect,
            side: options.side,
            align: options.align,
            width: options.width,
            maxHeight: options.maxHeight,
          })

          return handle
        }
      })(),
    },
    worker: (function() {
      const workerMsgListeners = []
      transport.on('miniapp-worker-event', function(d) {
        workerMsgListeners.forEach(function(cb) { cb(d && d.payload) })
      })
      return {
        start() { return transport.request('miniapp-worker-start', 'miniapp-worker-status-result', {}) },
        stop() { return transport.request('miniapp-worker-stop', 'miniapp-worker-status-result', {}) },
        status() { return transport.request('miniapp-worker-status', 'miniapp-worker-status-result', {}) },
        postMessage(msg) { transport.send('miniapp-worker-msg', { payload: msg }) },
        onMessage(cb) {
          workerMsgListeners.push(cb)
          return function() {
            const i = workerMsgListeners.indexOf(cb)
            if (i >= 0) workerMsgListeners.splice(i, 1)
          }
        },
      }
    })(),
    isDarkMode() { return document.documentElement.classList.contains('dark') },
    onDarkModeChange: makeSub(darkModeListeners),
  }
}

// eslint-disable-next-line no-unused-vars
function createSuperoneSelf(transport) {
  const selfMsgListeners = []
  transport.on('miniapp-worker-msg', function(d) {
    selfMsgListeners.forEach(function(cb) { cb(d && d.payload) })
  })
  let leaseSeq = 0
  return {
    onMessage(cb) {
      selfMsgListeners.push(cb)
      return function() {
        const i = selfMsgListeners.indexOf(cb)
        if (i >= 0) selfMsgListeners.splice(i, 1)
      }
    },
    postMessage(msg) { transport.send('miniapp-worker-event', { payload: msg }) },
    setStatus(text) { transport.send('miniapp-worker-status-set', { text: text == null ? '' : String(text) }) },
    keepAlive(label) {
      const id = ++leaseSeq
      transport.send('miniapp-worker-lease', { leaseId: id, label: label || '' })
      let released = false
      return {
        release() {
          if (released) return
          released = true
          transport.send('miniapp-worker-lease-release', { leaseId: id })
        },
      }
    },
  }
}

// eslint-disable-next-line no-unused-vars
function startSuperoneResize(transport) {
  function start() {
    if (!document.body) return
    let lastH = 0
    let pending = false
    new ResizeObserver(() => {
      if (pending) return
      pending = true
      requestAnimationFrame(() => {
        pending = false
        const h = document.body.offsetHeight
        if (h > 0 && h !== lastH) {
          lastH = h
          transport.send('miniapp-resize', { height: h })
        }
      })
    }).observe(document.body)
  }
  if (document.body) start()
  else document.addEventListener('DOMContentLoaded', start)
}

// eslint-disable-next-line no-unused-vars
function installSuperoneMediaProbe(transport) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return
  const md = navigator.mediaDevices

  function notify(type, data) {
    // webview path: parent.postMessage doesn't reach the host (parent === window in <webview>),
    // so the preload exposes a direct IPC bridge. iframe path: this is undefined → fall through to postMessage.
    if (typeof window !== 'undefined' && typeof window.__superoneIpcToHost === 'function') {
      try { window.__superoneIpcToHost(type, data); return } catch (_) { /* fall through */ }
    }
    transport.send(type, data)
  }

  function instrument(stream, kindOf) {
    const kinds = stream.getTracks().map(kindOf)
    notify('miniapp-media-started', { kinds })
    stream.getTracks().forEach((t) => {
      const kind = kindOf(t)
      let fired = false
      const onEnded = () => {
        if (fired) return
        fired = true
        notify('miniapp-media-track-ended', { kind })
        t.removeEventListener('ended', onEnded)
      }
      t.addEventListener('ended', onEnded)
      const realStop = t.stop.bind(t)
      t.stop = function () {
        realStop()
        onEnded()
      }
    })
  }

  if (md.getUserMedia) {
    const realGUM = md.getUserMedia.bind(md)
    md.getUserMedia = function (constraints) {
      return realGUM(constraints).then(function (stream) {
        instrument(stream, (t) => t.kind === 'audio' ? 'microphone' : t.kind === 'video' ? 'camera' : t.kind)
        return stream
      })
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createSuperoneApi, startSuperoneResize, installSuperoneMediaProbe }
}

export { createSuperoneApi, startSuperoneResize, installSuperoneMediaProbe }
