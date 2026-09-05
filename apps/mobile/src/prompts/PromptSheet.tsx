import { useRef, type ReactNode } from 'react'
import { Animated, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X, type LucideIcon } from 'lucide-react-native'
import { useMobileTheme } from '../theme/context'

/** Native interaction shell: bounded body, persistent actions, and keyboard-safe layout. */
export function PromptSheet({ title, subtitle, icon: Icon, children, footer, onDismiss, spacious = false }: {
  title: string; subtitle?: string; icon: LucideIcon; children: ReactNode; footer: ReactNode
  onDismiss: () => void; spacious?: boolean
}) {
  const { tokens: { colors, radius, spacing } } = useMobileTheme()
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const tablet = width >= 768
  const offset = useRef(new Animated.Value(0)).current
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 8 && Math.abs(gesture.dx) < gesture.dy,
    onPanResponderMove: (_, gesture) => offset.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy > 64) dismiss.current()
      Animated.spring(offset, { toValue: 0, useNativeDriver: true }).start()
    },
    onPanResponderTerminate: () => Animated.spring(offset, { toValue: 0, useNativeDriver: true }).start(),
  })).current
  return (
    <Modal supportedOrientations={['portrait', 'portrait-upside-down', 'landscape-left', 'landscape-right']} transparent visible animationType="slide" presentationStyle="overFullScreen" statusBarTranslucent navigationBarTranslucent onRequestClose={onDismiss}>
      <View style={{ flex: 1, backgroundColor: colors.scrim }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss dialog" onPress={onDismiss} style={StyleSheet.absoluteFill} />
        <KeyboardAvoidingView pointerEvents="box-none" behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, paddingTop: insets.top + spacing.sm, paddingHorizontal: tablet ? spacing.lg : 0, paddingBottom: tablet ? insets.bottom + spacing.lg : 0, justifyContent: tablet ? 'center' : 'flex-end', alignItems: 'center' }}>
          <Animated.View accessibilityViewIsModal onAccessibilityEscape={onDismiss} style={{ width: '100%', maxWidth: tablet ? 620 : undefined, maxHeight: '100%', height: spacious ? '92%' : undefined, flexShrink: 1, backgroundColor: colors.elevated, borderTopLeftRadius: radius.lg + 4, borderTopRightRadius: radius.lg + 4, borderBottomLeftRadius: tablet ? radius.lg : 0, borderBottomRightRadius: tablet ? radius.lg : 0, overflow: 'hidden', transform: [{ translateY: offset }] }}>
            {!tablet ? <View {...pan.panHandlers} style={{ paddingTop: 10, paddingBottom: 4, alignItems: 'center' }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
            </View> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: spacing.lg, paddingRight: 6, paddingVertical: tablet ? 8 : 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
              <Icon size={16} color={colors.mutedForeground} />
              <View style={{ flex: 1, minWidth: 0, paddingVertical: 6 }}>
                <Text testID="prompt-title" style={{ color: colors.foreground, fontSize: 14, lineHeight: 20, fontWeight: '600' }}>{title}</Text>
                {subtitle ? <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 18 }}>{subtitle}</Text> : null}
              </View>
              <Pressable accessibilityRole="button" testID="prompt-close" accessibilityLabel="Close dialog" onPress={onDismiss} style={{ minHeight: 44, width: 44, alignItems: 'center', justifyContent: 'center' }}>
                <X size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets={false} style={{ flexShrink: 1, flexGrow: spacious ? 1 : 0 }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              {children}
            </ScrollView>
            <View style={{ flexShrink: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: tablet ? spacing.md : Math.max(insets.bottom, spacing.md) }}>
              {footer}
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}
