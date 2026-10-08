import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { FilePreviewModal } from '../ui/file-preview'
import { imagePreviewState, mermaidPreviewState, type FilePreviewState } from '../file-preview-state'
import type { MarkdownDocumentPorts } from '../markdown-document-requests'
import { Button, SelectionField } from '../ui'
import { createFakeGenerationPorts } from './fake-generation-ports'
import { createFakeMediaPorts, type FakeSaveBehaviour } from './fake-media-ports'
import { FILE_PREVIEW_FIXTURES, isBundledSample, sampleLocalUri } from './file-preview-fixtures'

const SAVE_OUTCOMES: FakeSaveBehaviour[] = ['saved', 'cancelled', 'denied', 'throw']

/**
 * Every state the fullscreen preview can reach, one at a time, with fake media
 * ports so the menu's outcomes — saved, cancelled, permission denied, a native
 * failure — can be seen without a photo library or a folder picker. The two
 * relay transfer rows are the ones worth reviewing here: reproducing them
 * against a live desktop means pairing through the relay on purpose and
 * tapping a large file — this gets there in one pick.
 */
export function FilePreviewGallery() {
  const [label, setLabel] = useState(FILE_PREVIEW_FIXTURES[0].label)
  const [saveOutcome, setSaveOutcome] = useState<FakeSaveBehaviour>('saved')
  const [open, setOpen] = useState(false)
  /** A page the Markdown fixture opened on top of itself; back returns to the document. */
  const [nested, setNested] = useState<FilePreviewState | null>(null)
  const [phase, setPhase] = useState<'idle' | 'downloading' | null>(null)
  const fixture = FILE_PREVIEW_FIXTURES.find((item) => item.label === label) ?? FILE_PREVIEW_FIXTURES[0]
  const bundled = isBundledSample(fixture.state) ? fixture.state : null
  const [sampleUri, setSampleUri] = useState<string | null>(null)
  const [sampleError, setSampleError] = useState<string | null>(null)
  useEffect(() => {
    if (!bundled) return
    let active = true
    setSampleUri(null)
    setSampleError(null)
    void sampleLocalUri(bundled.name).then((uri) => { if (active) setSampleUri(uri) })
      .catch((cause) => { if (active) setSampleError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [label, bundled?.name])
  // The Download button flips the real card into its downloading state so the
  // transition can be seen, not just its two ends.
  const state: FilePreviewState = fixture.state.kind === 'transfer' && phase
    ? { ...fixture.state, phase }
    : bundled && sampleError
      ? { kind: 'error', path: bundled.path, name: bundled.name, message: sampleError }
      : bundled && !sampleUri
        ? { kind: 'loading', path: bundled.path, name: bundled.name }
        : bundled
          ? { ...bundled, localUri: sampleUri! }
          : fixture.state
  const ports = useMemo(() => createFakeMediaPorts({ save: saveOutcome, delayMs: 600 }), [saveOutcome])
  const generationPorts = useMemo(() => createFakeGenerationPorts({ delayMs: 600 }), [])
  // Diagrams and pictures in the Markdown fixture open and come back as they do
  // paired; links, copies and host media have nothing behind them here.
  const documentPorts = useMemo<MarkdownDocumentPorts>(() => ({
    previewMermaid: async (svg) => { setNested(mermaidPreviewState(svg)) },
    previewImage: async (target) => { setNested(imagePreviewState(target)) },
    openLink: async () => {},
    previewFile: async () => {},
    copyText: async () => {},
    resolveFavicon: async () => null,
    loadImage: async () => { throw new Error('No host in the preview gallery') },
    loadVideoPoster: async () => null,
  }), [])
  return (
    <View style={{ flex: 1, gap: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
      <SelectionField compact label="State" value={label}
        options={FILE_PREVIEW_FIXTURES.map((item) => ({ value: item.label, label: item.label }))}
        onChange={(next) => { setLabel(next); setPhase(null) }} />
      <SelectionField compact label="Save outcome" value={saveOutcome}
        options={SAVE_OUTCOMES.map((value) => ({ value, label: value }))}
        onChange={(next) => setSaveOutcome(next as FakeSaveBehaviour)} />
      <Button label="Open preview" onPress={() => setOpen(true)} />
      <FilePreviewModal
        state={open ? nested ?? state : null}
        covered={nested ? [state] : []}
        ports={ports}
        onDismiss={() => { if (nested) setNested(null); else setOpen(false) }}
        onStartTransfer={() => setPhase('downloading')}
        onRetry={() => setPhase(null)}
        generationPorts={generationPorts}
        documentPorts={documentPorts}
      />
    </View>
  )
}
