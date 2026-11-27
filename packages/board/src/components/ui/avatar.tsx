"use client"

import {
  Avatar as AvatarPrimitive,
  AvatarFallback as AvatarFallbackPrimitive,
  AvatarImage as AvatarImagePrimitive,
} from "@ui-sdk/react/avatar"
import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"

import { cnState } from "@/lib/utils"

const avatarVariants = cva("relative flex shrink-0 overflow-hidden rounded-full select-none", {
  variants: {
    size: {
      xs: "size-5 text-(length:--avatar-text-xs,0.625rem)",
      sm: "size-6 text-xs",
      default: "size-8 text-sm",
      lg: "size-10 text-base",
    },
  },
  defaultVariants: { size: "default" },
})

type AvatarProps = ComponentProps<typeof AvatarPrimitive> & VariantProps<typeof avatarVariants>

function Avatar({ className, size, ...props }: AvatarProps) {
  return (
    <AvatarPrimitive
      data-size={size ?? "default"}
      className={cnState(avatarVariants({ size }), className)}
      {...props}
    />
  )
}

function AvatarImage({ className, ...props }: ComponentProps<typeof AvatarImagePrimitive>) {
  return <AvatarImagePrimitive className={cnState("aspect-square size-full object-cover", className)} {...props} />
}

function AvatarFallback({ className, ...props }: ComponentProps<typeof AvatarFallbackPrimitive>) {
  return (
    <AvatarFallbackPrimitive
      className={cnState(
        "flex size-full items-center justify-center rounded-full bg-muted font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarFallback, AvatarImage, avatarVariants }
export type { AvatarProps }
