"use client"

import { renderElement, type PartProps } from "@ui-sdk/react/primitive"

import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/locale"
import { formatQuantity, type FormatQuantityOptions, type Quantity } from "@/lib/quantity"

type QuantityValueProps = Omit<PartProps<"span">, "children"> & FormatQuantityOptions & { value: Quantity }

function QuantityValue({ value, format, locale, labels, className, render, ...props }: QuantityValueProps) {
  const { text, srText, title, quality } = formatQuantity(value, { format, locale: useLocale(locale), labels })
  return renderElement(
    "span",
    {
      "data-slot": "quantity",
      "data-quality": quality,
      title,
      className: cn("tabular-nums data-[quality=unknown]:text-muted-foreground", className),
      ...props,
      children: (
        <>
          <span aria-hidden="true">{text}</span>
          <span className="sr-only">{srText}</span>
        </>
      ),
    },
    render,
  )
}

export { QuantityValue }
export type { QuantityValueProps }
