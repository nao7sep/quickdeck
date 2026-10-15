import { useEffect, useRef, useState } from "react";
import type { TextCounts } from "../types";
import { countText, latestOnly } from "../services/textCounts";
import { logWarn, serializeError } from "../services/logger";

// The latest finished counts of a pane's text: null until the first arrives,
// "failed" when the newest count could not be made. The editor never waits.
export function useTextCounts(text: string): TextCounts | null | "failed" {
  const [counts, setCounts] = useState<TextCounts | null | "failed">(null);
  const mounted = useRef(true);
  const submit = useRef<((text: string) => void) | null>(null);
  if (submit.current === null) {
    submit.current = latestOnly(countText, (result) => {
      if (!mounted.current) return;
      if (result instanceof Error) {
        logWarn("pane count failed", { error: serializeError(result) });
        setCounts("failed");
      } else {
        setCounts(result);
      }
    });
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    submit.current?.(text);
  }, [text]);

  return counts;
}
