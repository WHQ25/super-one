import type { ComponentType, ReactNode } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, MonitorSmartphone, Plus, SmartphoneNfc, Usb } from 'lucide-react'
import type { DeviceSetupKind, DeviceSetupOption } from '@superone/shared/device-setup'
import type { IosSimulatorDevice } from '@superone/shared/ios-simulator'
import { IosSimulatorCreateDialog } from './ios/IosSimulatorCreateDialog'
import { AndroidIcon } from './device-icons'
import { Button } from '@superone/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@superone/ui/components/ui/dialog'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { adviceKey, adviceSteps, labelKey } from './device-setup-copy'
import { messageOf } from './device-report'

/**
 * One glyph per row, and no two alike.
 *
 * Matched to the families these paths lead to — `device-icons.tsx` draws the same
 * Android mark in the catalog above, so a user who has just been sent to Android
 * Studio recognizes the row their new emulator turns up in. The two real devices are
 * told apart by how they arrive: a cable for Android, the air for iPhone Mirroring.
 */
const SETUP_ICONS: Record<DeviceSetupKind, ComponentType<{ className?: string }>> = {
  'ios-simulator': MonitorSmartphone,
  'android-emulator': AndroidIcon,
  'android-phone': Usb,
  'iphone-mirroring': SmartphoneNfc,
}

interface DeviceSetupSubmenuProps {
  options: readonly DeviceSetupOption[]
  /** The user picked a path. The menu closes; the caller decides what opens. */
  onChoose: (option: DeviceSetupOption) => void
}

/**
 * The bottom of the device picker: every way a new device could arrive.
 *
 * It replaced a lone "New Simulator" item, which was gated on Xcode and therefore
 * silent about the other three paths — a machine with no Xcode and no AVDs offered
 * nothing at all and explained nothing, which is exactly when a user needs telling
 * where to go.
 *
 * Each row says whether it finishes here or somewhere else, because three of the four
 * do not: SuperOne can genuinely make an iOS simulator, and cannot make an AVD, plug
 * in a cable, or pair a phone. Claiming otherwise would put the user one click from a
 * dead end.
 */
export function DeviceSetupSubmenu({ options, onChoose }: DeviceSetupSubmenuProps) {
  const { t } = useTranslation()
  if (options.length === 0) return null
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2">
          <Plus className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">{t('activity.device.setup.add')}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-60">
          {options.map((option) => {
            const Icon = SETUP_ICONS[option.kind]
            return (
              <DropdownMenuItem
                key={option.kind}
                className="gap-2"
                onSelect={() => onChoose(option)}
              >
                <Icon className="size-3.5" />
                {/* The label gets the whole row. A trailing "Created here" / "Set up
                    elsewhere" chip was tried and cost more than it explained: it
                    truncated "Android Emulator" to make room for a distinction the
                    dialog states properly a click later. */}
                <span className="min-w-0 flex-1 truncate">{t(labelKey(option.kind))}</span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  )
}

/**
 * What happens after a setup path is picked, in one place.
 *
 * Two surfaces need this: the picker's submenu, and the panel's empty state — which
 * REPLACES the whole stage on a machine with no platform at all, and so would
 * otherwise hide the very menu that explains how to fix that. They share the pair of
 * dialogs rather than each mounting their own, because "creatable opens the creator,
 * everything else opens the advice" is the one rule worth having exactly once.
 *
 * Returns `dialogs` as an element for the caller to place. Both dialogs must be
 * rendered OUTSIDE any dropdown: mounted under `DropdownMenuContent` they unmount
 * with the menu the instant the item is chosen, and never open at all.
 */
export function useDeviceSetupChoice(onCreated: (device: IosSimulatorDevice) => void): {
  choose: (option: DeviceSetupOption) => void
  dialogs: ReactNode
} {
  const [creating, setCreating] = useState(false)
  const [advising, setAdvising] = useState<DeviceSetupOption | null>(null)

  const choose = useCallback((option: DeviceSetupOption) => {
    if (option.creatable) setCreating(true)
    else setAdvising(option)
  }, [])

  return {
    choose,
    dialogs: (
      <>
        <IosSimulatorCreateDialog open={creating} onOpenChange={setCreating} onCreated={onCreated} />
        <DeviceSetupDialog
          option={advising}
          onOpenChange={(open) => { if (!open) setAdvising(null) }}
        />
      </>
    ),
  }
}

interface DeviceSetupDialogProps {
  /** The path being explained. Null closes the dialog. */
  option: DeviceSetupOption | null
  onOpenChange: (open: boolean) => void
}

/**
 * What to do about a path SuperOne cannot finish.
 *
 * Deliberately one dialog for all of them rather than one per platform: they differ
 * only in which paragraph they show, and that choice is `adviceKey`'s job. The
 * primary button never names its own destination — it asks the main process to
 * continue this KIND, which re-probes first, so a menu left open while the user
 * installed an SDK sends them onward rather than back to a download page.
 */
export function DeviceSetupDialog({ option, onOpenChange }: DeviceSetupDialogProps) {
  const { t } = useTranslation()
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const key = option ? adviceKey(option) : null
  // A creatable option has no advice — the caller opens the creation dialog for it —
  // so this stays closed rather than rendering an empty shell.
  const open = option !== null && key !== null

  const go = async () => {
    if (!option) return
    setOpening(true)
    setError(null)
    try {
      if (await window.environment.deviceSetupOpen(option.kind)) onOpenChange(false)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setOpening(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null)
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{key ? t(`${key}.title`) : ''}</DialogTitle>
          <DialogDescription className="sr-only">
            {option ? t(labelKey(option.kind)) : ''}
          </DialogDescription>
        </DialogHeader>
        <ol className="flex list-decimal flex-col gap-2 pl-4 text-xs leading-5 text-muted-foreground">
          {key && adviceSteps(t(`${key}.body`)).map((step) => <li key={step}>{step}</li>)}
        </ol>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('activity.device.picker.cancel')}
          </Button>
          <Button size="sm" disabled={opening} onClick={() => { void go() }}>
            <ExternalLink data-icon />
            {key ? t(`${key}.action`) : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
