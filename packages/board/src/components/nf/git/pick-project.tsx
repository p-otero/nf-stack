import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

function PickProject() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Pick a project</EmptyTitle>
        <EmptyDescription>
          The Git tab reads one project's workspace. Choose a project above; “All projects” spans
          several and has no repositories of its own.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export { PickProject };
