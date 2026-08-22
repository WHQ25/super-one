/**
 * A pointer gesture, collected until it can be sent.
 *
 * The other two providers take a live contact stream: the simulator's helper speaks
 * HID, and scrcpy has an `INJECT_TOUCH_EVENT` per sample, so a finger moving on screen
 * is a hundred small messages and the device sees the drag as it happens.
 *
 * The mirroring window has neither. What reaches it is a synthetic mouse, and the
 * helper's vocabulary for one is whole gestures — a click, or a drag along a path. So
 * a gesture cannot be forwarded while it is in progress; it has to be accumulated and
 * sent when the finger lifts.
 *
 * The visible cost is real and worth stating: a drag on a mirrored iPhone lands at the
 * END of the drag, so there is no rubber-banding under the cursor while it happens.
 * Closing that gap means teaching the helper mouse-down / move / up as separate verbs,
 * which is also what unattended background injection would need — the two belong in
 * the same piece of work.
 *
 * Multi-touch is not accumulated at all. A mouse has one pointer; a pinch has two, and
 * there is nothing to send it down. The first contact is followed and the rest are
 * ignored rather than being flattened into a gesture the user did not make.
 */

import type { DeviceTouchContact } from '@superone/shared/device'

export interface MirrorGesture {
  /** Framebuffer ratios, in the order they were sampled. One point means a tap. */
  path: Array<{ xRatio: number; yRatio: number }>
}

/** Two samples closer than this are the same point as far as a phone is concerned. */
const MIN_STEP = 0.002

export class MirrorTouchTrack {
  private readonly path: Array<{ xRatio: number; yRatio: number }> = []
  private contactId: number | null = null

  /**
   * Take one batch of contacts. Returns the gesture when the finger has lifted.
   *
   * Null while the gesture is still in progress, which is most calls — a pointer
   * produces these many times a second.
   */
  absorb(contacts: readonly DeviceTouchContact[]): MirrorGesture | null {
    // Only the first contact, and only for as long as it lasts. A second finger
    // arriving mid-gesture is dropped rather than allowed to redirect the one being
    // tracked, which is what a naive "last contact wins" would do to a pinch.
    const contact = this.contactId === null
      ? contacts[0]
      : contacts.find((entry) => entry.id === this.contactId) ?? contacts[0]
    if (!contact) return null

    if (this.contactId === null || contact.id !== this.contactId) {
      this.contactId = contact.id
      this.path.length = 0
    }

    if (contact.phase !== 'ended' && contact.phase !== 'cancelled') {
      this.push(contact)
      return null
    }

    // The lift itself is part of the path: a flick's direction and speed come from
    // where it finished, and dropping the last sample shortens every swipe.
    this.push(contact)
    const gesture: MirrorGesture = { path: [...this.path] }
    this.reset()
    return contact.phase === 'cancelled' ? null : gesture
  }

  reset(): void {
    this.path.length = 0
    this.contactId = null
  }

  private push(contact: DeviceTouchContact): void {
    const last = this.path.at(-1)
    // Thinned as it arrives rather than at the end. A pointer emits samples far
    // denser than a phone can use, and the helper walks every point it is given.
    if (last
      && Math.abs(last.xRatio - contact.xRatio) < MIN_STEP
      && Math.abs(last.yRatio - contact.yRatio) < MIN_STEP) return
    this.path.push({ xRatio: contact.xRatio, yRatio: contact.yRatio })
  }
}
