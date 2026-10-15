// Counts a pane's text off the UI thread, so typing in a very large pane never
// waits for the word split or the X parse (src/services/textCounts.ts).
import { getTextCounts } from "../utils/counts";

type Request = { id: number; text: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ id: data.id, counts: getTextCounts(data.text) });
  } catch (error) {
    scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
