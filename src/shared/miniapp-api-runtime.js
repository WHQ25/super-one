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
 * @returns {object} The window.superone API object
 */

// eslint-disable-next-line no-unused-vars
function createSuperoneApi(transport, version) {
  const toolHandlers = new Map()
  const watchCallbacks = new Map()
  const gitHeadListeners = []
  const contextConsumedListeners = []
  const darkModeListeners = []
  const themeListeners = []
  const initCallbacks = []
  let initData = null

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

  transport.on('miniapp-inchat-init', (data) => {
    initData = data.data
    initCallbacks.forEach((cb) => cb(initData))
    initCallbacks.length = 0
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
    tools: {
      handle(name, callback) { toolHandlers.set(name, callback) },
    },
    onInit(callback) {
      if (initData !== null) callback(initData)
      else initCallbacks.push(callback)
    },
    fs: {
      readFile(path, opts) {
        const op = opts && opts.binary ? 'readFileBinary' : 'readFile'
        return transport.request('miniapp-fs-request', 'miniapp-fs-response', { op, args: { path } })
      },
      readDir(path) {
        return transport.request('miniapp-fs-request', 'miniapp-fs-response', { op: 'readDir', args: { path: path || '.' } })
      },
      writeFile(path, content) {
        return transport.request('miniapp-fs-request', 'miniapp-fs-response', { op: 'writeFile', args: { path, content } })
      },
      deleteFile(path) {
        return transport.request('miniapp-fs-request', 'miniapp-fs-response', { op: 'deleteFile', args: { path } })
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createSuperoneApi, startSuperoneResize }
}
