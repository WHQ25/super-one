import { create } from 'zustand'
interface Slot { bounds: DOMRectReadOnly; visible: boolean }
interface McpAppLayoutState {
  slots: Record<string, Slot | undefined>
  owners: Record<string, (() => void) | undefined>
  updateSlot(key: string, slot?: Slot): void
  own(key: string, inline: () => void): () => void
}
/** Ephemeral geometry only. The owning chat View keeps the document, binding and bridge. */
export const useMcpAppLayout = create<McpAppLayoutState>((set, get) => ({
  slots: {}, owners: {},
  updateSlot(key, slot) { set(state => { const slots = { ...state.slots }; if (slot) slots[key] = slot; else delete slots[key]; return { slots } }) },
  own(key, inline) {
    set(state => ({ owners: { ...state.owners, [key]: inline } }))
    return () => { if (get().owners[key] !== inline) return; set(state => { const owners = { ...state.owners }; delete owners[key]; return { owners } }) }
  },
}))
