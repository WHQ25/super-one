import { useTranslation } from 'react-i18next'
import { MonitorCog } from 'lucide-react'
import {
  IOS_SIMULATOR_PREVIEW_FRAME_RATES,
  IOS_SIMULATOR_PREVIEW_SCALES,
  type IosSimulatorPreviewQuality,
} from '@superone/shared/ios-simulator'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { scaledPreviewSize } from './ios-simulator-preview-quality'

interface IosSimulatorPreviewMenuProps {
  quality: IosSimulatorPreviewQuality
  /** The device's own framebuffer size, so each scale can show what it resolves to. */
  nativeWidth: number
  nativeHeight: number
  disabled?: boolean
  onChange: (quality: IosSimulatorPreviewQuality) => void
}

/**
 * Preview-only quality controls. Both settings are negotiated when the frame stream
 * opens, so changing either one restarts the stream — which is why they live behind
 * a menu rather than on the toolbar as one-click toggles.
 */
export function IosSimulatorPreviewMenu({
  quality,
  nativeWidth,
  nativeHeight,
  disabled,
  onChange,
}: IosSimulatorPreviewMenuProps) {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          tooltip={t('activity.iosSimulator.preview.title')}
          disabled={disabled}
        >
          <MonitorCog />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t('activity.iosSimulator.preview.resolution')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={String(quality.scale)}
          onValueChange={(value) => onChange({ ...quality, scale: Number(value) })}
        >
          {IOS_SIMULATOR_PREVIEW_SCALES.map((scale) => {
            const size = scaledPreviewSize(nativeWidth, nativeHeight, scale)
            return (
              <DropdownMenuRadioItem key={scale} value={String(scale)}>
                <span className="flex-1">
                  {scale >= 1
                    ? t('activity.iosSimulator.preview.native')
                    : `${Math.round(scale * 100)}%`}
                </span>
                {nativeWidth > 0 && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {size.width}×{size.height}
                  </span>
                )}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('activity.iosSimulator.preview.frameRate')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={String(quality.maxFrameRate)}
          onValueChange={(value) => onChange({ ...quality, maxFrameRate: Number(value) })}
        >
          {IOS_SIMULATOR_PREVIEW_FRAME_RATES.map((rate) => (
            <DropdownMenuRadioItem key={rate} value={String(rate)}>
              {rate === 0 ? t('activity.iosSimulator.preview.unlimited') : `${rate} fps`}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs leading-4 text-muted-foreground">
          {t('activity.iosSimulator.preview.captureNote')}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
