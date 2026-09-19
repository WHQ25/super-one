import type { DeviceUiNode } from '@superone/shared/device-agent'
import type { DeviceImage, DeviceObservation, ObserveOptions, PerformContext, ResolvedAction, TouchDeviceBackend } from './types'

export class FakeDeviceBackend implements TouchDeviceBackend {
  readonly label = 'Fake Phone'
  readonly performed: ResolvedAction[] = []
  /** Every observation this backend has handed out, newest last. */
  readonly observations: DeviceObservation[] = []
  /** Which observation each performed action was addressed through. */
  readonly addressed: Array<DeviceObservation | undefined> = []
  /** Each observe() consumes the next screen, repeating the last one forever. */
  private index = 0

  constructor(
    private readonly screens: DeviceUiNode[],
    readonly settled = true,
    /** Same hash on every observation: the pixels did not move, only the tree did. */
    private readonly frameHash?: string,
    /** Where this backend says it wrote the screenshot. */
    private readonly capturePath = '/tmp/shot.png',
  ) {}

  async observe(_options?: ObserveOptions): Promise<DeviceObservation> {
    const root = this.screens[Math.min(this.index++, this.screens.length - 1)]!
    const observation: DeviceObservation = {
      root,
      orientation: 'portrait',
      screen: { width: 1320, height: 2868 },
      settled: this.settled,
      ...(this.frameHash ? { frameHash: this.frameHash } : {}),
    }
    this.observations.push(observation)
    return observation
  }

  async capture(): Promise<DeviceImage> {
    return { path: this.capturePath, width: 1320, height: 2868 }
  }

  async perform(action: ResolvedAction, context?: PerformContext): Promise<void> {
    this.performed.push(action)
    this.addressed.push(context?.observation)
    this.performedAt.push(Date.now())
  }

  /** When each action reached the backend, so a settle between two is observable. */
  readonly performedAt: number[] = []
}
