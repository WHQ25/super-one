import type { ComponentType, ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Glasses, MonitorSmartphone, Plus, Smartphone, Tablet, Tv, Watch } from 'lucide-react'
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
import { IosSimulatorCreateDialog } from './IosSimulatorCreateDialog'
import type { IosSimulatorFamilyId } from './ios-simulator-catalog'
import { buildIosSimulatorCatalog } from './ios-simulator-catalog'
import { readRecentUdids, rememberRecentUdid, resolveRecentDevices } from './ios-simulator-recents'

const FAMILY_ICONS: Record<IosSimulatorFamilyId, ComponentType<{ className?: string }>> = {
  iphone: Smartphone,
  ipad: Tablet,
  watch: Watch,
  tv: Tv,
  vision: Glasses,
  other: MonitorSmartphone,
}

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
  device: IosSimulatorDevice
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
      {device.booted && <RunningDot />}
      {disabled && (
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {t('activity.iosSimulator.picker.busy')}
        </span>
      )}
    </DropdownMenuItem>
  )
}

interface IosSimulatorDeviceMenuProps {
  sessionId: string
  devices: IosSimulatorDevice[]
  /** The device this session is bound to, ticked throughout the menu. */
  currentUdid: string
  disabled?: boolean
  /**
   * Points the panel at this device. It gives up whatever the session was holding
   * first and re-reads the device list on the way, so a freshly created simulator
   * arrives through the same path as any other pick.
   */
  onSelect: (udid: string) => void
  /** The trigger. Rendered `asChild`, so it must forward props and a ref. */
  children: ReactNode
}

/**
 * The whole device picker, in one menu. It replaced a full-page launcher: choosing a
 * simulator is a one-decision act, and a page for it meant the panel spent its first
 * screen — and every switch afterwards — showing no simulator at all.
 *
 * Three bands, in the order a returning user wants them: what is already booted (a
 * plain attach, including simulators started outside SuperOne), what this machine
 * launched recently, then the full catalog grouped by Apple product family. Only the
 * catalog nests: a family's models each open a submenu of the runtimes they are
 * installed for, which is the one axis with real fan-out (a dozen models × several
 * iOS versions would otherwise be a hundred flat rows).
 */
export function IosSimulatorDeviceMenu({
  sessionId,
  devices,
  currentUdid,
  disabled,
  onSelect,
  children,
}: IosSimulatorDeviceMenuProps) {
  const { t } = useTranslation()
  const [recentUdids, setRecentUdids] = useState(readRecentUdids)
  const [creating, setCreating] = useState(false)

  const catalog = useMemo(() => buildIosSimulatorCatalog(devices), [devices])
  const running = useMemo(
    () => devices.filter((entry) => entry.available && entry.booted),
    [devices],
  )
  // Booted devices are already in the band above; listing them twice would make the
  // menu look like it holds duplicates of the same simulator.
  const recents = useMemo(
    () => resolveRecentDevices(recentUdids, devices).filter((entry) => !entry.booted),
    [recentUdids, devices],
  )

  const takenByOther = useCallback(
    (entry: IosSimulatorDevice) => Boolean(entry.boundSessionId && entry.boundSessionId !== sessionId),
    [sessionId],
  )

  const pick = useCallback((udid: string) => {
    setRecentUdids(rememberRecentUdid(udid))
    onSelect(udid)
  }, [onSelect])

  const created = useCallback((next: IosSimulatorDevice) => {
    // Straight to the new simulator — creating one is only ever a prelude to using it.
    // `onSelect` alone, deliberately: it re-reads the device list itself, so pairing
    // it with a refresh raced two passes that both wrote the selection and the list.
    setRecentUdids(rememberRecentUdid(next.udid))
    onSelect(next.udid)
  }, [onSelect])

  const label = (device: IosSimulatorDevice) => `${device.name} · ${device.runtimeName}`

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {running.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {t('activity.iosSimulator.picker.running')}
              </DropdownMenuLabel>
              {running.map((entry) => (
                <DeviceItem
                  key={entry.udid}
                  label={label(entry)}
                  device={entry}
                  selected={entry.udid === currentUdid}
                  disabled={takenByOther(entry)}
                  onSelect={() => pick(entry.udid)}
                />
              ))}
            </DropdownMenuGroup>
          )}

          {recents.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {t('activity.iosSimulator.picker.recent')}
              </DropdownMenuLabel>
              {recents.map((entry) => (
                <DeviceItem
                  key={entry.udid}
                  label={label(entry)}
                  device={entry}
                  selected={entry.udid === currentUdid}
                  disabled={takenByOther(entry)}
                  onSelect={() => pick(entry.udid)}
                />
              ))}
            </DropdownMenuGroup>
          )}

          {catalog.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {t('activity.iosSimulator.picker.empty')}
            </p>
          ) : catalog.map((family) => {
            const Icon = FAMILY_ICONS[family.id]
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
                        label={`${model.name} · ${only.runtimeName}`}
                        device={only}
                        selected={only.udid === currentUdid}
                        disabled={takenByOther(only)}
                        onSelect={() => pick(only.udid)}
                      />
                    )
                  }
                  const holdsCurrent = model.devices.some((entry) => entry.udid === currentUdid)
                  return (
                    <DropdownMenuSub key={model.name}>
                      <DropdownMenuSubTrigger className="gap-2">
                        <Check className={cn('size-3.5', !holdsCurrent && 'invisible')} />
                        <span className="min-w-0 flex-1 truncate">{model.name}</span>
                        {model.devices.some((entry) => entry.booted) && <RunningDot />}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-52">
                        {model.devices.map((entry) => (
                          <DeviceItem
                            key={entry.udid}
                            label={entry.runtimeName}
                            device={entry}
                            selected={entry.udid === currentUdid}
                            disabled={takenByOther(entry)}
                            onSelect={() => pick(entry.udid)}
                          />
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )
                })}
              </DropdownMenuGroup>
            )
          })}

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus />
            {t('activity.iosSimulator.picker.create')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Outside the menu on purpose. Mounted under `DropdownMenuContent` it unmounts
          with the menu the instant the item is chosen, so the dialog never opens. */}
      <IosSimulatorCreateDialog open={creating} onOpenChange={setCreating} onCreated={created} />
    </>
  )
}
