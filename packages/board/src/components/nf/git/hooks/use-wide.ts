import { useMediaQuery } from "@/components/nf/git/hooks/use-media-query";

const WIDE = "(min-width: 75rem)";

const useWide = (): boolean => useMediaQuery(WIDE);

export { useWide };
