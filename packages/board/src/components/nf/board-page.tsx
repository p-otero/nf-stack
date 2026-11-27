import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { boardHref, readBoard } from "@/board-data";
import type { BoardSession } from "@/board-data";
import { BoardError } from "@/components/nf/board-error";
import { BoardLoading } from "@/components/nf/board-loading";
import { BoardViews } from "@/components/nf/board-views";
import type { ReviewLive } from "@/components/nf/review-actions";

/** The query key's stand-in for every project, since a key is `["board", project]`. */
const ALL_PROJECTS = "all";

function BoardPage({ session }: { session: BoardSession }) {
  const live = session.kind === "live";
  const api = session.kind === "live" ? session.api : undefined;
  const channel = useMemo(
    () =>
      session.kind === "live" ? { actions: session.actions, token: session.token } : undefined,
    [session],
  );
  const [project, setProject] = useState(session.kind === "live" ? session.project : null);
  const queryClient = useQueryClient();
  const { data, error, refetch } = useQuery({
    queryKey: ["board", project ?? ALL_PROJECTS],
    queryFn: api === undefined ? undefined : () => readBoard(api, project),
    initialData: session.kind === "snapshot" ? session.snapshot : undefined,
    enabled: live,
    refetchInterval: live ? 5000 : false,
    refetchIntervalInBackground: false,
  });
  const onDecided = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["board"] });
  }, [queryClient]);
  const review = useMemo<ReviewLive | undefined>(
    () => (channel === undefined ? undefined : { channel, onDecided }),
    [channel, onDecided],
  );
  const changeProject = (next: string | null) => {
    history.replaceState(null, "", boardHref(window.location.href, next));
    setProject(next);
  };
  if (data === undefined) {
    return error === null ? (
      <BoardLoading />
    ) : (
      <BoardError message={error.message} onRetry={() => void refetch()} />
    );
  }
  return (
    <BoardViews
      data={data}
      project={project}
      projects={data.projects}
      live={live}
      api={api}
      review={review}
      onProjectChange={live ? changeProject : undefined}
    />
  );
}

export { BoardPage };
