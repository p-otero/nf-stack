"use client"

import type { ChangeDetails } from "@ui-sdk/core"
import { SelectItemText, type SelectValueChangeReason } from "@ui-sdk/react/select"
import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { GitBranchChip } from "@/components/ui/git-chip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectTrigger,
  SelectValue,
  type SelectProps,
  type SelectSize,
  type SelectTriggerProps,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

/** A git checkout to pick: what tells it apart from the others at a glance. */
type Repository = {
  /** Identifies it; the select's value. */
  value: string
  /** What the trigger shows and typeahead matches: "api", "tools/cli". */
  name: string
  /** Where it lives, shown beside the name in the list: "~/work/acme/api". */
  path?: string
  branch?: string
  /** Files with uncommitted changes. */
  uncommitted?: number
  /** Commits on the branch its upstream doesn't have, and the other way round; `null` without an upstream. */
  ahead?: number | null
  behind?: number | null
  /** `false` for a repository with no remote at all. */
  remote?: boolean
  disabled?: boolean
}

type RepositorySelectLabels = {
  uncommitted: (count: number) => string
  ahead: (count: number) => string
  behind: (count: number) => string
  noRemote: string
  /** Shown when nothing is uncommitted, ahead or behind. */
  upToDate: string
}

const repositorySelectLabels: RepositorySelectLabels = {
  uncommitted: (count) => `${String(count)} uncommitted`,
  ahead: (count) => `${String(count)} ahead`,
  behind: (count) => `${String(count)} behind`,
  noRemote: "No remote",
  upToDate: "Up to date",
}

type RepositorySelectProps = {
  /** The chosen repository's `value`. */
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (value: string | null, details: ChangeDetails<SelectValueChangeReason>) => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: SelectProps<string>["onOpenChange"]
  disabled?: boolean
  name?: string
  repositories: readonly Repository[]
  /** Names the trigger when no `FieldLabel` does. */
  "aria-label"?: string
  /** `sm` for a header or toolbar, like CommitHistory's `headerStart`. */
  size?: SelectSize
  labels?: Partial<RepositorySelectLabels>
  triggerProps?: Omit<SelectTriggerProps, "children">
  contentClassName?: string
}

function RepositoryState({ repository, labels }: { repository: Repository; labels: RepositorySelectLabels }) {
  const { uncommitted = 0, ahead, behind, remote } = repository
  const badges: ReactNode[] = []
  if (uncommitted > 0)
    badges.push(
      <Badge key="uncommitted" tone="warning">
        {labels.uncommitted(uncommitted)}
      </Badge>,
    )
  if (ahead != null && ahead > 0)
    badges.push(
      <Badge key="ahead" tone="info">
        {labels.ahead(ahead)}
      </Badge>,
    )
  if (behind != null && behind > 0)
    badges.push(
      <Badge key="behind" variant="outline">
        {labels.behind(behind)}
      </Badge>,
    )
  if (remote === false)
    badges.push(
      <Badge key="remote" variant="secondary">
        {labels.noRemote}
      </Badge>,
    )
  if (badges.length === 0 && remote !== undefined)
    badges.push(
      <Badge key="synced" tone="success">
        {labels.upToDate}
      </Badge>,
    )
  return badges
}

/**
 * One git repository out of several, on UI SDK's Select: the trigger shows the name, and each option the name, its
 * path, the branch checked out and its state (uncommitted files, ahead and behind its upstream, no remote). Arrows,
 * typeahead by name and agents work as in any select.
 */
function RepositorySelect({
  repositories,
  labels: labelOverrides,
  size,
  "aria-label": label,
  triggerProps,
  contentClassName,
  ...props
}: RepositorySelectProps) {
  const labels = { ...repositorySelectLabels, ...labelOverrides }
  const items = repositories.map((repository) => ({
    value: repository.value,
    label: repository.name,
    disabled: repository.disabled,
  }))
  return (
    <Select<string> {...props} items={items}>
      <SelectTrigger aria-label={label} size={size} {...triggerProps}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className={cn("min-w-96", contentClassName)}>
        {repositories.map((repository) => (
          <SelectItem
            key={repository.value}
            value={repository.value}
            label={repository.name}
            disabled={repository.disabled}
            className="items-start py-inset-item"
          >
            <span data-slot="repository-option" className="flex min-w-0 flex-1 flex-col gap-inline">
              <span className="flex min-w-0 items-baseline gap-inline">
                <SelectItemText className="font-medium">{repository.name}</SelectItemText>
                {repository.path === undefined ? null : (
                  <span className="truncate font-mono text-caption text-muted-foreground">{repository.path}</span>
                )}
              </span>
              <span className="flex flex-wrap items-center gap-inline">
                {repository.branch === undefined ? null : <GitBranchChip name={repository.branch} />}
                <RepositoryState repository={repository} labels={labels} />
              </span>
            </span>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export { RepositorySelect, repositorySelectLabels }
export type { Repository, RepositorySelectLabels, RepositorySelectProps }
