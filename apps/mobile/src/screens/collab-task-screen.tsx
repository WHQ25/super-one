import { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { Button } from '../ui/primitives'
import { SCROLL_INDICATOR_GUTTER } from '../ui/scroll-gutter'
import { NativeMarkdown } from '../prompts/NativeMarkdown'
import { usePromptStyles } from '../prompts/styles'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'

export type CollabTaskScreenProps = {
  /** Resolves the brief. A launch that came with its task inline resolves at once. */
  load: () => Promise<string>
}

type TaskState = { kind: 'loading' } | { kind: 'ready'; task: string } | { kind: 'error'; message: string }

/**
 * The full brief of one launch, on its own page. The request itself ships only
 * the summary (see `taskDeferred`), so this page asks the host the first time
 * it opens; a retry stays on the page rather than bouncing back to the list.
 */
export function CollabTaskScreen({ load }: CollabTaskScreenProps) {
  const styles = usePromptStyles()
  const { tokens: { colors, spacing } } = useMobileTheme()
  const { t } = useMobileLocale()
  const [state, setState] = useState<TaskState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setState({ kind: 'loading' })
    load().then((task) => { if (active) setState({ kind: 'ready', task }) })
      .catch((cause: unknown) => {
        if (active) setState({ kind: 'error', message: cause instanceof Error ? cause.message : t('Could not load the task') })
      })
    return () => { active = false }
  }, [load, attempt])

  if (state.kind === 'loading') {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
      <ActivityIndicator color={colors.mutedForeground} />
      <Text style={styles.meta}>{t('Loading the task…')}</Text>
    </View>
  }
  if (state.kind === 'error') {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.lg }}>
      <Text accessibilityRole="alert" style={[styles.meta, { color: colors.destructive, textAlign: 'center' }]}>{state.message}</Text>
      <Button label={t('Try again')} onPress={() => setAttempt((value) => value + 1)} />
    </View>
  }
  return <ScrollView style={{ flex: 1 }}
    contentContainerStyle={{ paddingHorizontal: spacing.md, paddingVertical: spacing.md, paddingRight: SCROLL_INDICATOR_GUTTER }}>
    {state.task.trim()
      ? <NativeMarkdown content={state.task} />
      : <Text style={styles.meta}>{t('This launch has no task brief.')}</Text>}
  </ScrollView>
}
