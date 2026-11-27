"use client"

import { createInputController } from "@ui-sdk/react/input"
import { createParts } from "@ui-sdk/react/primitive"
import { useState, type ComponentProps } from "react"
import { SearchIcon } from "lucide-react"

import { Input, InputClear, InputGroup } from "@/components/ui/input"
import { searchField, type SearchFieldOptions } from "@/components/ui/search-field-primitive"
import { cn } from "@/lib/utils"

const { Root: SearchFieldRoot } = createParts(searchField, { root: "div" })

type InputProps = ComponentProps<typeof Input>

type SearchFieldProps = {
  /** Accessible name for the search landmark and its input. */
  label: string
  clearLabel?: string
  value?: string
  defaultValue?: string
  onValueChange?: InputProps["onValueChange"]
  onSearch?: SearchFieldOptions["onSearch"]
  controller?: ReturnType<typeof createInputController>
  placeholder?: string
  name?: string
  disabled?: boolean
  className?: string
}

function SearchField({
  label,
  clearLabel = "Clear search",
  value,
  defaultValue,
  onValueChange,
  onSearch,
  controller,
  placeholder,
  name,
  disabled,
  className,
}: SearchFieldProps) {
  const [ownController] = useState(createInputController)
  const input = controller ?? ownController
  return (
    <SearchFieldRoot input={input} onSearch={onSearch} aria-label={label} className={cn("w-full", className)}>
      {/* UI SDK lists an input group as its own agent entry; naming it keeps every entry findable. */}
      <InputGroup render={<fieldset />} aria-label={label}>
        <SearchIcon />
        <Input
          type="search"
          controller={input}
          aria-label={label}
          value={value}
          defaultValue={defaultValue}
          onValueChange={onValueChange}
          placeholder={placeholder}
          name={name}
          disabled={disabled}
          className="[&::-webkit-search-cancel-button]:hidden"
        />
        <InputClear aria-label={clearLabel} />
      </InputGroup>
    </SearchFieldRoot>
  )
}

export { SearchField, SearchFieldRoot }
export type { SearchFieldProps }
