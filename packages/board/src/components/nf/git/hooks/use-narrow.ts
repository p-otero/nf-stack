import { useMediaQuery } from "@/components/nf/git/hooks/use-media-query";

/** The `narrow` breakpoint in index.css: below it a diff's file tree cannot sit beside the diff. */
const NARROW = "(max-width: 47.5rem)";

const useNarrow = (): boolean => useMediaQuery(NARROW);

export { useNarrow };
