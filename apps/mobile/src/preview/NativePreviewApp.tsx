import { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Keyboard, Linking, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native'
import { Text } from '../ui/text'
import { SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import type { HarnessId } from '@superone/shared/agent-types'
import { HARNESS_DEFAULT_BRAND_HUE } from '@superone/shared/harness-brand'
import { PermissionSheet, PlanSheet, QuestionSheet } from '../sheets'
import { MobileThemeProvider, useMobileTheme } from '../theme/context'
import type { MobileColorScheme } from '../theme/tokens'
import { Button, Chip, ListRow } from '../ui'
import { parsePreviewRoute, type PreviewRoute, type ShellPreviewPage } from './preview-route'
import { nativeScenarios, type NativeScenario } from './scenarios'
import { ShellPreview } from './ShellPreview'

type ThemeChoice = 'system' | MobileColorScheme
const categories = ['All', 'Permissions', 'Questions', 'Plans'] as const
const harnesses = Object.keys(HARNESS_DEFAULT_BRAND_HUE) as HarnessId[]

export default function NativePreviewApp() {
  const [theme, setTheme] = useState<ThemeChoice>('system')
  const [route, setRoute] = useState<PreviewRoute | null>(null)
  useEffect(() => {
    let active = true
    const navigate = (url: string | null) => {
      const next = url ? parsePreviewRoute(url) : null
      if (!active || !next) return
      setTheme(next.theme)
      setRoute((current) => ({ ...next, revision: (current?.revision ?? 0) + 1 }))
    }
    const subscription = Linking.addEventListener('url', ({ url }) => navigate(url))
    Linking.getInitialURL().then(navigate).catch(() => {})
    return () => { active = false; subscription.remove() }
  }, [])
  return (
    <MobileThemeProvider colorScheme={theme === 'system' ? undefined : theme}>
      <NativeCatalog theme={theme} onTheme={setTheme} route={route} />
    </MobileThemeProvider>
  )
}

function NativeCatalog({ theme, onTheme, route }: { theme: ThemeChoice; onTheme: (theme: ThemeChoice) => void; route: PreviewRoute | null }) {
  const { tokens, setHarness } = useMobileTheme()
  const { width, height, fontScale } = useWindowDimensions()
  const [harness, selectHarness] = useState<HarnessId>('claude')
  const [category, setCategory] = useState<typeof categories[number]>('All')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<NativeScenario | null>(null)
  const [visible, setVisible] = useState(false)
  const [revision, setRevision] = useState(0)
  const [actions, setActions] = useState<string[]>([])
  const [shellPreview, setShellPreview] = useState<ShellPreviewPage | null>(null)
  const list = useRef<FlatList<NativeScenario>>(null)
  useEffect(() => {
    if (!route) return
    Keyboard.dismiss()
    setHarness(route.harness); selectHarness(route.harness)
    if (route.kind === 'shell') {
      setShellPreview(route.page)
      return
    }
    setShellPreview(null)
    setCategory('All'); setSearch(route.scenario.id); setActions([])
    setSelected(route.scenario); setRevision((value) => value + 1); setVisible(true)
    list.current?.scrollToOffset({ offset: 0, animated: false })
  }, [route, setHarness])
  const styles = useMemo(() => {
    const { colors, spacing, radius, type } = tokens
    return StyleSheet.create({
      root: { flex: 1, backgroundColor: colors.background },
      content: { padding: spacing.lg, gap: spacing.md },
      title: { color: colors.foreground, fontSize: type.display, fontWeight: '700' },
      text: { color: colors.foreground, fontSize: type.body },
      meta: { color: colors.mutedForeground, fontSize: type.meta },
      section: { gap: spacing.sm },
      chips: { gap: spacing.sm, alignItems: 'center' },
      input: { color: colors.foreground, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, fontSize: type.body },
      card: { padding: spacing.md, gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface },
      log: { maxHeight: 160 },
    })
  }, [tokens])
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return nativeScenarios.filter((scenario) => (category === 'All' || scenario.category === category)
      && `${scenario.id} ${scenario.title} ${scenario.description}`.toLowerCase().includes(query))
  }, [category, search])

  const open = (scenario: NativeScenario) => {
    Keyboard.dismiss()
    setSelected(scenario)
    setRevision((value) => value + 1)
    setVisible(true)
  }
  const record = (action: string, payload: unknown) => {
    setActions((current) => [JSON.stringify({ scenario: selected?.id, action, payload }, null, 2), ...current].slice(0, 10))
    setVisible(false)
    Keyboard.dismiss()
    list.current?.scrollToOffset({ offset: 0, animated: false })
  }

  if (shellPreview) return <ShellPreview key={route?.kind === 'shell' ? route.revision : 'manual'} initialPage={shellPreview} onClose={() => setShellPreview(null)} onTheme={() => onTheme(tokens.scheme === 'dark' ? 'light' : 'dark')} />
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style={tokens.scheme === 'dark' ? 'light' : 'dark'} />
      <FlatList
        ref={list}
        data={filtered}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        ListHeaderComponent={<View style={styles.section}>
          <Text testID="native-preview-ready" style={styles.title}>Native preview</Text>
          <Text style={styles.meta}>Offline fixtures · production components · {nativeScenarios.length} scenarios</Text>
          <Text style={styles.meta}>{Math.round(width)} × {Math.round(height)} · font scale {fontScale.toFixed(2)}</Text>
          <Button label="Preview app screens" variant="secondary" onPress={() => setShellPreview('New session')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {(['system', 'light', 'dark'] as const).map((value) => <Chip key={value} label={value} selected={theme === value} onPress={() => onTheme(value)} />)}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {harnesses.map((value) => <Chip key={value} label={value} selected={harness === value} onPress={() => { selectHarness(value); setHarness(value) }} />)}
          </ScrollView>
          <TextInput accessibilityLabel="Search native scenarios" placeholder="Search scenarios or request kind" placeholderTextColor={tokens.colors.mutedForeground} value={search} onChangeText={setSearch} style={styles.input} autoCapitalize="none" autoCorrect={false} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {categories.map((value) => <Chip key={value} label={value} selected={category === value} onPress={() => setCategory(value)} />)}
          </ScrollView>
          {selected ? <View style={styles.card}>
            <Text selectable style={styles.text}>{selected.title}</Text>
            <Text selectable style={styles.meta}>{selected.id}</Text>
            <Text style={styles.meta}>{selected.description}</Text>
            <Button label="Reset and reopen" variant="secondary" onPress={() => open(selected)} />
          </View> : null}
          {actions.length ? <View style={styles.card}>
            <Text style={styles.text}>Actions ({actions.length})</Text>
            <ScrollView nestedScrollEnabled style={styles.log}>
              {actions.map((action, index) => <Text key={index} testID={index === 0 ? "preview-last-action" : undefined} accessibilityLabel={action} selectable style={styles.meta}>{action}{'\n\n'}</Text>)}
            </ScrollView>
            <Button label="Clear actions" variant="ghost" onPress={() => setActions([])} />
          </View> : null}
          <Text style={styles.meta}>{filtered.length} matching scenarios</Text>
        </View>}
        renderItem={({ item }) => <ListRow title={item.title} subtitle={`${item.category} · ${item.description}`} selected={selected?.id === item.id} onPress={() => open(item)} />}
        ListEmptyComponent={<Text style={styles.meta}>No matching scenarios. Try another search or category.</Text>}
      />
      {visible && selected?.category === 'Permissions' ? <PermissionSheet
        key={revision} perm={selected.request}
        loadSystemInfo={async () => ({ models: [{ id: 'Preview model', name: 'Preview model', description: 'Offline preview model' }, { id: 'Review model', name: 'Review model', description: 'Offline review model' }], efforts: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }] })}
        onAllow={(id, formAnswers, alwaysAllow, selectedSuggestions) => record('allow', { id, formAnswers, alwaysAllow, selectedSuggestions })}
        onDeny={(id, reason) => record('deny', { id, reason })}
      /> : null}
      {visible && selected?.category === 'Questions' ? <QuestionSheet
        key={revision} question={selected.request}
        onSubmit={(id, answers, annotations) => record('submit', { id, answers, annotations })}
        onDismiss={(id) => record('dismiss', { id })}
      /> : null}
      {visible && selected?.category === 'Plans' ? <PlanSheet
        key={revision} plan={selected.request} continueMode={selected.continueMode}
        onApprove={(id) => record('approve', { id })}
        onApproveAndContinue={(id, mode) => record('approve-and-continue', { id, mode })}
        onReject={(id, feedback) => record('reject', { id, feedback })}
      /> : null}
    </SafeAreaView>
  )
}
