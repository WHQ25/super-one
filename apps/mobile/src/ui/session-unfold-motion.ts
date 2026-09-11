import { Easing, FadeInDown, FadeOut, LinearTransition, ReduceMotion } from 'react-native-reanimated'
import { SESSION_UNFOLD, sessionUnfoldDelay, sessionUnfoldHeightMs } from './session-unfold'

const easing = Easing.bezier(...SESSION_UNFOLD.easing)

export function sessionRowEntering(index: number) {
  return FadeInDown
    .duration(SESSION_UNFOLD.rowInMs)
    .delay(sessionUnfoldDelay(index))
    .easing(easing)
    .withInitialValues({ opacity: 0, transform: [{ translateY: SESSION_UNFOLD.translateY }] })
    .reduceMotion(ReduceMotion.System)
}

export const sessionRowExiting = FadeOut
  .duration(SESSION_UNFOLD.rowOutMs)
  .reduceMotion(ReduceMotion.System)

export function sessionListLayout(collapsing: boolean) {
  return LinearTransition
    .duration(sessionUnfoldHeightMs(collapsing))
    .easing(easing)
    .reduceMotion(ReduceMotion.System)
}