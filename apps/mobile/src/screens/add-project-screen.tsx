import { Pressable, View } from 'react-native'
import { Check, Github, Link2 } from 'lucide-react-native'
import { Text } from '../ui/text'
import { githubOwnerAvatarUrl, parseGitHubRepoInput } from '@superone/shared/git-remote'
import { ADD_PROJECT_TEXT } from '../add-project-state'
import type { AddProjectFlow } from '../navigation/use-add-project'
import { useMobileTheme } from '../theme/context'
import { BrowsePage } from '../ui/browse-page'
import { RepoOwnerAvatar } from '../ui/repo-owner-avatar'

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
 * reference on the GitHub / Git URL steps. `BrowsePage` owns that field and the
 * list — the additional-folders page browses through the same component — and
 * what is left here is the one thing only cloning has: the destination preview.
 * The header supplies back and the confirm action the dialog spends ⇧↵ on.
 */
export function AddProjectScreen(props: { flow: AddProjectFlow }) {
  const { tokens: { colors } } = useMobileTheme()
  const flow = props.flow
  const isPathStep = flow.step.kind === 'browse' || flow.step.kind === 'destination'
  const preview = flow.clonePreview
  const repoRef = preview && flow.step.kind === 'destination' && flow.step.source === 'github'
    ? parseGitHubRepoInput(preview.repoLabel)
    : null

  return (
    <BrowsePage
      query={flow.query}
      onQuery={flow.setQuery}
      placeholder={flow.placeholder}
      monospace={isPathStep}
      sections={flow.sections}
      onActivate={flow.activate}
      loading={flow.loading}
      loadingLabel={ADD_PROJECT_TEXT.loading}
      emptyMessage={flow.emptyMessage}
      busy={flow.busy}
      busyLabel={flow.step.kind === 'destination' ? ADD_PROJECT_TEXT.cloning : ADD_PROJECT_TEXT.loading}
      error={flow.error}
      header={preview ? (
        <View style={{ gap: 6, paddingHorizontal: 12, paddingVertical: 10,
          borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text style={{ fontSize: 12, fontWeight: '500', color: colors.mutedForeground }}>
            {ADD_PROJECT_TEXT.repository}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {repoRef
              ? <RepoOwnerAvatar owner={repoRef.owner} uri={githubOwnerAvatarUrl(repoRef.owner, 80)} />
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
    />
  )
}
