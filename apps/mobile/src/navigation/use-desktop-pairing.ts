import { useCallback, useRef, useState } from 'react'
import {
  DESKTOP_PAIR_FRAMES,
  DesktopPairRejectedError,
  generatePairCode,
  hostLinkOf,
  parseDesktopPairQr,
  startControllerPairing,
  startNodePairing,
  type DesktopPairQr,
  type MobileIdentity,
  type NodePairing,
  type RelayClient,
  type SavedPairing,
} from '@superone/relay-client'
import type { LanAddress } from '../device-discovery'
import { randomId } from '../ids'
import { requestSavedDesktop } from '../side-connection'
import { deviceLabel } from '../ui/device-row'
import type { DesktopPairingState } from './desktop-pairing-state'

function failureMessage(error: unknown): string {
  if (error instanceof DesktopPairRejectedError) return 'Pairing was cancelled on the desktop.'
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'pairing timeout') return 'The pairing code expired. Start again on the desktop.'
  return message
}

/**
 * Pairing two desktops with this phone as the bridge. The phone scanned a QR
 * on one desktop and carries the pairing to a saved desktop: a controller QR
 * makes the saved desktop control the scanned one, a node QR the reverse. The
 * controlled side confirms with a six-digit code either way.
 * Contract: docs/architecture/remote-node-service.md §11.5.
 */
export function useDesktopPairing(opts: {
  pairings: SavedPairing[]
  identity: () => Promise<MobileIdentity>
  resolveLan: (pairingId: string) => Promise<LanAddress | null>
  active: () => { pairingId: string | null; client: RelayClient | null }
}) {
  const [state, setState] = useState<DesktopPairingState | null>(null)
  /** Bumped by every start and cancel, so a stale flow cannot write state. */
  const generation = useRef(0)
  const room = useRef<{ cancel(): void } | null>(null)
  const nodePairing = useRef<NodePairing | null>(null)
  const latest = useRef(opts)
  latest.current = opts

  const fail = useCallback((gen: number, error: unknown) => {
    if (gen !== generation.current) return
    room.current = null
    nodePairing.current = null
    setState({ step: 'failed', message: failureMessage(error) })
  }, [])

  const request = useCallback(async (other: SavedPairing, command: Parameters<typeof requestSavedDesktop>[0]['command'], timeoutMs: number) => {
    const { identity, resolveLan, active } = latest.current
    const result = await requestSavedDesktop({
      pairing: other,
      identity: await identity(),
      resolveLan,
      active: active(),
      command,
      timeoutMs,
    }) as { error?: string; nodeCode?: string }
    if (result.error) throw new Error(result.error)
    return result
  }, [])

  const choose = useCallback(async (qr: DesktopPairQr, other: SavedPairing) => {
    const gen = generation.current
    const { deviceName } = await latest.current.identity()
    const openSocket = (url: string) => new WebSocket(url) as never
    if (qr.kind === 'controller') {
      const code = generatePairCode()
      const controller = startControllerPairing({ qr, code, controllerName: deviceLabel(other), phoneName: deviceName, openSocket })
      room.current = {
        cancel: () => {
          // Tell the desktop, which otherwise waits for a code nobody will type.
          controller.send(DESKTOP_PAIR_FRAMES.rejected)
          controller.cancel()
        },
      }
      setState({ step: 'show-code', qr, other, code })
      try {
        const nodeCode = await controller.done
        if (gen !== generation.current) return
        setState({ step: 'working', qr, other })
        await request(other, { type: 'node_pair', requestId: randomId(), nodeCode, nodeName: qr.desktopName }, 120_000)
        if (gen === generation.current) setState({ step: 'done', qr, other })
      } catch (error) {
        fail(gen, error)
      }
      return
    }
    const pairing = startNodePairing({ qr, nodeName: deviceLabel(other), phoneName: deviceName, openSocket })
    room.current = pairing
    nodePairing.current = pairing
    setState({ step: 'connecting', qr, other })
    try {
      await pairing.challenge
      if (gen === generation.current) setState({ step: 'enter-code', qr, other, mismatch: false })
    } catch (error) {
      fail(gen, error)
    }
  }, [fail, request])

  /** Node QR: the code shown on the scanned desktop, typed here. */
  const submitCode = useCallback(async (typed: string) => {
    const pairing = nodePairing.current
    if (!pairing || state?.step !== 'enter-code') return
    const { qr, other } = state
    if (!pairing.check(typed)) {
      setState({ ...state, mismatch: true })
      return
    }
    const gen = generation.current
    setState({ step: 'working', qr, other })
    try {
      const { nodeCode } = await request(other, { type: 'node_mint', requestId: randomId(), controllerName: qr.desktopName }, 60_000)
      if (!nodeCode) throw new Error('The desktop did not return a pairing code')
      await pairing.grant(nodeCode)
      if (gen === generation.current) setState({ step: 'done', qr, other })
    } catch (error) {
      pairing.cancel()
      fail(gen, error)
    }
  }, [fail, request, state])

  /** Begin from a scanned or pasted desktop-pairing QR. */
  const start = useCallback((raw: string) => {
    generation.current++
    room.current?.cancel()
    const qr = parseDesktopPairQr(raw)
    const candidates = latest.current.pairings.filter((p) => hostLinkOf(p) !== null)
    if (candidates.length === 0) {
      setState({ step: 'failed', message: 'Pair this phone with the other desktop first, then scan again.' })
    } else if (candidates.length === 1) {
      void choose(qr, candidates[0]!)
    } else {
      setState({ step: 'choose', qr, candidates })
    }
  }, [choose])

  const cancel = useCallback(() => {
    generation.current++
    room.current?.cancel()
    room.current = null
    nodePairing.current = null
    setState(null)
  }, [])

  return { state, start, choose, submitCode, cancel }
}
