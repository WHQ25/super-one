import { View } from 'react-native'
import { Text } from '../ui/text'
import type { PermissionRequest } from '@superone/shared/agent-types'
import type { PermissionPresentation } from '@superone/shared/permission-presentation'
import { permissionDetailMessage, permissionDetailSections } from '@superone/shared/permission-details'
import { useMobileLocale } from '../i18n/context'
import { usePromptStyles } from './styles'
import { Disclosure } from './Disclosure'
import { NativeDiff } from './NativeDiff'
import { permissionToolContent } from './prompt-content'

const SECTION_TITLES = {
  action: 'Permission', resources: 'Requested scope', source: 'Triggering tool',
  toolInput: 'Tool arguments', metadata: 'Request metadata', save: 'Proposed saved scope',
}

export function ScopedPermissionContent({ request, presentation, remembering }: {
  request: PermissionRequest; presentation: PermissionPresentation; remembering: boolean
}) {
  const styles = usePromptStyles()
  const { t } = useMobileLocale()
  const details = request.permissionDetails!
  const message = permissionDetailMessage(request)
  const diff = presentation.diff || (presentation.editInput
    ? permissionToolContent({ ...request, toolName: 'Edit', input: presentation.editInput }).diff : '')
  if (remembering) return <View style={styles.stack}>
    <Text style={styles.meta}>{t('Future requests matching these patterns will be allowed in this project, including new sessions and restarts. Configured deny rules still apply.')}</Text>
    <View style={styles.card}><Text selectable style={styles.code}>{details.save?.join('\n')}</Text></View>
    {details.save?.includes('*') ? <View style={styles.warning}><Text style={styles.warningText}>{t('This allows all resources for {{action}}, not just the current request.').replace('{{action}}', details.action)}</Text></View> : null}
  </View>
  return <View style={styles.stack}>
    {message ? <Text selectable style={styles.meta}>{message}</Text> : null}
    {presentation.command ? <View style={styles.card}><Text selectable style={styles.code}>{`$ ${presentation.command}`}</Text></View> : null}
    {presentation.directory ? <Text selectable style={styles.meta}>{t('Working directory: {{path}}').replace('{{path}}', presentation.directory)}</Text> : null}
    {!presentation.command && presentation.lines.length ? <View style={styles.card}>
      <Text style={styles.label}>{t('Requested scope')}</Text>
      <Text selectable style={styles.code}>{presentation.lines.join('\n')}</Text>
    </View> : null}
    {diff ? <NativeDiff diff={diff} /> : presentation.patch ? <View style={styles.card}><Text selectable style={styles.code}>{presentation.patch}</Text></View> : null}
    <Disclosure title="Technical details">
      {permissionDetailSections(request).map(({ id, value }) => <View key={id} style={styles.tight}>
        <Text style={styles.label}>{t(SECTION_TITLES[id])}</Text><Text selectable style={styles.code}>{value}</Text>
      </View>)}
      {details.source && details.source.input === undefined ? <Text style={styles.meta}>{t('The tool arguments are not available in this permission request.')}</Text> : null}
    </Disclosure>
  </View>
}
