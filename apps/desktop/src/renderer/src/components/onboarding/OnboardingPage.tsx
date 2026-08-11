import { ArrowLeft } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { useAppStore } from '@/stores/app'
import logoUrl from '@/assets/logo-text-inline.png'
import { OnboardingWelcome } from './OnboardingWelcome'
import { OnboardingDiscover } from './OnboardingDiscover'

const ONBOARDING_STEPS = 2

function StepIndicator({ current }: { current: number }): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: ONBOARDING_STEPS }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 rounded-full transition-all duration-500',
            i === current && 'w-6 bg-primary',
            i < current && 'w-1.5 bg-primary/50',
            i > current && 'w-1.5 bg-muted-foreground/25',
          )}
        />
      ))}
    </div>
  )
}

export function OnboardingPage(): React.JSX.Element {
  const { t } = useTranslation()
  const step = useAppStore((s) => s.onboardingStep)
  const goToOnboardingStep = useAppStore((s) => s.goToOnboardingStep)

  const canGoBack = step !== 'welcome'
  const stepIndex = step === 'welcome' ? 0 : 1

  const bodyMotion = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -12 },
    transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <AnimatePresence initial={false}>
        {canGoBack ? (
          <motion.button
            key="back"
            type="button"
            onClick={() => goToOnboardingStep('welcome')}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="absolute left-6 top-6 z-20 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            {t('common.back')}
          </motion.button>
        ) : null}
      </AnimatePresence>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10">
        <div className="flex w-full max-w-md flex-col items-center gap-10">
          <img
            src={logoUrl}
            alt="Super One"
            draggable={false}
            className="h-12 w-auto shrink-0 select-none"
          />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              {...bodyMotion}
              className="flex w-full flex-col items-center"
            >
              {step === 'welcome' ? <OnboardingWelcome /> : <OnboardingDiscover />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center">
        <StepIndicator current={stepIndex} />
      </div>
    </div>
  )
}
