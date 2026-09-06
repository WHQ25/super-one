import { useMemo } from 'react'
import { FolderPlus } from 'lucide-react-native'
import { Text } from '../ui/text'
import { useMobileTheme } from '../theme/context'
import { PromptSheet } from './PromptSheet'
import { PromptActions, PromptInput } from './PromptControls'

/**
 * Name a folder to create inside the one on screen.
 *
 * There is deliberately no "go to path" twin: search already takes the user to a
 * folder anywhere under the root, without a keyboard and without knowing the
 * spelling — a typed path would be a second, worse way to do the same thing.
 */
export function NewFolderSheet(props: {
  /** Folder the new one lands in, shown so the user knows where they are. */
  parent: string
  value: string
  error?: string
  onChange: (value: string) => void
  onSubmit: () => void
  onDismiss: () => void
}) {
  const { tokens: { colors } } = useMobileTheme()
  const trimmed = props.value.trim()
  const invalid = useMemo(() => {
    if (!trimmed) return 'Enter a name'
    if (/[\\/]/.test(trimmed)) return 'A folder name cannot contain a slash'
    return null
  }, [trimmed])

  return (
    <PromptSheet
      title="New folder"
      subtitle={props.parent}
      icon={FolderPlus}
      onDismiss={props.onDismiss}
      footer={<PromptActions
        approveLabel="Create"
        rejectLabel="Cancel"
        disabled={!!invalid}
        onApprove={props.onSubmit}
        onReject={props.onDismiss}
      />}
    >
      <PromptInput
        accessibilityLabel="Folder name"
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        value={props.value}
        onChangeText={props.onChange}
        placeholder="Folder name"
        returnKeyType="go"
        onSubmitEditing={() => { if (!invalid) props.onSubmit() }}
      />
      {props.error ? <Text style={{ color: colors.error, fontSize: 12 }}>{props.error}</Text>
        : trimmed && invalid ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{invalid}</Text> : null}
    </PromptSheet>
  )
}
