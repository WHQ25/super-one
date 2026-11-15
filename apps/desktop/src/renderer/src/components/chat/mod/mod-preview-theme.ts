import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { ModBackdropSnapshot } from '@superone/chat-view/mod-ui'
import { parseModBackdropProps } from '@superone/chat-view/mod-ui'
import type { ThemeMode } from '@superone/shared/agent-types'
import { holdHarnessScheme } from './mod-harness-scheme'

/**
 * Preview temporarily shows the theme's light or dark scheme on the whole
 * window, then puts the saved appearance back. Apply never writes it.
 */
export function useModPreviewTheme(
  enabled: boolean,
  liveBackdrop: ModBackdropSnapshot | null | undefined,
  layerRef: RefObject<HTMLElement | null>,
): boolean {
  const liveRef = useRef(liveBackdrop)
  liveRef.current = liveBackdrop
  const pendingApply = useRef(false)
  const [previewing, setPreviewing] = useState(false)
  const preview = useRef<{
    generation: number
    originId: string | undefined
    previewId: string | undefined
    savedMode: Promise<ThemeMode | undefined> | null
    switched: boolean
  }>({ generation: 0, originId: undefined, previewId: undefined, savedMode: null, switched: false })

  const restore = useCallback(() => {
    const current = preview.current
    current.generation += 1
    const saved = current.switched ? current.savedMode : null
    preview.current = { generation: current.generation, originId: undefined, previewId: undefined, savedMode: null, switched: false }
    setPreviewing(false)
    if (!saved) return
    void saved.then((mode) => {
      if (mode) void window.app?.setTheme?.(mode).catch(() => {})
    })
  }, [])

  const commitAppliedScheme = useCallback((scheme: 'light' | 'dark') => {
    preview.current = { generation: preview.current.generation + 1, originId: undefined, previewId: undefined, savedMode: null, switched: false }
    pendingApply.current = false
    holdHarnessScheme(null)
    void window.app?.setTheme?.(scheme).catch(() => {})
  }, [])

  useEffect(() => {
    if (!enabled) {
      pendingApply.current = false
      holdHarnessScheme(null)
      restore()
      return
    }
    const onClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const button = target.closest<HTMLElement>('[data-mod-placed-id] button')
      const layer = layerRef.current
      if (!button || !layer?.contains(button)) return
      const key = button.dataset.modKey ?? ''
      const label = button.textContent?.trim() ?? ''
      const isPreview = key.startsWith('preview') || /^preview$/i.test(label)
      if (!isPreview) {
        const themeId = key.startsWith('apply-') ? key.slice('apply-'.length) : key.startsWith('session-') ? key.slice('session-'.length) : ''
        if (themeId) {
          pendingApply.current = true
          const shown = liveRef.current
          const parsed = shown ? parseModBackdropProps(shown.result.props) : null
          if (parsed?.id === themeId && parsed.colorScheme) commitAppliedScheme(parsed.colorScheme)
          return
        }
        pendingApply.current = false
        holdHarnessScheme(null)
        if (preview.current.savedMode) restore()
        return
      }
      const shown = liveRef.current
      const backdropId = shown ? parseModBackdropProps(shown.result.props)?.id : undefined
      if (preview.current.savedMode) {
        // Another look, before this one ends. Keep the saved mode and follow the next backdrop.
        preview.current.previewId = undefined
        return
      }
      preview.current = {
        generation: preview.current.generation,
        originId: backdropId,
        previewId: undefined,
        savedMode: window.app?.getTheme ? window.app.getTheme().then((state) => state.mode).catch(() => undefined) : Promise.resolve(undefined),
        switched: false,
      }
      setPreviewing(true)
    }
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('click', onClick, true)
      restore()
    }
  }, [enabled, layerRef, restore, commitAppliedScheme])

  useEffect(() => {
    const current = preview.current
    const parsed = liveBackdrop ? parseModBackdropProps(liveBackdrop.result.props) : null
    const id = parsed?.id
    const scheme = parsed?.colorScheme
    if (pendingApply.current && scheme) {
      commitAppliedScheme(scheme)
      return
    }
    if (!enabled || !current.savedMode) return
    if (!liveBackdrop) {
      // Moving the backdrop between the pane and the window shell reports off
      // for a moment. A real end leaves it empty.
      if (!current.previewId) return
      const generation = current.generation
      const timer = window.setTimeout(() => {
        if (preview.current.generation !== generation || liveRef.current) return
        restore()
      }, 800)
      return () => window.clearTimeout(timer)
    }
    // The look ended: the backdrop went back to the theme that stood before it.
    if (current.previewId && current.originId !== undefined && id === current.originId) {
      restore()
      return
    }
    if (!scheme || id === current.originId) return
    if (current.previewId === id) return
    current.previewId = id
    const isDark = document.documentElement.classList.contains('dark')
    if ((scheme === 'dark') === isDark) return
    const generation = current.generation
    const saved = current.savedMode
    void saved.then(() => {
      if (preview.current.generation !== generation || preview.current.previewId !== id) return
      preview.current.switched = true
      void window.app?.setTheme?.(scheme).catch(() => {})
    })
  }, [enabled, liveBackdrop, restore, commitAppliedScheme])

  return previewing
}
