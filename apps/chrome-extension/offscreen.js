let canvas
let context
let recorder
let chunks = []
let stopped
let width = 0
let height = 0

function ensureRecorder(nextWidth, nextHeight) {
  if (!canvas) {
    canvas = document.createElement('canvas')
    context = canvas.getContext('2d')
  }
  if (recorder && recorder.state !== 'inactive') return
  width = nextWidth
  height = nextHeight
  canvas.width = width
  canvas.height = height
  chunks = []
  const stream = canvas.captureStream(10)
  recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  stopped = new Promise((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }))
  recorder.start(250)
}

async function finish() {
  if (!recorder || recorder.state === 'inactive') {
    return { data: '', mimeType: 'video/webm', width, height }
  }
  recorder.stop()
  await stopped
  const blob = new Blob(chunks, { type: 'video/webm' })
  const dataUrl = await blobToDataUrl(blob)
  recorder = null
  return { data: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: 'video/webm', width, height }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'record-frame') {
    ensureRecorder(message.width || 1, message.height || 1)
    const image = new Image()
    image.onload = () => {
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      sendResponse({ ok: true })
    }
    image.onerror = () => sendResponse({ ok: false })
    image.src = `data:image/jpeg;base64,${message.data}`
    return true
  }
  if (message?.type === 'record-stop') {
    finish().then(sendResponse)
    return true
  }
  return false
})
