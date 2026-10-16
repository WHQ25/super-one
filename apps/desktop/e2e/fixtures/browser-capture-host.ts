import { useBrowserStore } from '../../src/renderer/src/stores/browser'
import { registerBrowserWebview } from '../../src/renderer/src/components/browser/browser-host-api'
import { captureBrowserScreenshot } from '../../src/renderer/src/components/browser/browser-screenshot'

const TAB = 'native-capture'
const guest = document.createElement('webview')
guest.style.cssText = 'width:640px;height:400px;display:flex'
guest.src = `data:text/html,${encodeURIComponent(`<!doctype html><style>
  body { margin:0; height:1800px; background:white }
  #target { position:absolute; left:20px; top:900px; width:300px; height:44px; background:rgb(255,0,0) }
</style><div id="target"></div>`)}`
document.body.append(guest)
useBrowserStore.getState().ensure(TAB, guest.src, 'capture-test')
registerBrowserWebview(TAB, guest)

declare global {
  interface Window {
    captureHarness: {
      capture(selector?: string): ReturnType<typeof captureBrowserScreenshot>
      execute(script: string): Promise<unknown>
      released(): boolean
    }
  }
}
guest.addEventListener('dom-ready', () => {
  window.captureHarness = {
    capture: selector => captureBrowserScreenshot(TAB, selector),
    execute: script => guest.executeJavaScript(script),
    released: () => {
      const state = useBrowserStore.getState()
      return !state.captureRefs[TAB] && !state.fullResolutionCaptureRefs[TAB]
    },
  }
})
