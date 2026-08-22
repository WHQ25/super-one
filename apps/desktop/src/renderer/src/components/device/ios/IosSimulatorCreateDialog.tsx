import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { IosSimulatorDevice, IosSimulatorRuntimeOption } from '@superone/shared/ios-simulator'
import { Button } from '@superone/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@superone/ui/components/ui/dialog'
import { Input } from '@superone/ui/components/ui/input'
import { Label } from '@superone/ui/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@superone/ui/components/ui/select'
import { messageOf } from '../device-report'

interface IosSimulatorCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (device: IosSimulatorDevice) => void
}

/** Groups a runtime's models by Apple's own product family so the list stays scannable. */
function groupByFamily(runtime: IosSimulatorRuntimeOption | null) {
  const groups = new Map<string, IosSimulatorRuntimeOption['deviceTypes']>()
  for (const type of runtime?.deviceTypes ?? []) {
    groups.set(type.productFamily, [...(groups.get(type.productFamily) ?? []), type])
  }
  return [...groups.entries()]
}

export function IosSimulatorCreateDialog({ open, onOpenChange, onCreated }: IosSimulatorCreateDialogProps) {
  const { t } = useTranslation()
  const [runtimes, setRuntimes] = useState<IosSimulatorRuntimeOption[] | null>(null)
  const [runtimeId, setRuntimeId] = useState('')
  const [deviceTypeId, setDeviceTypeId] = useState('')
  // Blank means "follow the model"; a keystroke pins it so a later model change
  // cannot silently overwrite what the user typed.
  const [customName, setCustomName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setRuntimes(null)
    window.environment.iosSimulatorRuntimes()
      .then((next) => {
        setRuntimes(next)
        const first = next.find((runtime) => runtime.deviceTypes.length > 0) ?? next[0]
        setRuntimeId(first?.identifier ?? '')
        setDeviceTypeId(first?.deviceTypes[0]?.identifier ?? '')
        setCustomName('')
      })
      .catch((cause: unknown) => setError(messageOf(cause)))
  }, [open])

  const runtime = runtimes?.find((entry) => entry.identifier === runtimeId) ?? null
  const deviceType = runtime?.deviceTypes.find((entry) => entry.identifier === deviceTypeId)
    ?? runtime?.deviceTypes[0]
    ?? null
  const name = customName || deviceType?.name || ''

  const pickRuntime = useCallback((identifier: string) => {
    setRuntimeId(identifier)
    // Models are runtime-scoped, so the previous pick may not exist here.
    setDeviceTypeId('')
  }, [])

  const create = useCallback(async () => {
    if (!runtime || !deviceType || !name.trim()) return
    setCreating(true)
    setError(null)
    try {
      const device = await window.environment.iosSimulatorCreate({
        name: name.trim(),
        deviceTypeIdentifier: deviceType.identifier,
        runtimeIdentifier: runtime.identifier,
      })
      onCreated(device)
      onOpenChange(false)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setCreating(false)
    }
  }, [deviceType, name, onCreated, onOpenChange, runtime])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('activity.device.picker.create')}</DialogTitle>
        </DialogHeader>

        {runtimes === null ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 data-icon className="animate-spin" />
            {t('activity.device.checking')}
          </div>
        ) : runtimes.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('activity.device.picker.createEmpty')}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ios-simulator-runtime">{t('activity.device.picker.stepVersion')}</Label>
              <Select value={runtime?.identifier ?? ''} onValueChange={pickRuntime}>
                <SelectTrigger id="ios-simulator-runtime" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {runtimes.map((entry) => (
                    <SelectItem key={entry.identifier} value={entry.identifier} disabled={entry.deviceTypes.length === 0}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ios-simulator-device-type">{t('activity.device.picker.stepModel')}</Label>
              <Select value={deviceType?.identifier ?? ''} onValueChange={setDeviceTypeId}>
                <SelectTrigger id="ios-simulator-device-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groupByFamily(runtime).map(([family, types]) => (
                    <SelectGroup key={family}>
                      <SelectLabel>{family}</SelectLabel>
                      {types.map((type) => (
                        <SelectItem key={type.identifier} value={type.identifier}>{type.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ios-simulator-name">{t('activity.device.picker.createName')}</Label>
              <Input
                id="ios-simulator-name"
                value={name}
                onChange={(event) => setCustomName(event.target.value)}
                placeholder={deviceType?.name}
              />
            </div>

            {error && <p className="text-xs leading-4 text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
            {t('activity.device.picker.cancel')}
          </Button>
          <Button onClick={() => { void create() }} disabled={creating || !deviceType || !name.trim()}>
            {creating && <Loader2 data-icon className="animate-spin" />}
            {creating ? t('activity.device.picker.creating') : t('activity.device.picker.createConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
