import { useCallback, useEffect, useRef, useState } from 'react'
import type { DiffTokenEventBaseProps } from '@pierre/diffs'
import type { LSPClient } from '@codemirror/lsp-client'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { openNewFileTab } from '@/components/activity/activity-panel-api'
import {
  getOrCreateLspClientEntry,
  pathToFileUri,
  queryLspDefinition,
  queryLspHover,
  resolveEnabledLspServer,
} from '@/lib/lsp-client-service'
import { getLspRestartVersion, subscribeLspRestart } from '@/lib/lsp-status-store'
import { inferLanguage } from '@/lib/shiki-highlighter'
import { useSourceControlStore } from '@/stores/source-control'
import { buildFullFilePath } from './review-diff-utils'

export interface ReviewLspHoverState {
  markdown: string
  rect: { left: number; top: number; bottom: number; right: number }
  language: string
}

interface UseReviewLspOptions {
  workspaceRoot: string | null
  filePath: string | null
  diskContent: string | null
  matchesDisk: boolean
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
}

function isJumpModifier(event: MouseEvent | PointerEvent | KeyboardEvent): boolean {
  return isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

function isHoverModifier(event: MouseEvent | PointerEvent | KeyboardEvent): boolean {
  return event.altKey && !event.ctrlKey && !event.metaKey
}

export function useReviewLsp({
  workspaceRoot,
  filePath,
  diskContent,
  matchesDisk,
}: UseReviewLspOptions) {
  const [lspReady, setLspReady] = useState(false)
  const [hoverCard, setHoverCard] = useState<ReviewLspHoverState | null>(null)
  const [restartNonce, setRestartNonce] = useState(() => getLspRestartVersion())

  useEffect(() => {
    return subscribeLspRestart(() => setRestartNonce(getLspRestartVersion()))
  }, [])

  const clientRef = useRef<LSPClient | null>(null)
  const uriRef = useRef<string | null>(null)
  const languageRef = useRef<string>('typescript')
  const rootRef = useRef<string | null>(null)
  const hoveredTokenRef = useRef<DiffTokenEventBaseProps | null>(null)
  const underlinedElRef = useRef<HTMLElement | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverSeqRef = useRef(0)
  const defSeqRef = useRef(0)
  const modifierDownRef = useRef(false)
  const hoverModifierDownRef = useRef(false)

  const clearUnderline = useCallback(() => {
    const el = underlinedElRef.current
    if (el) {
      el.style.textDecoration = ''
      el.style.cursor = ''
      underlinedElRef.current = null
    }
  }, [])

  const cancelHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }, [])

  const clearHover = useCallback(() => {
    cancelHoverTimer()
    hoverSeqRef.current += 1
    setHoverCard(null)
  }, [cancelHoverTimer])

  useEffect(() => {
    clearUnderline()
    clearHover()
    clientRef.current = null
    uriRef.current = null
    rootRef.current = null
    setLspReady(false)

    if (!workspaceRoot || !filePath || !matchesDisk || diskContent === null) return
    if (parseRemoteProjectKey(workspaceRoot)) return

    let cancelled = false
    let releaseDoc: (() => void) | null = null

    void (async () => {
      const server = await resolveEnabledLspServer(filePath, inferLanguage(filePath))
      if (cancelled || !server) return
      const fullPath = buildFullFilePath(workspaceRoot, filePath)
      const uri = pathToFileUri(fullPath)
      const entry = getOrCreateLspClientEntry(server.serverId, workspaceRoot)
      releaseDoc = entry.workspace.acquireVirtualFile(uri, server.languageId, diskContent)
      clientRef.current = entry.client
      uriRef.current = uri
      languageRef.current = server.languageId
      rootRef.current = workspaceRoot
      setLspReady(true)
    })()

    return () => {
      cancelled = true
      releaseDoc?.()
      clientRef.current = null
      uriRef.current = null
      rootRef.current = null
      clearUnderline()
      clearHover()
    }
  }, [workspaceRoot, filePath, diskContent, matchesDisk, restartNonce, clearUnderline, clearHover])

  const checkDefinitionUnderline = useCallback(async (token: DiffTokenEventBaseProps) => {
    const client = clientRef.current
    const uri = uriRef.current
    const root = rootRef.current
    if (!client || !uri || !root || token.side !== 'additions') {
      clearUnderline()
      return
    }
    const seq = ++defSeqRef.current
    const target = await queryLspDefinition(
      client,
      root,
      uri,
      token.lineNumber - 1,
      token.lineCharStart,
    )
    if (seq !== defSeqRef.current || !modifierDownRef.current) return
    if (target) {
      clearUnderline()
      token.tokenElement.style.textDecoration = 'underline'
      token.tokenElement.style.cursor = 'pointer'
      underlinedElRef.current = token.tokenElement
    } else {
      clearUnderline()
    }
  }, [clearUnderline])

  const fetchAndShowHover = useCallback((props: DiffTokenEventBaseProps, seq: number) => {
    const client = clientRef.current
    const uri = uriRef.current
    if (!client || !uri) return
    void queryLspHover(client, uri, props.lineNumber - 1, props.lineCharStart).then((markdown) => {
      if (seq !== hoverSeqRef.current || !markdown || modifierDownRef.current || !hoverModifierDownRef.current) return
      if (!props.tokenElement.isConnected) return
      const rect = props.tokenElement.getBoundingClientRect()
      setHoverCard({
        markdown,
        rect: { left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.right },
        language: languageRef.current,
      })
    })
  }, [])

  useEffect(() => {
    if (!lspReady) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearHover()
        return
      }
      const jumpActive = isJumpModifier(event)
      if (jumpActive && !modifierDownRef.current) {
        modifierDownRef.current = true
        clearHover()
        if (hoveredTokenRef.current) {
          void checkDefinitionUnderline(hoveredTokenRef.current)
        }
      } else if (!jumpActive && modifierDownRef.current) {
        modifierDownRef.current = false
        clearUnderline()
      }

      const hoverActive = isHoverModifier(event)
      if (hoverActive && !hoverModifierDownRef.current) {
        hoverModifierDownRef.current = true
        if (hoveredTokenRef.current && !modifierDownRef.current) {
          cancelHoverTimer()
          const seq = ++hoverSeqRef.current
          fetchAndShowHover(hoveredTokenRef.current, seq)
        }
      } else if (!hoverActive && hoverModifierDownRef.current) {
        hoverModifierDownRef.current = false
        cancelHoverTimer()
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (!isJumpModifier(event)) {
        modifierDownRef.current = false
        clearUnderline()
      }
      if (!isHoverModifier(event)) {
        hoverModifierDownRef.current = false
        cancelHoverTimer()
      }
    }
    const onBlur = () => {
      modifierDownRef.current = false
      hoverModifierDownRef.current = false
      clearUnderline()
      clearHover()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [lspReady, checkDefinitionUnderline, clearUnderline, clearHover, cancelHoverTimer, fetchAndShowHover])

  const onTokenEnter = useCallback((props: DiffTokenEventBaseProps, event: PointerEvent) => {
    if (!lspReady || props.side !== 'additions') return
    if (!props.tokenText.trim()) return
    hoveredTokenRef.current = props
    const modActive = isJumpModifier(event)
    const hoverActive = isHoverModifier(event)
    modifierDownRef.current = modActive
    hoverModifierDownRef.current = hoverActive

    if (modActive) {
      clearHover()
      void checkDefinitionUnderline(props)
      return
    }

    clearUnderline()
    cancelHoverTimer()
    if (!hoverActive) return

    const seq = ++hoverSeqRef.current
    hoverTimerRef.current = setTimeout(() => {
      fetchAndShowHover(props, seq)
    }, 280)
  }, [lspReady, checkDefinitionUnderline, clearHover, clearUnderline, cancelHoverTimer, fetchAndShowHover])

  const onTokenLeave = useCallback(() => {
    hoveredTokenRef.current = null
    defSeqRef.current += 1
    clearUnderline()
    cancelHoverTimer()
  }, [clearUnderline, cancelHoverTimer])

  const onTokenClick = useCallback((props: DiffTokenEventBaseProps, event: MouseEvent) => {
    if (!lspReady || props.side !== 'additions') return
    if (!isJumpModifier(event)) return
    const client = clientRef.current
    const uri = uriRef.current
    const root = rootRef.current
    if (!client || !uri || !root) return
    event.preventDefault()
    event.stopPropagation()
    clearHover()
    clearUnderline()
    void queryLspDefinition(
      client,
      root,
      uri,
      props.lineNumber - 1,
      props.lineCharStart,
    ).then((target) => {
      if (!target) return
      void useSourceControlStore.getState().selectFile(root, target.relativePath, target.line)
      openNewFileTab(target.relativePath, { fileRoot: root })
    })
  }, [lspReady, clearHover, clearUnderline])

  return {
    lspReady,
    hoverCard,
    dismissHover: clearHover,
    onTokenEnter,
    onTokenLeave,
    onTokenClick,
  }
}
