import { useCallback, useEffect, useRef, useState } from "react";

import {
  boardViewHref,
  NO_GIT_LOCATION,
  parseGitTabLocation,
  withoutGitLocation,
  type GitTabLocation,
} from "@/components/nf/git/git-model";

type Scoped = { project: string | null; location: GitTabLocation };

function useGitLocation(project: string | null): [GitTabLocation, (next: GitTabLocation) => void] {
  const [scoped, setScoped] = useState<Scoped>(() => ({
    project,
    location: parseGitTabLocation(window.location.search),
  }));
  if (scoped.project !== project) setScoped({ project, location: NO_GIT_LOCATION });

  const shown = useRef(project);
  useEffect(() => {
    if (shown.current === project) return;
    shown.current = project;
    history.replaceState(null, "", withoutGitLocation(window.location.href));
  }, [project]);

  const change = useCallback(
    (next: GitTabLocation) => {
      history.replaceState(null, "", boardViewHref(window.location.href, "git", next));
      setScoped({ project, location: next });
    },
    [project],
  );
  return [scoped.project === project ? scoped.location : NO_GIT_LOCATION, change];
}

export { useGitLocation };
