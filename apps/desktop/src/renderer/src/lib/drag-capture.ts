/** Keeps pointer movement in the host renderer when dragging across webviews/iframes. */
export function createDragCapture(cursor: string) {
  let element: HTMLDivElement | null = null
  return {
    acquire() {
      if (element) return
      element = document.createElement('div')
      element.style.cssText = `position:fixed;inset:0;z-index:2147483647;cursor:${cursor}`
      document.body.appendChild(element)
    },
    release() {
      element?.remove()
      element = null
    },
  }
}
