import { useCallback, useRef, useState } from 'react'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { Image, Modal, Pressable, Text, View } from 'react-native'
import { MAX_DOWNLOAD_BYTES, type RelayClient } from '@superone/relay-client'
import type {
  AgentEvent,
  ReadDesktopFileError,
  ReadDesktopFileResponse,
  RemoteCommand,
} from '@superone/shared/agent-types'
import { formatFileSize, safeSharedFileName } from './shared-file-state'
import { randomId } from './ids'
import { InFlightKeys } from './in-flight-keys'
import { useMobileStyles } from './theme/context'

type SharedFileEvent = Extract<AgentEvent, { type: 'shared_file' }>
type InboxItem = {
  event: SharedFileEvent
  status: 'downloading' | 'ready' | 'error'
  uri?: string
  error?: string
}

export function useSharedFileInbox() {
  const [items, setItems] = useState<InboxItem[]>([])
  const seen = useRef(new Set<string>())
  const desktopLoads = useRef(new InFlightKeys())

  const enqueue = useCallback(async (
    event: SharedFileEvent,
    load: () => Promise<Uint8Array>,
  ) => {
    if (seen.current.has(event.shareId)) return
    seen.current.add(event.shareId)
    setItems((current) => [...current, { event, status: 'downloading' }])
    try {
      const bytes = await load()
      const file = new File(Paths.cache, safeSharedFileName(event.shareId, event.file.name))
      file.create({ overwrite: true, intermediates: true })
      file.write(bytes)
      setItems((current) => current.map((item) => item.event.shareId === event.shareId
        ? { ...item, status: 'ready', uri: file.uri }
        : item))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'download failed'
      setItems((current) => current.map((item) => item.event.shareId === event.shareId
        ? { ...item, status: 'error', error: message }
        : item))
    }
  }, [])

  const receive = useCallback(
    (client: RelayClient, event: SharedFileEvent) => enqueue(event, () => client.downloadSharedFile(event.file)),
    [enqueue],
  )

  const receiveDesktopFile = useCallback(async (
    client: RelayClient,
    projectPath: string,
    sessionId: string | null,
    path: string,
  ) => {
    const loadKey = `${projectPath}\0${sessionId ?? ''}\0${path}`
    if (!desktopLoads.current.acquire(loadKey)) return
    const shareId = randomId()
    try {
      const response = await client.request({
        type: 'read_desktop_file',
        requestId: randomId(),
        projectPath,
        ...(sessionId ? { sessionId } : {}),
        path,
        maxBytes: MAX_DOWNLOAD_BYTES,
      } as RemoteCommand, 180_000) as ReadDesktopFileResponse | ReadDesktopFileError
      if (!response.ok) throw new Error(response.message ?? response.error)
      if ('statOnly' in response) throw new Error('desktop returned metadata without file data')
      const event: SharedFileEvent = {
        type: 'shared_file',
        shareId,
        sentAt: Date.now(),
        projectPath,
        ...(sessionId ? { sessionId } : {}),
        file: {
          name: response.name,
          mimeType: response.mimeType,
          size: response.size,
          downloadUrl: response.url,
          expiresAt: response.expiresAt,
          ...(response.encryption ? { encryption: response.encryption } : {}),
        },
      }
      await enqueue(event, () => client.downloadDesktopFile(response))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed to read desktop file'
      const name = path.split(/[\\/]/).pop() || path
      seen.current.add(shareId)
      setItems((current) => [...current, {
        event: {
          type: 'shared_file',
          shareId,
          sentAt: Date.now(),
          projectPath,
          ...(sessionId ? { sessionId } : {}),
          file: { name, mimeType: 'application/octet-stream', size: 0 },
        },
        status: 'error',
        error: message,
      }])
    } finally {
      desktopLoads.current.release(loadKey)
    }
  }, [enqueue])

  const dismiss = useCallback(() => setItems((current) => current.slice(1)), [])
  const open = useCallback(async () => {
    const item = items[0]
    if (!item?.uri) return
    try {
      if (!await Sharing.isAvailableAsync()) throw new Error('Sharing is unavailable on this device')
      await Sharing.shareAsync(item.uri, {
        mimeType: item.event.file.mimeType,
        dialogTitle: item.event.file.name,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed to open file'
      setItems((current) => current.map((row, index) => index === 0 ? { ...row, error: message } : row))
    }
  }, [items])

  return { current: items[0] ?? null, pendingCount: items.length, receive, receiveDesktopFile, dismiss, open }
}

export function SharedFileSheet(props: {
  inbox: ReturnType<typeof useSharedFileInbox>
}) {
  const styles = useMobileStyles()
  const { current, pendingCount } = props.inbox
  const file = current?.event.file
  return (
    <Modal visible={!!current} transparent animationType="fade">
      <View style={styles.modal}>
        <View style={styles.settingsCard}>
          <Text style={styles.sectionTitle}>File received</Text>
          <Text numberOfLines={2} style={styles.rowTitle}>{file?.name}</Text>
          {file?.caption ? <Text style={styles.rowMeta}>{file.caption}</Text> : null}
          {file ? <Text style={styles.rowMeta}>{formatFileSize(file.size)} · {file.mimeType}</Text> : null}
          {current?.status === 'downloading' ? <Text style={styles.rowMeta}>Downloading securely…</Text> : null}
          {current?.error ? <Text style={styles.errorText}>{current.error}</Text> : null}
          {current?.status === 'ready' && current.uri && file?.mimeType.startsWith('image/') ? (
            <Image resizeMode="contain" source={{ uri: current.uri }} style={styles.sharedFilePreview} />
          ) : null}
          {current?.status === 'ready' ? (
            <Pressable style={styles.btn} onPress={() => void props.inbox.open()}>
              <Text style={styles.btnText}>Open or share</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.secondaryBtn} onPress={props.inbox.dismiss}>
            <Text style={styles.secondaryBtnText}>{pendingCount > 1 ? `Next (${pendingCount - 1})` : 'Dismiss'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}
