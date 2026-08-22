import type { ComponentType } from 'react'
import { Car, Glasses, Monitor, MonitorSmartphone, Smartphone, SmartphoneNfc, Tablet, Tv, Watch } from 'lucide-react'
import type { DeviceProvider } from '@superone/shared/device'

/**
 * A glyph per device family, chosen so two families never share one.
 *
 * That constraint is the whole job. The picker lists every platform this Mac can
 * reach in one menu, and `kind` alone cannot separate them: an iPhone and an Android
 * phone are both `phone`-shaped, so keying purely on shape drew the same handset
 * three times over and left the heading text doing all the work.
 *
 * So the choice is made on PROVIDER first and shape second — provider being the axis
 * a reader actually has to tell apart, since it decides both what the device is and
 * how much can be done with it.
 */

/**
 * Android, drawn rather than imported.
 *
 * Neither lucide nor `@lobehub/icons` ships one, and the alternatives were worse: an
 * Apple mark to pair it with is genuinely hard to draw well at 14px, and every
 * shape-only glyph in lucide was already spoken for by the other providers. Stroked
 * to match its neighbours — a filled logo beside six outlined icons reads as an error.
 */
export function AndroidIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m8 3 1.5 2.5" />
      <path d="m16 3-1.5 2.5" />
      <path d="M5 11a7 7 0 0 1 14 0" />
      <path d="M5 11h14v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
      {/* lucide's dot idiom: a zero-length stroke with a round cap. */}
      <path d="M9.5 8h.01" />
      <path d="M14.5 8h.01" />
    </svg>
  )
}

/**
 * Shape, for the families where shape is the distinguishing thing.
 *
 * Keyed by the descriptor's own `kind`, which is each platform's vocabulary rather
 * than a shared enum — so `iphone` and `phone` both appear. Anything unrecognized
 * falls through to a plain handset rather than breaking the row, because both
 * platforms classify from free-form hardware strings.
 */
const KIND_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  iphone: Smartphone,
  phone: Smartphone,
  ipad: Tablet,
  tablet: Tablet,
  foldable: SmartphoneNfc,
  watch: Watch,
  wear: Watch,
  tv: Tv,
  vision: Glasses,
  auto: Car,
  desktop: Monitor,
}

/**
 * The icon for one device family.
 *
 * Android answers with its own mark for every shape it has, because "which platform"
 * is the more useful thing to know about an Android tablet than "it is a tablet" —
 * the heading already says the latter. A mirrored iPhone gets the wireless handset,
 * which is exactly what it is: a real phone reached over the air, and the one entry
 * in this menu that belongs to somebody.
 */
export function deviceFamilyIcon(
  provider: DeviceProvider,
  kind: string,
): ComponentType<{ className?: string }> {
  if (provider === 'android') return AndroidIcon
  if (provider === 'ios-mirror') return SmartphoneNfc
  return KIND_ICONS[kind] ?? MonitorSmartphone
}
