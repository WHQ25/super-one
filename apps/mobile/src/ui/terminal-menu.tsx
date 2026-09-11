import { Plus, SquareTerminal, X } from 'lucide-react-native'
import { Pressable } from 'react-native'
import type { TerminalTabUi } from '../terminal-runtime'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'
import { MenuRow, MenuSeparator } from './anchored-menu'
import { Text } from './text'

export function TerminalMenuBody(props: {
  tabs: TerminalTabUi[]
  activeId: string
  onSelect: (terminalId: string) => void
  onCreate: () => void
  onClose: (terminalId: string) => void
}) {
  const { tokens } = useMobileTheme()
  const { t } = useMobileLocale()
  return (
    <>
      {props.tabs.map((tab) => {
        const label = tab.title || t('Terminal')
        const active = tab.terminalId === props.activeId
        return (
          <MenuRow
            key={tab.terminalId}
            label={label}
            selected={active}
            showCheck={false}
            leading={<SquareTerminal size={18} color={active ? tokens.colors.foreground : tokens.colors.mutedForeground} />}
            labelNode={
              <Text numberOfLines={1} style={{
                color: tokens.colors.foreground,
                fontSize: 13,
                fontWeight: '500',
                opacity: tab.status === 'exited' ? 0.55 : 1,
              }}>
                {label}
              </Text>
            }
            onPress={() => props.onSelect(tab.terminalId)}
            accessory={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t('Close terminal')} ${label}`}
                hitSlop={8}
                onPress={() => props.onClose(tab.terminalId)}
                style={({ pressed }) => ({
                  width: 32,
                  height: 32,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.5 : 1,
                })}
              >
                <X size={15} color={tokens.colors.mutedForeground} strokeWidth={2} />
              </Pressable>
            }
          />
        )
      })}
      {props.tabs.length > 0 ? <MenuSeparator /> : null}
      <MenuRow
        label="New terminal"
        leading={<Plus size={18} color={tokens.colors.mutedForeground} />}
        onPress={props.onCreate}
      />
    </>
  )
}
