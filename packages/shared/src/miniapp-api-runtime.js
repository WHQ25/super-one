/**
 * Shared mini-app API runtime.
 *
 * Imported by the Electron WebView preload. Must remain valid ES2020 JS.
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
  const darkModeListeners = []
  const themeListeners = []
  const localeListeners = []
  const nodeMessageListeners = []
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

  transport.on('miniapp-node-message', (data) => {
    nodeMessageListeners.forEach((cb) => cb(data && data.payload))
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

  return {
    version: version || '0.0.0',
    node: {
      postMessage(message) { transport.send('miniapp-node-post-message', { payload: message }) },
      onMessage(handler) {
        nodeMessageListeners.push(handler)
        return () => {
          const index = nodeMessageListeners.indexOf(handler)
          if (index >= 0) nodeMessageListeners.splice(index, 1)
        }
      },
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
    isDarkMode() { return document.documentElement.classList.contains('dark') },
    onDarkModeChange: makeSub(darkModeListeners),
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
    // The preload exposes a direct IPC bridge for media lifecycle notifications.
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

// eslint-disable-next-line no-unused-vars
function startSuperoneReady(transport) {
  function fire() {
    transport.send('miniapp-ready', {})
  }
  if (typeof document === 'undefined' || document.readyState === 'complete' || document.readyState === 'interactive') {
    fire()
  } else {
    document.addEventListener('DOMContentLoaded', fire)
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createSuperoneApi, startSuperoneResize, installSuperoneMediaProbe, startSuperoneReady }
}

export { createSuperoneApi, startSuperoneResize, installSuperoneMediaProbe, startSuperoneReady }
