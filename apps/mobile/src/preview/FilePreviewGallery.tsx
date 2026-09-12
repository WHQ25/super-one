import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { FilePreviewModal } from '../ui/file-preview'
import type { FilePreviewState } from '../file-preview-state'
import { Button, SelectionField } from '../ui'
import { createFakeGenerationPorts } from './fake-generation-ports'
import { createFakeMediaPorts, type FakeSaveBehaviour } from './fake-media-ports'
import { FILE_PREVIEW_FIXTURES } from './file-preview-fixtures'

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
  const [phase, setPhase] = useState<'idle' | 'downloading' | null>(null)
  const fixture = FILE_PREVIEW_FIXTURES.find((item) => item.label === label) ?? FILE_PREVIEW_FIXTURES[0]
  // The Download button flips the real card into its downloading state so the
  // transition can be seen, not just its two ends.
  const state: FilePreviewState = fixture.state.kind === 'transfer' && phase
    ? { ...fixture.state, phase }
    : fixture.state
  const ports = useMemo(() => createFakeMediaPorts({ save: saveOutcome, delayMs: 600 }), [saveOutcome])
  const generationPorts = useMemo(() => createFakeGenerationPorts({ delayMs: 600 }), [])
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
        state={open ? state : null}
        ports={ports}
        onDismiss={() => setOpen(false)}
        onStartTransfer={() => setPhase('downloading')}
        onRetry={() => setPhase(null)}
        generationPorts={generationPorts}
      />
    </View>
  )
}
