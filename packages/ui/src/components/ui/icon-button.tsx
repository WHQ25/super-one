"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip"

const iconButtonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "hover:bg-muted hover:text-foreground",
        ghost: "hover:text-foreground",
        destructive: "hover:bg-muted hover:text-destructive",
        nested: "hover:text-foreground",
      },
      size: {
        xs: "size-5 [&_svg:not([class*='size-'])]:size-3",
        sm: "size-6 [&_svg:not([class*='size-'])]:size-3.5",
        md: "size-7 [&_svg:not([class*='size-'])]:size-4",
        lg: "size-8 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  }
)

interface IconButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof iconButtonVariants> {
  tooltip?: React.ReactNode
  tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"]
  tooltipAlign?: React.ComponentProps<typeof TooltipContent>["align"]
  tooltipSideOffset?: number
  tooltipDelayDuration?: number
}

function IconButton({
  className,
  variant,
  size,
  tooltip,
  tooltipSide = "top",
  tooltipAlign,
  tooltipSideOffset = 6,
  tooltipDelayDuration = 300,
  type = "button",
  ...props
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      data-slot="icon-button"
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    />
  )

  if (tooltip == null) return button

  return (
    <TooltipProvider delayDuration={tooltipDelayDuration}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent
          side={tooltipSide}
          align={tooltipAlign}
          sideOffset={tooltipSideOffset}
        >
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export { IconButton, iconButtonVariants }
export type { IconButtonProps }
