import type { ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import type { DeviceDescriptor } from '@superone/shared/device'
import { formatDeviceId } from '@superone/shared/device'
import type { DeviceSetupOption } from '@superone/shared/device-setup'
import type { IosSimulatorDevice } from '@superone/shared/ios-simulator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { cn } from '@superone/ui/lib/utils'
import { DeviceSetupSubmenu, useDeviceSetupChoice } from './DeviceSetupMenu'
import { deviceFamilyIcon } from './device-icons'
import { buildDeviceCatalog } from './device-catalog'
import { readRecentDeviceIds, rememberRecentDeviceId, resolveRecentDevices } from './device-recents'

/** A green pip on anything already booted, so attaching reads differently from launching. */
function RunningDot() {
  return <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
}

function DeviceItem({
  label,
  device,
  selected,
  disabled,
  onSelect,
}: {
  label: string
  device: DeviceDescriptor
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  return (
    <DropdownMenuItem disabled={disabled} onSelect={onSelect} className="gap-2">
      {/* The tick keeps its box when unticked: without it every row shifts sideways
          the moment the selection moves, and the menu is a list of near-identical
          model names where that flicker reads as the list itself changing. */}
      <Check className={cn('size-3.5', !selected && 'invisible')} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {device.running && <RunningDot />}
      {disabled && (
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {t('activity.device.picker.busy')}
        </span>
      )}
    </DropdownMenuItem>
  )
}

interface DeviceMenuProps {
  sessionId: string
  devices: DeviceDescriptor[]
  /**
   * Devices another tab of this session is already pointed at.
   *
   * Not derivable from `boundSessionId`, which is what the HOST knows: a device that
   * is merely drawn — chosen but not yet booted — is owned by nobody, and two tabs
   * showing the same shut-down simulator is a pair the user cannot tell apart. The
   * tabs are the only thing that knows, so they say so.
   */
  unavailableDeviceIds?: readonly string[]
  /** The device this session is bound to, ticked throughout the menu. */
  currentDeviceId: string
  disabled?: boolean
  /**
   * Points the panel at this device. It gives up whatever the session was holding
   * first and re-reads the device list on the way, so a freshly created simulator
   * arrives through the same path as any other pick.
   */
  onSelect: (deviceId: string) => void
  /**
   * Every way a device could still be ADDED, from `device/setup.ts`.
   *
   * This used to be a single `canCreateSimulator` boolean gated on Xcode, which meant
   * a machine with no Xcode and no AVDs offered nothing and explained nothing — the
   * exact moment a user most needs telling where to go. The reasoning behind the old
   * shape was that a menu item which could only point at Android Studio is worse than
   * no menu item; the answer is to make it point *and* say what it will do, which is
   * what `creatable` on each option carries.
   *
   * Empty renders nothing at all, so a platform with no setup paths costs no chrome.
   */
  setupOptions?: readonly DeviceSetupOption[]
  /** The trigger. Rendered `asChild`, so it must forward props and a ref. */
  children: ReactNode
}

/**
 * The whole device picker, in one menu. It replaced a full-page launcher: choosing a
 * simulator is a one-decision act, and a page for it meant the panel spent its first
 * screen — and every switch afterwards — showing no simulator at all.
 *
 * Three bands, in the order a returning user wants them: what is already running (a
 * plain attach, including simulators and emulators started outside SuperOne), what
 * this machine used recently, then the full catalog grouped by product family across
 * both platforms.
 *
 * Only the catalog nests, and only where a model actually fans out. On iOS that is
 * the model × runtime matrix — a dozen models across several iOS versions would
 * otherwise be a hundred flat rows — while an AVD is its own model, so the same tier
 * renders as one row. Neither case is special-cased: `buildDeviceCatalog` groups by
 * `model` and a single-entry group draws itself flat.
 */
export function DeviceMenu({
  sessionId,
  devices,
  unavailableDeviceIds,
  currentDeviceId,
  disabled,
  onSelect,
  setupOptions = [],
  children,
}: DeviceMenuProps) {
  const { t } = useTranslation()
  const [recentIds, setRecentIds] = useState(readRecentDeviceIds)

  const catalog = useMemo(() => buildDeviceCatalog(devices), [devices])
  const running = useMemo(
    () => devices.filter((entry) => entry.available && entry.running),
    [devices],
  )
  // Booted devices are already in the band above; listing them twice would make the
  // menu look like it holds duplicates of the same simulator.
  const recents = useMemo(
    () => resolveRecentDevices(recentIds, devices).filter((entry) => !entry.running),
    [recentIds, devices],
  )

  // Two ways a device can already be spoken for, and neither implies the other: held
  // by another chat session, or open in another tab of this one.
  const takenElsewhere = useMemo(() => new Set(unavailableDeviceIds ?? []), [unavailableDeviceIds])
  const takenByOther = useCallback(
    (entry: DeviceDescriptor) =>
      Boolean(entry.boundSessionId && entry.boundSessionId !== sessionId)
      || takenElsewhere.has(entry.id),
    [sessionId, takenElsewhere],
  )

  const pick = useCallback((deviceId: string) => {
    setRecentIds(rememberRecentDeviceId(deviceId))
    onSelect(deviceId)
  }, [onSelect])

  const created = useCallback((next: IosSimulatorDevice) => {
    // Straight to the new simulator — creating one is only ever a prelude to using it.
    // `onSelect` alone, deliberately: it re-reads the device list itself, so pairing
    // it with a refresh raced two passes that both wrote the selection and the list.
    setRecentIds(rememberRecentDeviceId(formatDeviceId('ios-sim', next.udid)))
    onSelect(formatDeviceId('ios-sim', next.udid))
  }, [onSelect])

  const setup = useDeviceSetupChoice(created)

  const label = (device: DeviceDescriptor) => `${device.name} · ${device.platformVersion}`

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {running.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {t('activity.device.picker.running')}
              </DropdownMenuLabel>
              {running.map((entry) => (
                <DeviceItem
                  key={entry.id}
                  label={label(entry)}
                  device={entry}
                  selected={entry.id === currentDeviceId}
                  disabled={takenByOther(entry)}
                  onSelect={() => pick(entry.id)}
                />
              ))}
            </DropdownMenuGroup>
          )}

          {recents.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {t('activity.device.picker.recent')}
              </DropdownMenuLabel>
              {recents.map((entry) => (
                <DeviceItem
                  key={entry.id}
                  label={label(entry)}
                  device={entry}
                  selected={entry.id === currentDeviceId}
                  disabled={takenByOther(entry)}
                  onSelect={() => pick(entry.id)}
                />
              ))}
            </DropdownMenuGroup>
          )}

          {catalog.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {t('activity.device.picker.empty')}
            </p>
          ) : catalog.map((family) => {
            const Icon = deviceFamilyIcon(family.provider, family.kind)
            return (
              <DropdownMenuGroup key={family.id}>
                <DropdownMenuLabel className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon className="size-3" />
                  {family.label}
                </DropdownMenuLabel>
                {family.models.map((model) => {
                  // A model installed for exactly one runtime gets no submenu: a
                  // one-item submenu is a hover and a second click for no choice.
                  const only = model.devices.length === 1 ? model.devices[0]! : null
                  if (only) {
                    return (
                      <DeviceItem
                        key={model.name}
                        label={`${model.name} · ${only.platformVersion}`}
                        device={only}
                        selected={only.id === currentDeviceId}
                        disabled={takenByOther(only)}
                        onSelect={() => pick(only.id)}
                      />
                    )
                  }
                  const holdsCurrent = model.devices.some((entry) => entry.id === currentDeviceId)
                  return (
                    <DropdownMenuSub key={model.name}>
                      <DropdownMenuSubTrigger className="gap-2">
                        <Check className={cn('size-3.5', !holdsCurrent && 'invisible')} />
                        <span className="min-w-0 flex-1 truncate">{model.name}</span>
                        {model.devices.some((entry) => entry.running) && <RunningDot />}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-52">
                        {model.devices.map((entry) => (
                          <DeviceItem
                            key={entry.id}
                            label={entry.platformVersion}
                            device={entry}
                            selected={entry.id === currentDeviceId}
                            disabled={takenByOther(entry)}
                            onSelect={() => pick(entry.id)}
                          />
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )
                })}
              </DropdownMenuGroup>
            )
          })}

          <DeviceSetupSubmenu options={setupOptions} onChoose={setup.choose} />
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Outside the menu on purpose — see `useDeviceSetupChoice`. */}
      {setup.dialogs}
    </>
  )
}
