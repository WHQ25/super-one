import { useEffect, useState } from 'react'
import { Folder, FolderPlus, Github, Link2, Search, Star, User } from 'lucide-react-native'
import { Image, Pressable, View } from 'react-native'
import { Text } from './text'
import type { AddProjectRow, AddProjectRowIcon, AddProjectSectionModel } from '../add-project-state'
import { useMobileTheme } from '../theme/context'

const ROW_ICONS: Record<AddProjectRowIcon, typeof Folder> = {
  local: FolderPlus,
  github: Github,
  url: Link2,
  directory: Folder,
  create: FolderPlus,
}

/** `1.2k` / `24.5k`, matching the desktop star formatter. */
function formatStars(stars: number): string {
  if (stars < 1000) return String(stars)
  const thousands = stars / 1000
  return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`
}

function SearchingEllipsis() {
  const [dots, setDots] = useState(1)
  useEffect(() => {
    const id = setInterval(() => setDots((n) => (n % 3) + 1), 400)
    return () => clearInterval(id)
  }, [])
  return <Text>{'.'.repeat(dots)}</Text>
}

/**
 * Fuzzy-match highlight. The surrounding row carries the plain label as its
 * accessibility label, so splitting the visible text into spans stays invisible
 * to assistive tech and to snapshot queries.
 */
function Highlighted(props: { text: string; indices?: number[]; color: string }) {
  if (!props.indices?.length) return <>{props.text}</>
  const hit = new Set(props.indices)
  return (
    <>
      {Array.from(props.text).map((char, index) => (
        hit.has(index)
          ? <Text key={index} style={{ color: props.color, fontWeight: '600' }}>{char}</Text>
          : <Text key={index}>{char}</Text>
      ))}
    </>
  )
}

/**
 * The desktop `AddProjectList`: grouped rows with a counted section header.
 * Row shape follows the same three cases — a wrapped create-path row, a
 * two-line row (sources, repositories), and a single line with a trailing hint.
 */
export function AddProjectList(props: {
  sections: AddProjectSectionModel[]
  onActivate: (row: AddProjectRow) => void
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  return (
    <View>
      {props.sections.map((section) => {
        const SectionIcon = section.icon === 'search' ? Search : section.icon === 'user' ? User : null
        return (
          <View key={section.key}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 }}>
              {SectionIcon ? <SectionIcon size={12} color={colors.mutedForeground} /> : null}
              <Text style={{ fontSize: 12, fontWeight: '500', color: colors.mutedForeground }}>
                {section.label}
                {section.searching ? <SearchingEllipsis /> : null}
              </Text>
              {section.searching ? null : (
                <Text style={{ fontSize: 12, color: colors.mutedForeground, opacity: 0.6 }}>
                  · {section.rows.length}
                </Text>
              )}
            </View>
            {section.rows.map((row) => {
              const RowIcon = ROW_ICONS[row.icon]
              const iconSize = row.prominent ? 18 : 16
              return (
                <Pressable key={row.key} accessibilityRole="button" accessibilityLabel={row.label}
                  onPress={() => props.onActivate(row)}
                  style={({ pressed }) => ({
                    flexDirection: 'row', gap: 10, minHeight: 44, paddingHorizontal: 12,
                    paddingVertical: row.prominent ? 8 : 6, borderRadius: radius.sm,
                    alignItems: row.wrapLabel ? 'flex-start' : 'center',
                    backgroundColor: pressed ? colors.muted : 'transparent',
                  })}>
                  {row.avatarUrl
                    ? <Image source={{ uri: row.avatarUrl }}
                      style={{ width: 32, height: 32, borderRadius: radius.sm }} />
                    : <View style={{ width: 32, alignItems: 'center' }}>
                      <RowIcon size={iconSize} color={colors.mutedForeground} />
                    </View>}
                  {row.wrapLabel ? (
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text style={{ fontSize: 13, fontWeight: '500', color: colors.foreground }}>{row.label}</Text>
                      {row.hint ? <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{row.hint}</Text> : null}
                    </View>
                  ) : row.subtitle != null || row.stars != null ? (
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text numberOfLines={1} style={{ flexShrink: 1, minWidth: 0, fontSize: 14,
                          fontWeight: '500', color: colors.foreground }}>
                          <Highlighted text={row.label} indices={row.matchIndices} color={colors.primary} />
                        </Text>
                        {row.stars != null ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 'auto' }}>
                            <Star size={12} color={colors.mutedForeground} />
                            <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{formatStars(row.stars)}</Text>
                          </View>
                        ) : null}
                      </View>
                      {row.subtitle ? (
                        <Text numberOfLines={1} style={{ fontSize: 11, color: colors.mutedForeground }}>
                          {row.subtitle}
                        </Text>
                      ) : null}
                    </View>
                  ) : (
                    <>
                      <Text numberOfLines={1} style={{ flexShrink: 1, minWidth: 0, fontSize: 14,
                        fontWeight: '500', color: colors.foreground }}>
                        <Highlighted text={row.label} indices={row.matchIndices} color={colors.primary} />
                      </Text>
                      {row.hint ? (
                        <Text numberOfLines={1} style={{ flex: 1, textAlign: 'right', fontSize: 11,
                          color: colors.mutedForeground }}>{row.hint}</Text>
                      ) : null}
                    </>
                  )}
                </Pressable>
              )
            })}
          </View>
        )
      })}
    </View>
  )
}
