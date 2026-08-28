import type { ComputerUseViewfinderClaim, Locale } from '@superone/shared/agent-types'
import type {
  CapturedImage,
  CaptureScope,
  CoordinateSpace,
  DeliveryMode,
  ObserveMode,
  UiAction,
  UiOutlineNode,
  UiRootIdentity,
} from '../types'
import { ComputerUseError } from '../types'
import { findNode } from '../outline'
import type {
  PlatformActRequest,
  PlatformActResult,
  PlatformActStepResult,
  PlatformAdapter,
  PlatformLook,
  PlatformRecordingResult,
} from './types'
import {
  getSharedHelperClient,
  type MacosHelperClient,
} from './macos-helper-client'
import type {
  HelperAppInfo,
  HelperAxActionResult,
  HelperAxTreeResult,
  HelperCaptureResult,
  HelperDoctor,
  HelperWindowInfo,
} from './helper-protocol'
import {
  axTreeToOutline,
  parseElementIndex,
  pictureOnlyOutline,
} from './ax-outline'

export interface MacosAdapterOptions {
  client?: MacosHelperClient
  /** Downscale full captures for model context (logical width). */
  maxCaptureWidth?: number
  /**
   * Bundle IDs the session is allowed to show/act on. Required for capture
   * exclusion filter unless allowAllApps is true.
   */
  getGrantedBundleIds?: () => string[]
  /** When true, capture excludes no applications. */
  getAllowAllApps?: () => boolean
  /** Stream a live preview of the current window into the owning session. */
  getPictureInPictureEnabled?: () => boolean
  /**
   * Called after the helper accepts the stream target. This both identifies the
   * owning session and refreshes Computer Use's recency in the shared viewfinder.
   */
  onViewfinderClaim?: (claim: Omit<ComputerUseViewfinderClaim, 'active'>) => void
  /** Connected display used as a temporary workspace; null keeps the current display. */
  getDedicatedDisplayId?: () => string | null
  /**
   * Session driving this adapter. Sent with overlay updates so the helper's
   * status menu can tell the host which turn to interrupt on Stop.
   */
  sessionId?: string
  /** Current SuperOne UI locale for native status-item copy. */
  getLocale?: () => Locale
}

/**
 * macOS adapter: visual capture + coordinate / keyboard input + P3 AX tree.
 * Default delivery is app-directed (CGEvent.postToPid) so the agent can operate
 * apps in the background without stealing the user's frontmost app.
 * delivery=semantic uses AX only and never silently upgrades to HID.
 */
export class MacosPlatformAdapter implements PlatformAdapter {
  private readonly client: MacosHelperClient
  private readonly maxCaptureWidth: number
  private readonly getGrantedBundleIds: () => string[]
  private readonly getAllowAllApps: () => boolean
  private readonly getPictureInPictureEnabled: () => boolean
  private readonly onViewfinderClaim: (claim: Omit<ComputerUseViewfinderClaim, 'active'>) => void
  private readonly getDedicatedDisplayId: () => string | null
  private readonly getLocale: () => Locale
  private readonly sessionId: string
  private lookSeq = 0
  private indicatorsSynced: boolean | null = null
  private pictureInPictureSynced: boolean | null = null

  constructor(options: MacosAdapterOptions = {}) {
    this.client = options.client ?? getSharedHelperClient()
    this.maxCaptureWidth = options.maxCaptureWidth ?? 1440
    this.getGrantedBundleIds = options.getGrantedBundleIds ?? (() => [])
    this.getAllowAllApps = options.getAllowAllApps ?? (() => false)
    this.getPictureInPictureEnabled = options.getPictureInPictureEnabled ?? (() => true)
    this.onViewfinderClaim = options.onViewfinderClaim ?? (() => {})
    this.getDedicatedDisplayId = options.getDedicatedDisplayId ?? (() => null)
    this.getLocale = options.getLocale ?? (() => 'en')
    this.sessionId = options.sessionId ?? ''
  }

  private visualOn(): boolean {
    return true
  }

  private async syncIndicatorPref(): Promise<void> {
    const on = this.visualOn()
    if (this.indicatorsSynced === on) return
    try {
      await this.client.call('overlay_set_enabled', { enabled: on })
      this.indicatorsSynced = on
    } catch {
      // helper may be offline in unit tests
    }
  }

  private async syncPictureInPicturePref(): Promise<boolean> {
    const enabled = this.getPictureInPictureEnabled()
    if (this.pictureInPictureSynced !== enabled) {
      try {
        await this.client.call('pip_set_enabled', { enabled })
        this.pictureInPictureSynced = enabled
      } catch {
        // helper may be offline in unit tests
      }
    }
    return enabled
  }

  private windowOverlayFields(root: UiRootIdentity): Record<string, unknown> {
    const b = root.bounds
    return {
      visualIndicators: this.visualOn(),
      windowApp: root.app,
      windowBundleId: root.bundleId,
      targetBundleId: root.bundleId,
      sessionId: this.sessionId,
      locale: this.getLocale(),
      // Bounds still sent for helpers that want them; status-item mode ignores geometry.
      windowX: b.x,
      windowY: b.y,
      windowWidth: b.width,
      windowHeight: b.height,
      ...(typeof root.windowId === 'number' ? { windowId: root.windowId } : {}),
      ...(typeof root.windowLayer === 'number' ? { windowLayer: root.windowLayer } : {}),
    }
  }

  private async placeOnDedicatedDisplay(
    root: UiRootIdentity,
    options: { failClosed?: boolean } = {},
  ): Promise<UiRootIdentity> {
    const displayId = this.getDedicatedDisplayId()
    if (!displayId || typeof root.windowId !== 'number') return root
    try {
      const result = await this.client.call<{
        moved?: boolean
        bounds?: { x: number; y: number; width: number; height: number }
      }>('display_place_window', {
        sessionId: this.sessionId,
        displayId,
        windowId: root.windowId,
        pid: root.pid,
        title: root.title,
      })
      const bounds = result.bounds
      if (!bounds || bounds.width <= 1 || bounds.height <= 1) return root
      return { ...root, bounds: { ...bounds } }
    } catch (error) {
      if (options.failClosed) throw error
      // Display disconnected, helper unavailable, or window rejects AXPosition.
      return root
    }
  }

  private coordinateSpaceAfterMove(
    coordinateSpace: CoordinateSpace | undefined,
    previousRoot: UiRootIdentity,
    targetRoot: UiRootIdentity,
  ): CoordinateSpace | undefined {
    if (coordinateSpace?.kind !== 'window' || !coordinateSpace.capturedBounds) {
      return coordinateSpace
    }
    const dx = targetRoot.bounds.x - previousRoot.bounds.x
    const dy = targetRoot.bounds.y - previousRoot.bounds.y
    if (dx === 0 && dy === 0) return coordinateSpace
    return {
      ...coordinateSpace,
      capturedBounds: {
        ...coordinateSpace.capturedBounds,
        x: coordinateSpace.capturedBounds.x + dx,
        y: coordinateSpace.capturedBounds.y + dy,
      },
    }
  }

  /**
   * Codex-style menu-bar chip (app icon + mouse) plus optional on-screen virtual cursor.
   */
  private async showTargetOverlay(root: UiRootIdentity, opts?: {
    cursorX?: number
    cursorY?: number
    pulseRing?: boolean
    hideCursor?: boolean
    coordinateSpace?: CoordinateSpace
  }): Promise<void> {
    if (!this.visualOn()) return
    await this.syncIndicatorPref()
    const showPictureInPicture = await this.syncPictureInPicturePref()
    try {
      await this.client.call('overlay_show_target', {
        app: root.app,
        bundleId: root.bundleId,
        sessionId: this.sessionId,
        targetBundleId: root.bundleId,
        locale: this.getLocale(),
        windowApp: root.app,
        windowBundleId: root.bundleId,
        x: root.bounds.x,
        y: root.bounds.y,
        width: root.bounds.width,
        height: root.bounds.height,
        ...(typeof root.windowId === 'number' ? { windowId: root.windowId } : {}),
        ...(typeof root.windowLayer === 'number' ? { windowLayer: root.windowLayer } : {}),
        ...(opts?.cursorX != null && opts?.cursorY != null
          ? { cursorX: opts.cursorX, cursorY: opts.cursorY, pulseRing: opts.pulseRing ?? false }
          : {}),
        ...(opts?.hideCursor ? { hideCursor: true } : {}),
        ...this.coordinatePayload(opts?.coordinateSpace),
      })
      if (showPictureInPicture && typeof root.windowId === 'number') {
        const preview = await this.client.call<{ shown?: boolean }>('pip_show_target', {
          sessionId: this.sessionId,
          windowId: root.windowId,
          app: root.app,
          bundleId: root.bundleId,
          title: root.title,
          sourceWidth: opts?.coordinateSpace?.width ?? root.bounds.width,
          sourceHeight: opts?.coordinateSpace?.height ?? root.bounds.height,
          ...(opts?.cursorX != null && opts?.cursorY != null
            ? { cursorX: opts.cursorX, cursorY: opts.cursorY, pulse: opts.pulseRing ?? false }
            : {}),
          ...this.coordinatePayload(opts?.coordinateSpace),
        })
        if (preview.shown === false) return
        this.onViewfinderClaim({
          sessionId: this.sessionId,
          windowId: root.windowId,
          pid: root.pid,
          app: root.app,
          bundleId: root.bundleId,
          title: root.title,
          sourceWidth: opts?.coordinateSpace?.width ?? root.bounds.width,
          sourceHeight: opts?.coordinateSpace?.height ?? root.bounds.height,
          ...(opts?.cursorX != null && opts?.cursorY != null
            ? { cursorX: opts.cursorX, cursorY: opts.cursorY, pulse: opts.pulseRing ?? false }
            : {}),
        })
      }
    } catch {
      // non-fatal
    }
  }

  /**
   * Paint the software cursor before an action so the user sees the hop/pulse.
   * Agents often use press/setText (AX) which never hit helper click/drag paths —
   * those used to show only a menu-bar chip (or nothing). Resolve a tip from:
   * explicit coordinates → outline ref bounds center → window center.
   */
  private async showActionCursor(
    root: UiRootIdentity,
    opts?: {
      x?: number
      y?: number
      ref?: string
      outline?: UiOutlineNode
      pulse?: boolean
      coordinateSpace?: CoordinateSpace
    },
  ): Promise<void> {
    if (!this.visualOn()) return
    let x = opts?.x
    let y = opts?.y
    if ((x == null || y == null) && opts?.ref && opts.outline) {
      const center = boundsCenter(findNode(opts.outline, opts.ref)?.bounds)
      if (center) {
        x = center.x
        y = center.y
      }
    }
    if (x == null || y == null) {
      const b = opts?.outline?.bounds
        ?? (opts?.coordinateSpace
          ? { x: 0, y: 0, width: opts.coordinateSpace.width, height: opts.coordinateSpace.height }
          : root.bounds)
      if (b && b.width > 0 && b.height > 0) {
        x = b.x + b.width / 2
        y = b.y + b.height / 2
      }
    }
    if (x == null || y == null) {
      await this.showTargetOverlay(root, {
        pulseRing: opts?.pulse ?? true,
        coordinateSpace: opts?.coordinateSpace,
      })
      return
    }
    await this.showTargetOverlay(root, {
      cursorX: x,
      cursorY: y,
      pulseRing: opts?.pulse ?? true,
      coordinateSpace: opts?.coordinateSpace,
    })
  }

  /** Hide menu-bar chip + software cursor immediately (agent idle / interrupt / app quit). */
  async clearVisuals(): Promise<void> {
    try {
      await this.client.call('session_clear_visuals', { sessionId: this.sessionId })
    } catch {
      // helper offline / tests
    }
    this.indicatorsSynced = null
    this.pictureInPictureSynced = null
  }

  async doctor(): Promise<HelperDoctor> {
    return this.client.call<HelperDoctor>('doctor')
  }

  async listApps(): Promise<HelperAppInfo[]> {
    const res = await this.client.call<{ apps: HelperAppInfo[] }>('list_apps')
    return res.apps ?? []
  }

  async listRoots(): Promise<Array<Omit<UiRootIdentity, 'rootId'>>> {
    const res = await this.client.call<{ windows: HelperWindowInfo[] }>('list_windows', {
      scanBundleIds: this.getGrantedBundleIds(),
    })
    const windows = res.windows ?? []
    const front = await this.client.call<HelperAppInfo | null>('frontmost').catch(() => null)
    const activeRootIndex = [
      windows.findIndex((w) => w.pid === front?.pid && w.modal),
      windows.findIndex((w) => w.pid === front?.pid && w.focused),
      windows.findIndex((w) => w.pid === front?.pid),
    ].find((index) => index >= 0) ?? -1
    return windows.map((w, index) => ({
      kind: (w.kind as UiRootIdentity['kind']) || 'window',
      app: w.app,
      bundleId: w.bundleId,
      pid: w.pid,
      title: w.title || w.app,
      bounds: w.bounds,
      focused: index === activeRootIndex,
      visible: w.visible,
      minimized: w.minimized,
      modal: w.modal,
      resourceKey: w.resourceKey || `pid:${w.pid}`,
      ...(typeof w.windowId === 'number' ? { windowId: w.windowId } : {}),
      ...(w.axRootId ? { axRootId: w.axRootId } : {}),
      ...(typeof w.windowLayer === 'number' ? { windowLayer: w.windowLayer } : {}),
    }))
  }

  /**
   * Hide software cursor only for the duration of a screenshot, then restore.
   * Keeps tip state so the hop continues after capture; status chip stays up.
   */
  private async withCursorSuspendedForCapture<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.visualOn()) return fn()
    try {
      await this.client.call('overlay_cursor_visible', { visible: false })
    } catch {
      // helper offline / tests
    }
    try {
      return await fn()
    } finally {
      try {
        await this.client.call('overlay_cursor_visible', { visible: true })
      } catch {
        // ignore
      }
    }
  }

  async look(
    root: UiRootIdentity,
    mode: ObserveMode,
    captureScope: CaptureScope = 'window',
  ): Promise<PlatformLook> {
    const allowAll = this.getAllowAllApps()
    const granted = this.getGrantedBundleIds()
    if (!allowAll && granted.length === 0) {
      throw new ComputerUseError(
        'NOT_GRANTED',
        'No apps on the Computer Use allowlist — grant an app when prompted, add it under Settings → Computer Use → Always Allow, or enable "Allow All Apps".',
      )
    }

    const targetRoot = await this.placeOnDedicatedDisplay(root)

    await this.syncIndicatorPref()

    let coordinateSpace: CoordinateSpace
    let image: CapturedImage | undefined

    if (mode === 'semantic') {
      const semanticSpace: CoordinateSpace | undefined = captureScope === 'window'
        ? {
            width: targetRoot.bounds.width,
            height: targetRoot.bounds.height,
            scale: 1,
            fullScreen: false,
            kind: 'window',
            ...(typeof targetRoot.windowId === 'number' ? { windowId: targetRoot.windowId } : {}),
            ...(targetRoot.axRootId ? { axRootId: targetRoot.axRootId } : {}),
            capturedBounds: { ...targetRoot.bounds },
          }
        : undefined
      const axBootstrap = await this.fetchAxOutline(targetRoot, semanticSpace)
      coordinateSpace = axBootstrap.coordinateSpace
      image = undefined
      // No screenshot — keep cursor if a control turn is in progress.
      await this.showTargetOverlay(targetRoot, { pulseRing: true })
      this.lookSeq += 1
      return {
        root: { ...targetRoot, focused: true },
        outline: axBootstrap.outline,
        image,
        coordinateSpace,
        nativeLookId: `mac-look-${this.lookSeq}`,
        outlineTruncated: axBootstrap.truncated,
      }
    }

    // Suspend software cursor only while capturing; restore immediately after.
    const capture = await this.withCursorSuspendedForCapture(() =>
      this.client.call<HelperCaptureResult>('capture', {
        allowAllApps: allowAll,
        grantedBundleIds: allowAll ? [] : granted,
        maxWidth: this.maxCaptureWidth,
        capture: captureScope,
        pid: targetRoot.pid,
        ...(typeof targetRoot.windowId === 'number' ? { windowId: targetRoot.windowId } : {}),
        ...(targetRoot.axRootId ? { axRootId: targetRoot.axRootId } : {}),
      }),
    )

    // Chip + restore last tip (if any). Do not force-hide cursor after observe.
    await this.showTargetOverlay(targetRoot, { pulseRing: true })

    this.lookSeq += 1
    coordinateSpace = { ...capture.coordinateSpace }

    image = {
      mimeType: 'image/png',
      data: capture.data,
      width: capture.width,
      height: capture.height,
    }

    let outline: UiOutlineNode
    let outlineTruncated = false
    if (mode === 'visual') {
      outline = pictureOnlyOutline(
        targetRoot.title || targetRoot.app,
        coordinateSpace.width,
        coordinateSpace.height,
      )
    } else {
      // fused: AX tree + screenshot; fall back to picture-only if AX missing.
      try {
        const ax = await this.fetchAxOutline(targetRoot, coordinateSpace)
        outline = ax.outline
        outlineTruncated = ax.truncated
      } catch {
        outline = pictureOnlyOutline(
          targetRoot.title || targetRoot.app,
          coordinateSpace.width,
          coordinateSpace.height,
        )
      }
    }

    return {
      root: {
        ...targetRoot,
        focused: true,
        ...(coordinateSpace.kind === 'window' && coordinateSpace.capturedBounds
          ? { bounds: { ...coordinateSpace.capturedBounds } }
          : {}),
      },
      outline,
      image,
      coordinateSpace,
      nativeLookId: `mac-look-${this.lookSeq}`,
      outlineTruncated,
    }
  }

  private async fetchAxOutline(
    root: UiRootIdentity,
    captureSpace: CoordinateSpace | undefined,
  ): Promise<{ outline: UiOutlineNode; coordinateSpace: CoordinateSpace; truncated: boolean }> {
    const res = await this.client.call<HelperAxTreeResult>('ax_tree', {
      pid: root.pid,
      // Budget spent on emitted nodes only (the helper drops wrapper groups),
      // so this is real content rather than Chromium nesting.
      maxNodes: 1200,
      maxDepth: 64,
      ...(captureSpace
        ? {
            captureWidth: captureSpace.width,
            captureHeight: captureSpace.height,
            ...(captureSpace.capturedBounds
              ? {
                  captureX: captureSpace.capturedBounds.x,
                  captureY: captureSpace.capturedBounds.y,
                  captureSourceWidth: captureSpace.capturedBounds.width,
                  captureSourceHeight: captureSpace.capturedBounds.height,
                }
              : {}),
          }
        : {}),
      ...(root.title ? { windowTitle: root.title } : {}),
      ...(typeof root.windowId === 'number' ? { windowId: root.windowId } : {}),
      ...(root.axRootId ? { axRootId: root.axRootId } : {}),
    })
    const outline = axTreeToOutline(res.tree)
    const coordinateSpace: CoordinateSpace = {
      width: captureSpace?.width ?? res.display.width,
      height: captureSpace?.height ?? res.display.height,
      scale: 1,
      fullScreen: captureSpace?.fullScreen ?? true,
      ...(captureSpace ?? { kind: 'display' as const }),
    }
    return { outline, coordinateSpace, truncated: !!res.truncated }
  }

  async act(req: PlatformActRequest): Promise<PlatformActResult> {
    await this.syncIndicatorPref()
    let targetRoot: UiRootIdentity
    try {
      targetRoot = await this.placeOnDedicatedDisplay(req.root, { failClosed: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const code = (err as { code?: string }).code
      return {
        steps: [{
          applied: false,
          description: `display placement: ${code ?? 'error'}: ${message}`,
        }],
        stoppedAt: 0,
      }
    }
    const coordinateSpace = this.coordinateSpaceAfterMove(
      req.coordinateSpace,
      req.root,
      targetRoot,
    )
    if (coordinateSpace?.kind === 'window') {
      try {
        await this.client.call('validate_geometry', {
          targetBundleId: targetRoot.bundleId,
          targetPid: targetRoot.pid,
          ...this.coordinatePayload(coordinateSpace),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const code = (err as { code?: string }).code
        return {
          steps: [{
            applied: false,
            description: `geometry: ${code ?? 'error'}: ${message}`,
          }],
          stoppedAt: 0,
        }
      }
    }
    // Menu-bar chip at transaction start; per-action showActionCursor paints/moves the tip.
    // Cursor stays visible for the whole control turn — only screenshots suspend it.
    await this.showTargetOverlay(targetRoot, { pulseRing: false, coordinateSpace })

    const steps: PlatformActStepResult[] = []
    let stoppedAt: number | undefined
    const target = {
      bundleId: targetRoot.bundleId,
      pid: targetRoot.pid,
      root: targetRoot,
      outline: req.outline,
      coordinateSpace,
    }

    for (let i = 0; i < req.actions.length; i++) {
      const action = req.actions[i]!
      try {
        const step = await this.applyOne(action, target, req.delivery)
        steps.push(step)
        if (!step.applied) {
          stoppedAt = i
          break
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const code = (err as { code?: string }).code
        steps.push({
          applied: false,
          description: `${action.type}: ${code ?? 'error'}: ${message}`,
        })
        stoppedAt = i
        break
      }
    }

    // Do not auto-hide after act — session idle / interrupt / dispose clears visuals.
    return { steps, stoppedAt }
  }

  async startRecording(root: UiRootIdentity, outputPath: string): Promise<void> {
    if (typeof root.windowId !== 'number') {
      throw new ComputerUseError('INVALID_ACTION', 'Action recording requires a capturable window')
    }
    await this.client.call('record_start', {
      windowId: root.windowId,
      outputPath,
      maxWidth: this.maxCaptureWidth,
    })
  }

  async stopRecording(): Promise<PlatformRecordingResult> {
    return this.client.call<PlatformRecordingResult>('record_stop')
  }

  async zoom(
    root: UiRootIdentity,
    region: [number, number, number, number],
    coordinateSpace: CoordinateSpace,
  ): Promise<CapturedImage> {
    const allowAll = this.getAllowAllApps()
    const granted = this.getGrantedBundleIds()
    const res = await this.withCursorSuspendedForCapture(() =>
      this.client.call<HelperCaptureResult>('zoom', {
        allowAllApps: allowAll,
        grantedBundleIds: allowAll ? [] : granted,
        region,
        // Same width budget as full observe — avoid full-retina intermediate captures.
        maxWidth: this.maxCaptureWidth,
        capture: coordinateSpace.kind ?? (coordinateSpace.fullScreen ? 'display' : 'window'),
        pid: root.pid,
        ...(typeof root.windowId === 'number' ? { windowId: root.windowId } : {}),
        ...(root.axRootId ? { axRootId: root.axRootId } : {}),
        ...this.coordinatePayload(coordinateSpace),
      }),
    )
    return {
      mimeType: 'image/png',
      data: res.data,
      width: res.width,
      height: res.height,
    }
  }

  async focusApp(app: string): Promise<void> {
    // Never steal frontmost by default — background Computer Use.
    await this.client.call('focus_app', { app, activate: false })
  }

  async launchApp(app: string): Promise<void> {
    await this.client.call('launch_app', { app, activate: false })
  }

  async frontmost(): Promise<{ app: string; bundleId: string; pid: number } | null> {
    return this.client.call('frontmost')
  }

  private helperDelivery(delivery: DeliveryMode): 'app_post' | 'global' {
    return delivery === 'physical' ? 'global' : 'app_post'
  }

  private targetPayload(
    target: {
      bundleId: string
      pid: number
      root: UiRootIdentity
      coordinateSpace?: CoordinateSpace
    },
    delivery: DeliveryMode,
  ): Record<string, unknown> {
    const overlay = this.windowOverlayFields(target.root)
    if (delivery === 'physical') {
      return {
        delivery: 'global',
        requireFrontmostBundleId: target.bundleId,
        targetBundleId: target.bundleId,
        targetPid: target.pid,
        ...this.coordinatePayload(target.coordinateSpace),
        ...overlay,
      }
    }
    return {
      delivery: 'app_post',
      targetBundleId: target.bundleId,
      targetPid: target.pid,
      ...this.coordinatePayload(target.coordinateSpace),
      ...overlay,
    }
  }

  private async applyOne(
    action: UiAction,
    target: {
      bundleId: string
      pid: number
      root: UiRootIdentity
      outline?: UiOutlineNode
      coordinateSpace?: CoordinateSpace
    },
    delivery: DeliveryMode,
  ): Promise<PlatformActStepResult> {
    if (delivery === 'semantic') {
      return this.applySemantic(action, target)
    }

    const targetFields = this.targetPayload(target, delivery)
    switch (action.type) {
      case 'click': {
        let x = action.x
        let y = action.y
        if ((x == null || y == null) && action.ref && target.outline) {
          const center = boundsCenter(findNode(target.outline, action.ref)?.bounds)
          if (center) {
            x = center.x
            y = center.y
          }
        }
        if (x == null || y == null) {
          return {
            applied: false,
            description:
              'click: requires x,y coordinates or a ref with bounds (observe semantic/fused for AX refs)',
          }
        }
        // Cursor first (spring hop) so the tip is visible before/during HID.
        await this.showActionCursor(target.root, {
          x,
          y,
          ref: action.ref,
          outline: target.outline,
          pulse: true,
          coordinateSpace: target.coordinateSpace,
        })
        await this.client.call('click', {
          x,
          y,
          button: action.button ?? 'left',
          count: 1,
          ...targetFields,
        })
        return {
          applied: true,
          unknown: true,
          description: `click(${x},${y}) via ${this.helperDelivery(delivery)}`,
        }
      }
      case 'typeText': {
        // Optional: focus AX ref first so background typing lands on the right field.
        await this.showActionCursor(target.root, {
          ref: action.ref,
          outline: target.outline,
          pulse: true,
          coordinateSpace: target.coordinateSpace,
        })
        if (action.ref) {
          const idx = parseElementIndex(action.ref)
          if (idx != null) {
            const node = target.outline ? findNode(target.outline, action.ref) : undefined
            try {
              await this.client.call('ax_action', {
                pid: target.pid,
                targetPid: target.pid,
                index: idx,
                action: 'focus',
                windowTitle: target.root.title,
                ...(typeof target.root.windowId === 'number'
                  ? { windowId: target.root.windowId }
                  : {}),
                ...(target.root.axRootId ? { axRootId: target.root.axRootId } : {}),
                ...this.axTargetHintFields(node, target.coordinateSpace),
                ...this.coordinatePayload(target.coordinateSpace),
              })
            } catch {
              // best-effort
            }
          }
        }
        await this.client.call('type_text', {
          text: action.text,
          ...targetFields,
        })
        return {
          applied: true,
          unknown: true,
          description: `typeText(${action.text.length} chars) via ${this.helperDelivery(delivery)}`,
        }
      }
      case 'keypress': {
        await this.showActionCursor(target.root, {
          outline: target.outline,
          pulse: false,
          coordinateSpace: target.coordinateSpace,
        })
        for (const key of action.keys) {
          await this.client.call('keypress', {
            key,
            ...targetFields,
          })
        }
        return {
          applied: true,
          unknown: true,
          description: `keypress(${action.keys.join('+')}) via ${this.helperDelivery(delivery)}`,
        }
      }
      case 'moveMouse': {
        await this.showActionCursor(target.root, {
          x: action.x,
          y: action.y,
          outline: target.outline,
          pulse: true,
          coordinateSpace: target.coordinateSpace,
        })
        await this.client.call('move_mouse', {
          x: action.x,
          y: action.y,
          ...targetFields,
        })
        return {
          applied: true,
          unknown: true,
          description: `moveMouse(${action.x},${action.y}) via ${this.helperDelivery(delivery)}`,
        }
      }
      case 'scroll': {
        // Priority: explicit x,y → ref bounds center → outline/window center.
        let x: number | undefined = action.x
        let y: number | undefined = action.y
        if ((x == null || y == null) && action.ref && target.outline) {
          const center = boundsCenter(findNode(target.outline, action.ref)?.bounds)
          if (center) {
            x = center.x
            y = center.y
          }
        }
        // Fall back to center of capture-space outline (or window bounds).
        if (x == null || y == null) {
          const b = target.outline?.bounds
            ?? (target.coordinateSpace?.kind === 'window'
              ? {
                  x: 0,
                  y: 0,
                  width: target.coordinateSpace.width,
                  height: target.coordinateSpace.height,
                }
              : target.root.bounds)
          x = (b?.x ?? 0) + (b?.width ?? 800) / 2
          y = (b?.y ?? 0) + (b?.height ?? 600) / 2
        }
        const dx = action.dx ?? 0
        const dy = action.dy ?? 0
        if (dx === 0 && dy === 0) {
          return { applied: false, description: 'scroll: requires dx and/or dy' }
        }
        await this.showActionCursor(target.root, {
          x,
          y,
          outline: target.outline,
          pulse: true,
          coordinateSpace: target.coordinateSpace,
        })
        await this.client.call('scroll', {
          x,
          y,
          dx,
          dy,
          ...targetFields,
        })
        return {
          applied: true,
          unknown: true,
          description: `scroll(dx=${dx},dy=${dy}) at (${Math.round(x)},${Math.round(y)}) via ${this.helperDelivery(delivery)}`,
        }
      }
      case 'drag': {
        if (!action.path || action.path.length < 2) {
          return { applied: false, description: 'drag: path needs ≥2 points' }
        }
        const a0 = action.path[0]!
        await this.showActionCursor(target.root, {
          x: a0.x,
          y: a0.y,
          outline: target.outline,
          pulse: true,
          coordinateSpace: target.coordinateSpace,
        })
        await this.client.call('drag', {
          path: action.path.map((p) => ({ x: p.x, y: p.y })),
          ...targetFields,
        })
        const a = action.path[0]!
        const b = action.path[action.path.length - 1]!
        return {
          applied: true,
          unknown: true,
          description: `drag(${a.x},${a.y})→(${b.x},${b.y}) n=${action.path.length} via ${this.helperDelivery(delivery)}`,
        }
      }
      case 'press':
      case 'setText':
        // Prefer AX even under app-directed when the agent targets a ref.
        return this.applySemantic(action, target)
      default: {
        const _e: never = action
        return { applied: false, description: `unknown action ${JSON.stringify(_e)}` }
      }
    }
  }

  /**
   * delivery=semantic — AX only; never post CGEvent / HID.
   */
  private async applySemantic(
    action: UiAction,
    target: {
      bundleId: string
      pid: number
      root: UiRootIdentity
      outline?: UiOutlineNode
      coordinateSpace?: CoordinateSpace
    },
  ): Promise<PlatformActStepResult> {
    switch (action.type) {
      case 'press': {
        return this.axActionStep(target, action.ref, 'press')
      }
      case 'setText': {
        return this.axActionStep(target, action.ref, 'set_value', action.text)
      }
      case 'click': {
        // Semantic click = AXPress on ref; coordinates are not semantic.
        if (!action.ref) {
          return {
            applied: false,
            description: 'click under delivery=semantic requires ref (use app-directed for x,y)',
          }
        }
        return this.axActionStep(target, action.ref, 'press')
      }
      case 'typeText': {
        if (!action.ref) {
          return {
            applied: false,
            description:
              'typeText under delivery=semantic requires ref with settable AXValue (use app-directed for keyboard typing)',
          }
        }
        return this.axActionStep(target, action.ref, 'set_value', action.text)
      }
      case 'scroll': {
        // Prefer AX page scroll actions when available; fail closed otherwise.
        if (!action.ref) {
          return {
            applied: false,
            description: 'scroll under delivery=semantic requires ref (use app-directed for wheel at x,y)',
          }
        }
        const dy = action.dy ?? 0
        const dx = action.dx ?? 0
        // Map dominant axis to AX scroll page action via ax_action names we may add later.
        // For now: semantic scroll uses wheel at element bounds (still HID) is forbidden —
        // only true AX would be allowed. Fail closed with a clear message.
        if (dx === 0 && dy === 0) {
          return { applied: false, description: 'scroll: requires dx and/or dy' }
        }
        return {
          applied: false,
          description:
            'scroll under delivery=semantic: AX page-scroll not wired yet; use delivery=app-directed',
        }
      }
      case 'keypress':
      case 'drag':
      case 'moveMouse':
        return {
          applied: false,
          description: `${action.type}: not available under delivery=semantic (AX-only)`,
        }
      default: {
        const _e: never = action
        return { applied: false, description: `unknown action ${JSON.stringify(_e)}` }
      }
    }
  }

  private async axActionStep(
    target: {
      pid: number
      root: UiRootIdentity
      outline?: UiOutlineNode
      coordinateSpace?: CoordinateSpace
    },
    ref: string,
    action: string,
    value?: string,
  ): Promise<PlatformActStepResult> {
    const idx = parseElementIndex(ref)
    if (idx == null) {
      return { applied: false, description: `${action}: invalid ref ${ref}` }
    }
    let node: UiOutlineNode | undefined
    if (target.outline) {
      node = findNode(target.outline, ref)
      if (!node) {
        return { applied: false, description: `${action}: ref ${ref} not in outline` }
      }
      if (node.pictureOnly) {
        return {
          applied: false,
          description: `${action}: ${ref} is picture-only (observe semantic/fused for AX)`,
        }
      }
    }
    try {
      // AX press/setText never went through click/drag — paint software cursor at
      // the element (or window) so agent runs are observable like OCU.
      await this.showActionCursor(target.root, {
        ref,
        outline: target.outline,
        pulse: true,
        coordinateSpace: target.coordinateSpace,
      })
      const res = await this.client.call<HelperAxActionResult>('ax_action', {
        pid: target.pid,
        targetPid: target.pid,
        index: idx,
        action,
        ...(value != null ? { value } : {}),
        windowTitle: target.root.title,
        ...(typeof target.root.windowId === 'number'
          ? { windowId: target.root.windowId }
          : {}),
        ...(target.root.axRootId ? { axRootId: target.root.axRootId } : {}),
        ...this.axTargetHintFields(node, target.coordinateSpace),
        ...this.coordinatePayload(target.coordinateSpace),
      })
      const before = { value: res.beforeValue, name: res.beforeName }
      const after = { value: res.afterValue, name: res.afterName }
      let unknown = true
      let confirmedNoEffect = false
      if (action === 'set_value' && value != null) {
        if (res.afterValue === value || (res.afterValue ?? '').includes(value)) {
          unknown = false
        } else if (res.afterValue === res.beforeValue) {
          confirmedNoEffect = true
          unknown = false
        }
      } else if (action === 'press') {
        // Press has no reliable readback without a richer diff — leave unknown
        // unless the node changed. Value covers toggle-shaped controls (a radio
        // flipping 0 → 1); name covers controls that relabel instead
        // (Play → Pause). Both must be read, because a control that has no
        // value now correctly reports undefined rather than echoing its title.
        const changed = (a: string | undefined, b: string | undefined) =>
          a !== undefined && b !== undefined && a !== b
        if (changed(res.afterValue, res.beforeValue) || changed(res.afterName, res.beforeName)) {
          unknown = false
        }
      }
      return {
        applied: true,
        unknown,
        confirmedNoEffect,
        description: res.recovered
          ? `ax ${action} ${ref} (recovered index ${idx} -> ${res.index})`
          : `ax ${action} ${ref} (index ${idx})`,
        before,
        after,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const code = (err as { code?: string }).code
      return {
        applied: false,
        description: `ax ${action} ${ref}: ${code ?? 'error'}: ${message}`,
      }
    }
  }

  private axTargetHintFields(
    node: UiOutlineNode | undefined,
    coordinateSpace: CoordinateSpace | undefined,
  ): Record<string, unknown> {
    if (!node) return {}
    return {
      expectedRole: node.role,
      ...(node.name ? { expectedName: node.name } : {}),
      ...(node.value != null ? { expectedValue: node.value } : {}),
      ...(node.bounds
        ? {
            expectedBounds: [
              node.bounds.x,
              node.bounds.y,
              node.bounds.width,
              node.bounds.height,
            ],
          }
        : {}),
      ...(coordinateSpace
        ? {
            expectedCoordinateWidth: coordinateSpace.width,
            expectedCoordinateHeight: coordinateSpace.height,
            ...(coordinateSpace.capturedBounds
              ? {
                  expectedCoordinateX: coordinateSpace.capturedBounds.x,
                  expectedCoordinateY: coordinateSpace.capturedBounds.y,
                  expectedCoordinateSourceWidth: coordinateSpace.capturedBounds.width,
                  expectedCoordinateSourceHeight: coordinateSpace.capturedBounds.height,
                }
              : {}),
          }
        : {}),
    }
  }

  private coordinatePayload(
    coordinateSpace: CoordinateSpace | undefined,
  ): Record<string, unknown> {
    if (!coordinateSpace) return {}
    return {
      coordinateKind: coordinateSpace.kind ?? (coordinateSpace.fullScreen ? 'display' : 'window'),
      coordinateWidth: coordinateSpace.width,
      coordinateHeight: coordinateSpace.height,
      ...(coordinateSpace.displayBounds ? { coordinateScale: coordinateSpace.scale } : {}),
      ...(typeof coordinateSpace.windowId === 'number'
        ? { coordinateWindowId: coordinateSpace.windowId }
        : {}),
      ...(coordinateSpace.axRootId ? { coordinateAxRootId: coordinateSpace.axRootId } : {}),
      ...(coordinateSpace.capturedBounds
        ? {
            capturedX: coordinateSpace.capturedBounds.x,
            capturedY: coordinateSpace.capturedBounds.y,
            capturedWidth: coordinateSpace.capturedBounds.width,
            capturedHeight: coordinateSpace.capturedBounds.height,
          }
        : {}),
      ...(coordinateSpace.displayBounds
        ? {
            displayX: coordinateSpace.displayBounds.x,
            displayY: coordinateSpace.displayBounds.y,
            displayWidth: coordinateSpace.displayBounds.width,
            displayHeight: coordinateSpace.displayBounds.height,
          }
        : {}),
    }
  }
}

function boundsCenter(
  bounds: { x: number; y: number; width: number; height: number } | undefined,
): { x: number; y: number } | null {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  }
}
