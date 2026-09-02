import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-08-23",
  category: "feature",
  version: "0.57.2-alpha",
  title: {
    en: "Drive an iOS Simulator, an Android device, or your mirrored iPhone",
    zh: "操作 iOS 模拟器、Android 设备,或投屏中的 iPhone",
  },
  summary: {
    en: "One device seam covers iOS Simulator, Android emulators and phones, and the mirrored iPhone — with a shared catalog, a control grant, and a floating preview that doubles as the agent's viewfinder.",
    zh: "一道设备接缝覆盖 iOS 模拟器、Android 模拟器与真机、以及投屏中的 iPhone —— 共享目录、控制授权,加上一个同时充当 agent 取景器的浮动预览。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.68 0.15 160)",
    to: "oklch(0.64 0.16 210)",
    accent: "oklch(0.86 0.13 185)",
  },
  tags: ["device", "ios-simulator", "android"],
}
