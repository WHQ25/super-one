import type { CapabilityTier, GrantScope, GrantedApp } from './types'
import { ComputerUseError } from './types'

/**
 * Authorization for Computer Use.
 *
 * Two durable scopes:
 * - session: in-memory for this chat session only
 * - always: synced from AppSettings.computerUseAlwaysAllowApps
 *
 * Helper receives only resolved policy — never infers grants from tool arguments.
 */
export class ComputerUsePolicy {
  private enabled = false
  /** Settings flag: skip per-app allowlist (temporary testing). */
  private allowAllApps = false
  private readonly sessionGrants = new Map<string, GrantedApp>()
  private readonly alwaysGrants = new Map<string, GrantedApp>()
  private clipboardGrant = false

  isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  isAllowAllApps(): boolean {
    return this.allowAllApps
  }

  setAllowAllApps(allowAll: boolean): void {
    this.allowAllApps = allowAll
  }

  /** Replace persistent always-allow list (from AppSettings). */
  setAlwaysAllowApps(apps: Array<{ app: string; bundleId: string; tier?: CapabilityTier }>): void {
    this.alwaysGrants.clear()
    for (const a of apps) {
      if (!a.bundleId) continue
      this.alwaysGrants.set(a.bundleId, {
        app: a.app || a.bundleId,
        bundleId: a.bundleId,
        tier: a.tier ?? 'full',
        scope: 'always',
      })
    }
  }

  /** Session-scoped grant (Allow this session). */
  grantSession(app: GrantedApp): void {
    this.sessionGrants.set(app.bundleId, {
      ...app,
      scope: 'session',
    })
  }

  /**
   * @deprecated Prefer grantSession / setAlwaysAllowApps. Kept for tests that call grant().
   * Treats as session grant.
   */
  grant(app: GrantedApp): void {
    this.grantSession(app)
  }

  revoke(bundleId: string): void {
    this.sessionGrants.delete(bundleId)
  }

  /** Drop session grants only (always-allow stays until settings change). */
  clearSessionGrants(): void {
    this.sessionGrants.clear()
    this.clipboardGrant = false
  }

  clearGrants(): void {
    this.sessionGrants.clear()
    this.alwaysGrants.clear()
    this.clipboardGrant = false
  }

  setClipboardGrant(granted: boolean): void {
    this.clipboardGrant = granted
  }

  hasClipboardGrant(): boolean {
    return this.clipboardGrant
  }

  listGranted(): GrantedApp[] {
    if (this.allowAllApps) {
      return [{ app: '*', bundleId: '*', tier: 'full' }, ...this.mergeGranted()]
    }
    return this.mergeGranted()
  }

  /** True if app is allowed (allow-all, always, or session). */
  isGranted(bundleId: string): boolean {
    if (this.allowAllApps) return true
    return this.tierFor(bundleId) !== null
  }

  tierFor(bundleId: string): CapabilityTier | null {
    if (this.allowAllApps) return 'full'
    // Always-allow wins over session for display; same effective tier for v1.
    const always = this.alwaysGrants.get(bundleId)
    if (always) return always.tier
    return this.sessionGrants.get(bundleId)?.tier ?? null
  }

  scopeFor(bundleId: string): GrantScope | null {
    if (this.alwaysGrants.has(bundleId)) return 'always'
    if (this.sessionGrants.has(bundleId)) return 'session'
    return null
  }

  assertEnabled(): void {
    if (!this.enabled) {
      throw new ComputerUseError(
        'BACKEND',
        'Computer Use is disabled. Enable it in Settings before calling computer_* tools.',
      )
    }
  }

  assertGranted(bundleId: string): CapabilityTier {
    if (this.allowAllApps) return 'full'
    const tier = this.tierFor(bundleId)
    if (!tier) {
      throw new ComputerUseError(
        'NOT_GRANTED',
        `App ${bundleId} is not allowed for Computer Use. The user must grant access (this session or always allow) when prompted.`,
        { bundleId },
      )
    }
    return tier
  }

  /**
   * Tier gates for mutation kinds.
   * read  → no input
   * click → pointer only (no type/key/right-click/drag)
   * full  → all
   */
  assertActionAllowed(
    bundleId: string,
    actionType: string,
  ): void {
    const tier = this.assertGranted(bundleId)
    if (tier === 'full') return
    if (tier === 'read') {
      throw new ComputerUseError(
        'TIER_BLOCKED',
        `Tier "read" blocks all input actions on ${bundleId}`,
        { bundleId, tier, actionType },
      )
    }
    // click
    const blocked = new Set([
      'setText',
      'typeText',
      'keypress',
      'drag',
    ])
    if (blocked.has(actionType)) {
      throw new ComputerUseError(
        'TIER_BLOCKED',
        `Tier "click" blocks ${actionType} on ${bundleId}`,
        { bundleId, tier, actionType },
      )
    }
    if (actionType === 'click') {
      // right-click blocked at call site when button === 'right'
    }
  }

  assertClickButton(bundleId: string, button: 'left' | 'right' = 'left'): void {
    const tier = this.assertGranted(bundleId)
    if (tier === 'read') {
      throw new ComputerUseError('TIER_BLOCKED', `Tier "read" blocks click on ${bundleId}`)
    }
    if (tier === 'click' && button === 'right') {
      throw new ComputerUseError(
        'TIER_BLOCKED',
        `Tier "click" blocks right-click (context menu may paste) on ${bundleId}`,
        { bundleId, tier },
      )
    }
  }

  private mergeGranted(): GrantedApp[] {
    const out = new Map<string, GrantedApp>()
    for (const g of this.alwaysGrants.values()) {
      out.set(g.bundleId, { ...g, scope: 'always' })
    }
    for (const g of this.sessionGrants.values()) {
      if (!out.has(g.bundleId)) {
        out.set(g.bundleId, { ...g, scope: 'session' })
      }
    }
    return [...out.values()]
  }
}
