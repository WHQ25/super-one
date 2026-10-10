/** Keep live browser interactions connected while their content leaves the viewport. */
export function transcriptInteractionSnapshot(doc: Document): (element: Element) => boolean {
  const active = doc.activeElement === doc.body ? null : doc.activeElement
  const selection = doc.getSelection()
  const ranges = selection && !selection.isCollapsed
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))
    : []
  const playing = [...doc.querySelectorAll<HTMLMediaElement>('video, audio')].filter(media => !media.paused && !media.ended)
  return element => !!(active && element.contains(active))
    || ranges.some(range => range.intersectsNode(element))
    || playing.some(media => element.contains(media))
}
