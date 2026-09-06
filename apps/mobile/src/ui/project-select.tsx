import { useState } from 'react'
import { Check, ChevronDown, Folder } from 'lucide-react-native'
import { Pressable, ScrollView, View } from 'react-native'
import { Text } from './text'
import type { Project } from '../screens/projects-screen'
import { useMobileTheme } from '../theme/context'

/**
 * The Flutter shell's project picker: a bordered field that expands a list in
 * place rather than pushing a sheet, so the choice stays next to the prompt.
 */
export function ProjectSelect(props: {
  projects: Project[]
  activePath?: string
  onSelect: (project: Project) => void
  disabled?: boolean
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const [open, setOpen] = useState(false)
  const active = props.projects.find((project) => project.path === props.activePath)
  return (
    <View style={{ width: '100%', maxWidth: 320, gap: 4 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Project: ${active?.name ?? 'none'}`}
        accessibilityState={{ expanded: open, disabled: props.disabled }} disabled={props.disabled}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44,
          paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
          opacity: props.disabled ? 0.45 : 1, backgroundColor: pressed ? colors.muted : 'transparent' })}>
        <Folder size={18} color={colors.mutedForeground} />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '500', color: colors.foreground }}>
          {active?.name ?? 'No project'}
        </Text>
        <ChevronDown size={18} color={colors.mutedForeground} style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }} />
      </Pressable>
      {open ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, overflow: 'hidden' }}>
          <Text style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, fontSize: 11, color: colors.mutedForeground }}>
            Select project
          </Text>
          <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {props.projects.map((project) => {
              const selected = project.path === props.activePath
              return (
                <Pressable key={project.path} accessibilityRole="radio" accessibilityState={{ checked: selected }}
                  accessibilityLabel={project.name}
                  onPress={() => { setOpen(false); props.onSelect(project) }}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44,
                    paddingHorizontal: 12, backgroundColor: pressed || selected ? colors.muted : 'transparent' })}>
                  <Folder size={16} color={colors.mutedForeground} />
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: colors.foreground }}>{project.name}</Text>
                  {selected ? <Check size={16} color={colors.primary} /> : null}
                </Pressable>
              )
            })}
            {!props.projects.length ? (
              <Text style={{ padding: 12, fontSize: 13, color: colors.mutedForeground }}>
                Open a project in SuperOne desktop to find it here.
              </Text>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  )
}
