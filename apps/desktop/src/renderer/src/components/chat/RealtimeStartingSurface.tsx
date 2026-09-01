import { AudioLines } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CodexCloudMark } from '@superone/ui/components/harness/CodexSessionIcon'
import { cn } from '@superone/ui/lib/utils'

const CLOUD_SIZE = 76
const GLYPH_SIZE = 30

/**
 * Shown while a realtime voice call is negotiating.
 *
 * Reuses the Codex mark rather than a generic spinner: the wait belongs to a
 * specific harness, and the breathing opacity already means "this session is alive
 * but not driving" everywhere else. Only the centre glyph changes — the shell
 * prompt becomes a waveform, so the mark reads as voice rather than command.
 *
 * Fills its parent so the mark lands on the optical centre of the transcript area;
 * every caller therefore has to give it a parent with a definite height.
 */
export function RealtimeStartingSurface({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="realtime-starting-surface"
      className={cn('flex h-full flex-col items-center justify-center gap-4', className)}
    >
      <CodexCloudMark size={CLOUD_SIZE} motion="pulse">
        <AudioLines
          className="text-white"
          strokeWidth={2}
          style={{ width: GLYPH_SIZE, height: GLYPH_SIZE }}
          aria-hidden
        />
      </CodexCloudMark>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t('chat.realtimeVoice.connecting')}
      </p>
    </div>
  )
}
