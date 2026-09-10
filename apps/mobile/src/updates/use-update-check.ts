import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import type { Kv } from '@superone/relay-client'
import {
  evaluateMobileUpdate,
  type MobileUpdateManifest,
  type MobileUpdateVerdict,
} from '@superone/shared/mobile-updates'
import {
  loadDismissedUpdateBuild,
  loadLastUpdateCheckAt,
  saveDismissedUpdateBuild,
  saveLastUpdateCheckAt,
} from '../mobile-preferences'
import {
  checkDownloadPreconditions,
  classifyDownloadError,
  UpdateDownloadError,
  type DownloadFailure,
} from './update-download-state'
import { shouldCheckNow } from './update-check-state'
// Type-only on purpose: a value import here would pull the native modules
// behind the ports into every jest suite that mounts the gate.
import type { UpdatePorts } from './update-ports'

export type UpdateFailure = DownloadFailure | 'install-unavailable'

export type UpdateFlowState = {
  verdict: MobileUpdateVerdict
  manifest: MobileUpdateManifest | null
  /** Present only while bytes are moving; `fraction` is null when unknowable. */
  download: { fraction: number | null } | null
  failure: UpdateFailure | null
  checking: boolean
  /** False on iOS and on dev clients, where the app cannot install anything. */
  canSelfInstall: boolean
  currentVersion: string | null
  currentBuildCode: number | null
}

export type UpdateFlowActions = {
  check: (force?: boolean) => void
  startDownload: () => void
  cancelDownload: () => void
  dismiss: () => void
  openTestFlight: () => void
  openUnknownSourcesSettings: () => void
}

const IDLE: Omit<UpdateFlowState, 'canSelfInstall' | 'currentVersion' | 'currentBuildCode'> = {
  verdict: 'none',
  manifest: null,
  download: null,
  failure: null,
  checking: false,
}

/**
 * Poll the published manifest and drive the update prompt.
 *
 * The store is injected rather than imported: `src/storage.ts` pulls a value
 * import from `@superone/relay-client`, which drags pure-ESM `@noble/ciphers`
 * into jest's CommonJS parse and silently kills whole suites. `App.tsx`
 * already holds `mobileKv`, so passing it down costs nothing.
 */
export function useUpdateCheck(
  ports: UpdatePorts,
  store: Pick<Kv, 'get' | 'set'> | null | undefined,
): { state: UpdateFlowState; actions: UpdateFlowActions } {
  const { environment } = ports
  const [core, setCore] = useState(IDLE)
  // Actions fire from user taps and must read the settled state without doing
  // side effects inside a setState updater -- those have to stay pure, and
  // StrictMode runs them twice.
  const coreRef = useRef(core)
  useEffect(() => {
    coreRef.current = core
  }, [core])
  const activeDownload = useRef<{ cancel: () => void } | null>(null)
  // Guards the check itself, which is async: two `active` transitions in the
  // same tick would otherwise both get past the persisted timestamp.
  const checking = useRef(false)

  const runCheck = useCallback(
    async (force: boolean) => {
      if (checking.current) return
      // An Android build that cannot install its own APK is a dev client, and
      // a developer's answer to "there is a newer build" is to rebuild from
      // source, not to be nagged. iOS has no self-install either, but there
      // the prompt is the whole point -- it sends them to TestFlight.
      if (environment.platform === 'android' && !environment.canSelfInstall) return

      const now = Date.now()
      const lastCheckedAtMs = await loadLastUpdateCheckAt(store)
      if (!shouldCheckNow({ lastCheckedAtMs, nowMs: now, force })) return

      checking.current = true
      setCore((prev) => ({ ...prev, checking: true }))
      try {
        const manifest = await ports.fetchManifest()
        await saveLastUpdateCheckAt(store, now)
        const dismissedBuildCode = await loadDismissedUpdateBuild(store)
        const verdict = evaluateMobileUpdate({
          manifest,
          currentBuildCode: environment.currentBuild.buildCode,
          dismissedBuildCode,
        })
        setCore((prev) => ({ ...prev, verdict, manifest, checking: false, failure: null }))
      } finally {
        checking.current = false
        setCore((prev) => (prev.checking ? { ...prev, checking: false } : prev))
      }
    },
    [environment, ports, store],
  )

  useEffect(() => {
    ports.clearStaleDownloads()
    void runCheck(false)
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void runCheck(false)
    })
    return () => {
      subscription.remove()
      activeDownload.current?.cancel()
    }
  }, [ports, runCheck])

  const actions = useMemo<UpdateFlowActions>(
    () => ({
      check: (force = true) => {
        void runCheck(force)
      },

      startDownload: () => {
        const manifest = coreRef.current.manifest
        if (!manifest?.artifact || coreRef.current.download) return

        const precondition = checkDownloadPreconditions({
          sizeBytes: manifest.artifact.sizeBytes,
          availableBytes: ports.freeDiskBytes(),
        })
        if (precondition) {
          setCore((prev) => ({ ...prev, failure: precondition }))
          return
        }

        const handle = ports.download(manifest, (fraction) => {
          setCore((current) => (current.download ? { ...current, download: { fraction } } : current))
        })
        activeDownload.current = handle
        setCore((prev) => ({ ...prev, download: { fraction: 0 }, failure: null }))

        void handle.result
          .then(async (downloaded) => {
            activeDownload.current = null
            try {
              await ports.install(downloaded)
              // Reaching here means the installer was launched, not that the
              // install succeeded -- on success this process is killed, so
              // there is nothing further to render.
              setCore((current) => ({ ...current, download: null }))
            } catch {
              // No activity took the intent: almost always the per-source
              // "install unknown apps" permission, which cannot be queried.
              setCore((current) => ({ ...current, download: null, failure: 'install-unavailable' }))
            }
          })
          .catch((error: unknown) => {
            activeDownload.current = null
            const failure =
              error instanceof UpdateDownloadError ? error.failure : classifyDownloadError(error)
            setCore((current) => ({
              ...current,
              download: null,
              failure: failure === 'cancelled' ? null : failure,
            }))
          })
      },

      cancelDownload: () => {
        activeDownload.current?.cancel()
        activeDownload.current = null
        setCore((prev) => ({ ...prev, download: null, failure: null }))
      },

      dismiss: () => {
        const { manifest, verdict } = coreRef.current
        // A hard gate is not dismissible, so nothing is remembered for it --
        // otherwise clearing the gate later would leave a stale "don't ask".
        if (manifest && verdict === 'optional') {
          void saveDismissedUpdateBuild(store, manifest.buildCode)
        }
        activeDownload.current?.cancel()
        activeDownload.current = null
        setCore((prev) => ({ ...prev, verdict: 'none', download: null, failure: null }))
      },

      openTestFlight: () => {
        const url = coreRef.current.manifest?.testflightUrl
        if (url) void ports.openTestFlight(url)
      },

      openUnknownSourcesSettings: () => {
        void ports.openUnknownSourcesSettings()
      },
    }),
    [ports, runCheck, store],
  )

  const state = useMemo<UpdateFlowState>(
    () => ({
      ...core,
      canSelfInstall: environment.canSelfInstall,
      currentVersion: environment.currentBuild.version,
      currentBuildCode: environment.currentBuild.buildCode,
    }),
    [core, environment],
  )

  return { state, actions }
}
