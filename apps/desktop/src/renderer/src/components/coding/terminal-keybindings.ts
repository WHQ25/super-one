interface TerminalFindKeyEvent {
  key: string
  metaKey: boolean
  shiftKey: boolean
}

interface TerminalKeybindingActions {
  clearSelection: () => void
  closeFind: () => void
  findNext: () => void
  findPrevious: () => void
  hasSelection: () => boolean
  isFindVisible: () => boolean
  openFind: () => void
  sendInput: (data: string) => void
}

interface TerminalKeybindingOptions {
  interceptCtrlW?: boolean
}

export function getTerminalFindDirection(
  event: TerminalFindKeyEvent,
  acceptEnter = false,
): 'next' | 'previous' | undefined {
  const key = event.key.toLowerCase()
  if (!(event.metaKey && key === 'g') && !(acceptEnter && key === 'enter')) return undefined
  return event.shiftKey ? 'previous' : 'next'
}

export function createTerminalKeyEventHandler(
  actions: TerminalKeybindingActions,
  options: TerminalKeybindingOptions = {},
): (event: KeyboardEvent) => boolean {
  return (event) => {
    if (event.type !== 'keydown') return true

    const key = event.key.toLowerCase()
    const findDirection = getTerminalFindDirection(event)
    if (findDirection) {
      event.preventDefault()
      if (findDirection === 'next') actions.findNext()
      else actions.findPrevious()
      return false
    }

    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && key === 'f') {
      event.preventDefault()
      actions.openFind()
      return false
    }

    if (event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey) {
      if (key === 'arrowleft' || key === 'arrowright') {
        event.preventDefault()
        actions.sendInput(key === 'arrowleft' ? '\x01' : '\x05')
        return false
      }
      if (key === 'backspace') {
        event.preventDefault()
        actions.sendInput('\x15')
        return false
      }
      if (key === 'w') return false
    }

    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'backspace') {
      event.preventDefault()
      actions.sendInput('\x17')
      return false
    }

    if (options.interceptCtrlW && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && key === 'w') {
      return false
    }

    if (key === 'escape' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (actions.isFindVisible()) {
        event.preventDefault()
        actions.closeFind()
        return false
      }
      if (actions.hasSelection()) {
        event.preventDefault()
        actions.clearSelection()
        return false
      }
    }

    return true
  }
}
