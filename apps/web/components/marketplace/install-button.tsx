"use client"

import { useState } from "react"
import { ArrowUpRight, Check, Copy } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@superone/ui/components/ui/button"

type Kind = "skill" | "mcp"

const NAMESPACE: Record<Kind, "Skills" | "Mcps"> = {
  skill: "Skills",
  mcp: "Mcps",
}

export function InstallButton({
  kind,
  slug,
  size = "default",
}: {
  kind: Kind
  slug: string
  size?: "sm" | "default" | "lg"
}) {
  const t = useTranslations(NAMESPACE[kind])
  const deepLink = `superone://install/${kind}/${slug}`

  return (
    <Button
      asChild
      size={size}
      className="bg-foreground text-background hover:bg-foreground/90 rounded-full font-medium"
    >
      <a href={deepLink}>
        {t("install")}
        <ArrowUpRight className="ml-0.5 size-4" />
      </a>
    </Button>
  )
}

export function CopyConfigButton({ value }: { value: string }) {
  const t = useTranslations("Mcps")
  const [copied, setCopied] = useState(false)

  return (
    <Button
      variant="outline"
      size="sm"
      className="rounded-full"
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {t("detail.configCopy")}
    </Button>
  )
}
