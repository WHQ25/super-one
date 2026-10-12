import { useEffect } from 'react'
import { Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

export function useMobileConnectionToasts(): void {
  const { t } = useTranslation()

  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const unsubscribe = window.app.onDeviceStatusChanged(({ id, online, firstConnect, name }) => {
      if (!online || !firstConnect) return
      const toastId = `mobile-connected-${id}`
      clearTimeout(timers.get(toastId))
      toast.success(t('sidebar.remote.deviceConnectedToast', { name: name ?? '' }), {
        id: toastId,
        // Sonner pauses its timer on hover and while the window is hidden.
        // Connection notices should expire regardless of those states.
        duration: Infinity,
        position: 'top-center',
        icon: <Smartphone className="size-4" />,
      })
      timers.set(toastId, setTimeout(() => {
        toast.dismiss(toastId)
        timers.delete(toastId)
      }, 4000))
    })
    return () => {
      unsubscribe()
      for (const [id, timer] of timers) {
        clearTimeout(timer)
        toast.dismiss(id)
      }
    }
  }, [t])
}
