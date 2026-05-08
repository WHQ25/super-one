import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

interface ItemsSnapshot {
  count: number
  currentIndex: number
}

interface UseCtrlTabSwitcherOptions {
  scopeRef: RefObject<HTMLElement | null>
  getItems: () => ItemsSnapshot | null
  onCommit: (selectedIndex: number) => void
  enabled?: boolean
  claimWhenUnfocused?: boolean
}

export interface SwitcherState {
  isOpen: boolean
  selectedIndex: number
  itemCount: number
  currentIndex: number
}

export interface SwitcherApi extends SwitcherState {
  cancel: () => void
}

const CLOSED: SwitcherState = { isOpen: false, selectedIndex: 0, itemCount: 0, currentIndex: 0 }

export function useCtrlTabSwitcher({ scopeRef, getItems, onCommit, enabled = true, claimWhenUnfocused = false }: UseCtrlTabSwitcherOptions): SwitcherApi {
  const [state, setState] = useState<SwitcherState>(CLOSED)
  const stateRef = useRef(state)
  stateRef.current = state

  const close = useCallback(() => {
    setState((s) => (s.isOpen ? CLOSED : s))
  }, [])

  const cancel = useCallback(() => {
    close()
  }, [close])

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && stateRef.current.isOpen) {
        e.preventDefault()
        close()
        return
      }

      if (e.key !== 'Tab') return
      if (!e.ctrlKey || e.shiftKey || e.metaKey || e.altKey) return

      if (stateRef.current.isOpen) {
        e.preventDefault()
        setState((s) => (s.itemCount > 0 ? { ...s, selectedIndex: (s.selectedIndex + 1) % s.itemCount } : s))
        return
      }

      const scope = scopeRef.current
      if (!scope) return
      const active = document.activeElement
      const inScope = !!active && scope.contains(active)
      const unfocused = !active || active === document.body || active === document.documentElement
      if (!inScope && !(claimWhenUnfocused && unfocused)) return

      const items = getItems()
      e.preventDefault()
      if (!items || items.count === 0) return
      if (items.count === 1 && items.currentIndex === 0) return

      const initial = items.currentIndex >= 0 ? (items.currentIndex + 1) % items.count : 0
      window.app.trace?.('chat.switcher', 'open', { count: items.count, currentIndex: items.currentIndex, initial })
      setState({ isOpen: true, selectedIndex: initial, itemCount: items.count, currentIndex: items.currentIndex })
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      if (!stateRef.current.isOpen) return
      if (e.key !== 'Control') return
      const target = stateRef.current.selectedIndex
      const current = stateRef.current.currentIndex
      const willCommit = target !== current
      window.app.trace?.('chat.switcher', 'commit', { target, current, willCommit })
      close()
      if (willCommit) onCommit(target)
    }

    const onBlur = (): void => {
      if (stateRef.current.isOpen) close()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [enabled, scopeRef, getItems, onCommit, close, claimWhenUnfocused])

  return { ...state, cancel }
}
