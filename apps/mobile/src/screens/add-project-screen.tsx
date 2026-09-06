import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native'
import { Check, Github, Link2, Search } from 'lucide-react-native'
import { Image } from 'react-native'
import { Text } from '../ui/text'
import { githubOwnerAvatarUrl, parseGitHubRepoInput } from '@superone/shared/git-remote'
import { ADD_PROJECT_TEXT } from '../add-project-state'
import type { AddProjectFlow } from '../navigation/use-add-project'
import { useMobileTheme } from '../theme/context'
import { AddProjectList } from '../ui/add-project-list'
import { SCROLL_INDICATOR_GUTTER } from '../ui/scroll-gutter'

/** Destination-step checkbox, in the dialog's own compact row shape. */
function CloneOption(props: { label: string; checked: boolean; onToggle: (value: boolean) => void }) {
  const { tokens: { colors } } = useMobileTheme()
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: props.checked }}
      accessibilityLabel={props.label} onPress={() => props.onToggle(!props.checked)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 }}>
      <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 4,
        borderWidth: 1, borderColor: props.checked ? colors.foreground : colors.mutedForeground,
        backgroundColor: props.checked ? colors.foreground : 'transparent' }}>
        {props.checked ? <Check size={12} color={colors.background} /> : null}
      </View>
      <Text style={{ flex: 1, fontSize: 13, color: colors.mutedForeground }}>{props.label}</Text>
    </Pressable>
  )
}

/**
 * The desktop Add Project dialog as a page.
 *
 * The single input carries every step: a path while browsing, a repository
 * reference on the GitHub / Git URL steps. The header supplies back and the
 * confirm action the dialog spends ⇧↵ on.
 */
export function AddProjectScreen(props: { flow: AddProjectFlow }) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const flow = props.flow
  const isPathStep = flow.step.kind === 'browse' || flow.step.kind === 'destination'
  const preview = flow.clonePreview
  const repoRef = preview && flow.step.kind === 'destination' && flow.step.source === 'github'
    ? parseGitHubRepoInput(preview.repoLabel)
    : null

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12,
        borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Search size={15} color={colors.mutedForeground} />
        <TextInput value={flow.query} onChangeText={flow.setQuery}
          accessibilityLabel={flow.placeholder}
          placeholder={flow.placeholder} placeholderTextColor={colors.mutedForeground}
          editable={!flow.busy} autoCapitalize="none" autoCorrect={false} spellCheck={false}
          style={{ flex: 1, minHeight: 44, fontSize: 14, color: colors.foreground,
            fontFamily: isPathStep ? 'Menlo' : undefined }} />
      </View>

      {preview ? (
        <View style={{ gap: 6, paddingHorizontal: 12, paddingVertical: 10,
          borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text style={{ fontSize: 12, fontWeight: '500', color: colors.mutedForeground }}>
            {ADD_PROJECT_TEXT.repository}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {repoRef
              ? <Image source={{ uri: githubOwnerAvatarUrl(repoRef.owner, 80) }}
                style={{ width: 32, height: 32, borderRadius: radius.sm }} />
              : <View style={{ width: 32, alignItems: 'center' }}>
                {flow.step.kind === 'destination' && flow.step.source === 'github'
                  ? <Github size={18} color={colors.mutedForeground} />
                  : <Link2 size={18} color={colors.mutedForeground} />}
              </View>}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 14, color: colors.foreground }}>
                {preview.repoLabel}
              </Text>
              <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: 'Menlo', color: colors.mutedForeground }}>
                {preview.remoteUrl}
              </Text>
            </View>
          </View>
          {preview.path ? (
            <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: 'Menlo', color: colors.mutedForeground }}>
              {ADD_PROJECT_TEXT.clonesInto.replace('{{path}}', preview.path)}
            </Text>
          ) : null}
          <CloneOption label={ADD_PROJECT_TEXT.shallowClone}
            checked={flow.shallowClone} onToggle={flow.setShallowClone} />
          <CloneOption label={ADD_PROJECT_TEXT.saveAsDefaultClonePath}
            checked={flow.saveAsDefault} onToggle={flow.setSaveAsDefault} />
        </View>
      ) : null}

      {flow.loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <ActivityIndicator color={colors.mutedForeground} />
          <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{ADD_PROJECT_TEXT.loading}</Text>
        </View>
      ) : flow.emptyMessage ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <Text style={{ fontSize: 12, textAlign: 'center', color: colors.mutedForeground }}>
            {flow.emptyMessage}
          </Text>
        </View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }}
          contentContainerStyle={{ paddingRight: SCROLL_INDICATOR_GUTTER, paddingBottom: 16 }}>
          <AddProjectList sections={flow.sections} onActivate={flow.activate} />
        </ScrollView>
      )}

      {flow.busy ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12,
          paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
          <ActivityIndicator size="small" color={colors.mutedForeground} />
          <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
            {flow.step.kind === 'destination' ? ADD_PROJECT_TEXT.cloning : ADD_PROJECT_TEXT.loading}
          </Text>
        </View>
      ) : null}
      {flow.error ? (
        <Text accessibilityRole="alert" style={{ paddingHorizontal: 12, paddingVertical: 8, fontSize: 12,
          borderTopWidth: 1, borderTopColor: colors.border, color: colors.destructive }}>
          {flow.error}
        </Text>
      ) : null}
    </View>
  )
}
