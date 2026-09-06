import { createContext, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { View } from 'react-native'
import type { AnchorRect } from './popover-layout'

type MenuHostApi = {
  show: (id: string, node: ReactNode) => void
  hide: (id: string) => void
  measure: (ref: RefObject<View | null>, done: (rect: AnchorRect) => void) => void
}
const Context = createContext<MenuHostApi | null>(null)

/** A same-window portal preserves the native editor's keyboard and focus. Each
 * native Modal gets its own host so its menus stay above that modal's content. */
export function MenuHost({ children }: { children: ReactNode }) {
  const root = useRef<View>(null)
  const [entry, setEntry] = useState<{ id: string; node: ReactNode } | null>(null)
  const api = useMemo<MenuHostApi>(() => ({
    show: (id, node) => setEntry({ id, node }),
    hide: (id) => setEntry((current) => current?.id === id ? null : current),
    measure: (ref, done) => root.current?.measureInWindow((rootX, rootY) => {
      ref.current?.measureInWindow((x, y, width, height) => {
        if (width > 0 && height > 0) done({ x: x - rootX, y: y - rootY, width, height })
      })
    }),
  }), [])
  return <Context.Provider value={api}>
    <View ref={root} collapsable={false} style={{ flex: 1 }}>
      <View collapsable={false} style={{ flex: 1 }} accessibilityElementsHidden={!!entry} importantForAccessibility={entry ? 'no-hide-descendants' : 'auto'}>{children}</View>
      {entry?.node}
    </View>
  </Context.Provider>
}

export function useMenuHost() {
  const host = useContext(Context)
  if (!host) throw new Error('Menus require a MenuHost in the same native window')
  return host
}
