/**
 * Worker-side superone runtime for mini-app headless tools.
 *
 * Used only inside Node.js worker_threads (spawned via miniapp-headless-bootstrap.js).
 * Has no DOM access; for UI side-effects, mini-app must use superone.peer.emit
 * to notify iframe contexts (panel / tool intercept / tool result).
 *
 * @param {object} opts
 * @param {string} opts.appId
 * @param {string} opts.sessionId
 * @param {import('node:worker_threads').MessagePort} opts.parentPort
 * @param {Map<string, Function>} opts.handlers - shared with bootstrap dispatch
 * @param {Map<string, {resolve: Function, reject: Function}>} opts.kvPending - shared with bootstrap dispatch
 * @returns {object} the superone API object assigned to globalThis.superone
 */
export function createSuperoneHeadless({ appId, sessionId, parentPort, handlers, kvPending }) {
  let kvReqCounter = 0

  function kvRequest(op, args) {
    const requestId = `${++kvReqCounter}`
    return new Promise((resolve, reject) => {
      kvPending.set(requestId, { resolve, reject })
      parentPort.postMessage({ type: 'kv-op', requestId, op, args })
    })
  }

  return {
    appId,
    sessionId,
    tools: {
      handle(name, callback) {
        if (typeof name !== 'string' || name.length === 0) {
          throw new Error('superone.tools.handle: name must be a non-empty string')
        }
        if (typeof callback !== 'function') {
          throw new Error('superone.tools.handle: callback must be a function')
        }
        handlers.set(name, callback)
      },
    },
    peer: {
      emit(event, payload) {
        if (typeof event !== 'string' || event.length === 0) {
          throw new Error('superone.peer.emit: event must be a non-empty string')
        }
        parentPort.postMessage({ type: 'peer-emit', event, payload })
      },
    },
    kv: {
      get(key) {
        return kvRequest('get', { key })
      },
      set(key, value) {
        return kvRequest('set', { key, value })
      },
      delete(key) {
        return kvRequest('delete', { key })
      },
      list(prefix) {
        return kvRequest('list', { prefix })
      },
    },
  }
}
