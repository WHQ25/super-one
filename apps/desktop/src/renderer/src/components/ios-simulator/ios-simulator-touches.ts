import type { IosSimulatorTouchContact, IosSimulatorTouchPhase } from '@superone/shared/ios-simulator'
import { IOS_SIMULATOR_MAX_TOUCH_CONTACTS } from '@superone/shared/ios-simulator'
import type { NormalizedFramePoint } from './ios-simulator-input'

export interface PointerTouchSample extends NormalizedFramePoint {
  pointerId: number
  pointerType: string
  altKey: boolean
}

interface TrackedPointer {
  contactId: number
  point: NormalizedFramePoint
  mirroredContactId?: number
}

function mirrored(point: NormalizedFramePoint): NormalizedFramePoint {
  return { xRatio: 1 - point.xRatio, yRatio: 1 - point.yRatio }
}

export class IosSimulatorTouchTracker {
  private readonly pointers = new Map<number, TrackedPointer>()
  private nextContactId = 1

  get pointerCount(): number { return this.pointers.size }
  get contactCount(): number {
    let count = 0
    for (const pointer of this.pointers.values()) count += pointer.mirroredContactId === undefined ? 1 : 2
    return count
  }

  begin(sample: PointerTouchSample): IosSimulatorTouchContact[] | null {
    if (this.pointers.has(sample.pointerId)) return null
    const mirrorWithOption = sample.pointerType === 'mouse' && sample.altKey && this.contactCount === 0
    const requiredContacts = mirrorWithOption ? 2 : 1
    if (this.contactCount + requiredContacts > IOS_SIMULATOR_MAX_TOUCH_CONTACTS) return null
    const pointer: TrackedPointer = {
      contactId: this.allocateContactId(),
      point: { xRatio: sample.xRatio, yRatio: sample.yRatio },
      ...(mirrorWithOption ? { mirroredContactId: this.allocateContactId() } : {}),
    }
    this.pointers.set(sample.pointerId, pointer)
    return this.snapshot(new Set(
      [pointer.contactId, pointer.mirroredContactId].filter((id): id is number => id !== undefined),
    ), 'began')
  }

  move(sample: PointerTouchSample): IosSimulatorTouchContact[] | null {
    const pointer = this.pointers.get(sample.pointerId)
    if (!pointer) return null
    pointer.point = { xRatio: sample.xRatio, yRatio: sample.yRatio }
    return this.snapshot(new Set(), 'moved')
  }

  end(pointerId: number, point: NormalizedFramePoint, phase: Extract<IosSimulatorTouchPhase, 'ended' | 'cancelled'>): IosSimulatorTouchContact[] | null {
    const pointer = this.pointers.get(pointerId)
    if (!pointer) return null
    pointer.point = point
    const ending = new Set(
      [pointer.contactId, pointer.mirroredContactId].filter((id): id is number => id !== undefined),
    )
    const contacts = this.snapshot(ending, phase)
    this.pointers.delete(pointerId)
    return contacts
  }

  clear(): boolean {
    if (this.pointers.size === 0) return false
    this.pointers.clear()
    return true
  }

  private snapshot(changed: Set<number>, changedPhase: IosSimulatorTouchPhase): IosSimulatorTouchContact[] {
    const contacts: IosSimulatorTouchContact[] = []
    for (const pointer of this.pointers.values()) {
      contacts.push({
        id: pointer.contactId,
        ...pointer.point,
        phase: changed.has(pointer.contactId) ? changedPhase : 'moved',
      })
      if (pointer.mirroredContactId !== undefined) {
        contacts.push({
          id: pointer.mirroredContactId,
          ...mirrored(pointer.point),
          phase: changed.has(pointer.mirroredContactId) ? changedPhase : 'moved',
        })
      }
    }
    return contacts
  }

  private allocateContactId(): number {
    const id = this.nextContactId
    this.nextContactId += 1
    return id
  }
}
