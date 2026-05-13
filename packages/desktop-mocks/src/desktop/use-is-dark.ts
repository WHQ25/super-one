import { useState, useEffect } from "react"

export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  )
  useEffect(() => {
    if (typeof document === "undefined") return
    const root = document.documentElement
    setIsDark(root.classList.contains("dark"))
    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains("dark"))
    })
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  return isDark
}
