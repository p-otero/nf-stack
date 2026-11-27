import type { BoardProject } from "@/board-data";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** The empty value stands for "every project", as the board primitive's filter uses it. */
const ALL_PROJECTS = "";

function ProjectSelect({
  projects,
  value,
  onChange,
}: {
  projects: readonly BoardProject[];
  value: string | null;
  onChange: (project: string | null) => void;
}) {
  const items = [
    { value: ALL_PROJECTS, label: "All projects" },
    ...projects.map((project) => ({
      value: project.prefix,
      label: `${project.prefix} · ${project.name}`,
    })),
  ];
  return (
    <Field className="max-w-72 min-w-52">
      <FieldLabel>Project</FieldLabel>
      <Select
        items={items}
        value={value ?? ALL_PROJECTS}
        onValueChange={(next) => onChange(next === ALL_PROJECTS ? null : next)}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              <span className="min-w-0 truncate">{item.label}</span>
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export { ProjectSelect };
