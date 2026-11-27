import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";

import { Appearance, createAppearance } from "@/components/ui/appearance";
import { BoardPage } from "@/components/nf/board-page";
import { ColorSchemeProvider } from "@/components/nf/color-scheme-provider";
import { boardSession, parseBoardData, parseBoardSource } from "@/board-data";

const snapshot = parseBoardData(document.getElementById("board-data")?.textContent);
const source = parseBoardSource(document.getElementById("board-source")?.textContent);
const session = boardSession(snapshot, source, window.location.search);
const root = document.getElementById("root");
if (session === null || root === null)
  throw new Error("nf board: the page is missing its board data or root element.");

const appearance = createAppearance({ colorScheme: "system", theme: "glass" });
appearance.apply();

// A failed poll is shown at once; the page still refetches on the interval, so `Retry` is optional.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <Appearance appearance={appearance}>
      <ColorSchemeProvider appearance={appearance}>
        <main className="flex flex-col gap-surface bg-background p-surface text-foreground">
          <BoardPage session={session} />
        </main>
      </ColorSchemeProvider>
    </Appearance>
  </QueryClientProvider>,
);
