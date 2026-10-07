import { View } from 'react-native'
import { Text } from '../ui/text'
import { FileText, ShieldAlert } from 'lucide-react-native'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { permissionDetailMessage } from '@superone/shared/permission-details'
import { permissionPresentation } from '@superone/shared/permission-presentation'
import { useMobileTheme } from '../theme/context'
import { permissionSheetPresentation } from '../permission-sheet-state'
import { permissionToolContent } from './prompt-content'
import { usePromptStyles } from './styles'
import { NativeDiff } from './NativeDiff'
import { useMobileLocale } from '../i18n/context'
import { ScopedPermissionContent } from './ScopedPermissionContent'
import { Disclosure } from './Disclosure'
export { Disclosure } from './Disclosure'

export function PermissionContent({ request, remembering = false }: { request: PermissionRequest; remembering?: boolean }) {
  const styles = usePromptStyles()
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const content = permissionToolContent(request)
  const presentation = permissionSheetPresentation(request)
  const message = permissionDetailMessage(request)
  const scoped = permissionPresentation(request)
  if (scoped) return <ScopedPermissionContent request={request} presentation={scoped} remembering={remembering} />
  return <View style={styles.stack}>
    {request.requestKind ? <>
      {presentation.description && request.requestKind !== 'video_gen_confirm' ? <Text style={styles.meta}>{t(presentation.description)}</Text> : null}
      {presentation.items.length && !['video_gen_confirm', 'config_confirm', 'automation_confirm'].includes(request.requestKind) ? <View style={styles.card}>{presentation.items.map((item, index) => <View key={index} style={styles.tight}>
        {index ? <View style={styles.divider} /> : null}
        <Text selectable style={[styles.body, item.warning && { color: colors.warning }]}>{item.title}</Text>
        {item.subtitle ? <Text selectable style={styles.meta}>{t(item.subtitle)}</Text> : null}
      </View>)}</View> : null}
    </> : <>
      {message && message !== content.description ? <Text selectable style={styles.meta}>{message}</Text> : null}
      {content.description && !content.sandboxOverride ? <Text style={styles.meta}>{content.description}</Text> : null}
      {content.sandboxOverride ? <View style={styles.warning}><View style={styles.row}><ShieldAlert size={14} color={colors.warning} /><Text style={styles.warningText}>{t('Sandbox override')}</Text></View>{content.description ? <Text style={styles.meta}>{content.description}</Text> : null}</View> : null}
      {content.filePath ? <View style={styles.card}><View style={styles.row}><FileText size={14} color={colors.mutedForeground} /><Text style={[styles.title, styles.grow]}>{content.fileName}</Text>{request.toolLineDelta ? <Text style={styles.meta}>+{request.toolLineDelta.added} −{request.toolLineDelta.removed}</Text> : null}</View><Text selectable style={styles.meta}>{content.filePath}</Text></View> : null}
      {content.command ? <View style={styles.card}><Text style={styles.label}>{t('Command')}</Text><Text selectable style={styles.code}>{content.command}</Text></View> : null}
      {content.target ? <Text selectable style={styles.code}>{content.target}</Text> : null}
      {content.diff ? <NativeDiff diff={content.diff} tokens={request.toolDiffTokens} /> : content.content ? <Disclosure title="File content"><Text selectable style={styles.code}>{content.content}</Text></Disclosure> : null}
      {content.rawInput && !request.permissionDetails ? <Disclosure title="Tool input" initiallyOpen><Text selectable style={styles.code}>{content.rawInput}</Text></Disclosure> : null}
      {request.blockedPath ? <View style={styles.warning}><Text style={styles.warningText}>{t('Blocked path')}</Text><Text selectable style={styles.code}>{request.blockedPath}</Text></View> : null}
      {request.decisionReason ? <Text style={styles.meta}>{request.decisionReason}</Text> : null}
    </>}
  </View>
}
