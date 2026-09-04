import { getRandomValues, randomUUID } from 'expo-crypto'

if (typeof global.crypto === 'undefined') {
  global.crypto = {}
}
if (typeof global.crypto.getRandomValues !== 'function') {
  global.crypto.getRandomValues = getRandomValues
}
if (typeof global.crypto.randomUUID !== 'function') {
  global.crypto.randomUUID = randomUUID
}

// Hermes throws on missing global properties instead of returning undefined.
// Expo's URL stack (whatwg-url / webidl-conversions) reads SharedArrayBuffer.prototype
// getters at import time.
function definePrototypeGetter(ctor, name, getter) {
  if (!ctor?.prototype) return
  if (Object.getOwnPropertyDescriptor(ctor.prototype, name)) return
  Object.defineProperty(ctor.prototype, name, {
    configurable: true,
    enumerable: false,
    get: getter,
  })
}

if (typeof SharedArrayBuffer === 'undefined') {
  function SharedArrayBufferPolyfill(length) {
    return new ArrayBuffer(length)
  }
  SharedArrayBufferPolyfill.prototype = Object.create(ArrayBuffer.prototype)
  SharedArrayBufferPolyfill.prototype.constructor = SharedArrayBufferPolyfill
  global.SharedArrayBuffer = SharedArrayBufferPolyfill
}

definePrototypeGetter(ArrayBuffer, 'byteLength', function byteLength() {
  return new Uint8Array(this).byteLength
})
definePrototypeGetter(ArrayBuffer, 'resizable', function resizable() {
  return false
})
definePrototypeGetter(global.SharedArrayBuffer, 'byteLength', function byteLength() {
  return new Uint8Array(this).byteLength
})
definePrototypeGetter(global.SharedArrayBuffer, 'growable', function growable() {
  return false
})

if (typeof String.prototype.isWellFormed !== 'function') {
  String.prototype.isWellFormed = function isWellFormed() {
    return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(String(this))
  }
}

if (typeof String.prototype.toWellFormed !== 'function') {
  String.prototype.toWellFormed = function toWellFormed() {
    return String(this).replace(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      (match) => (match.length === 2 ? `${match[0]}\uFFFD` : '\uFFFD'),
    )
  }
}
