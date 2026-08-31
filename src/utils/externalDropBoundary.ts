import { isEditableTarget } from "./shortcuts";

/** The renderer owns external drag transport so the webview can preserve its
 * native textarea text/link editing on every platform. Refuse files everywhere
 * and any other unowned drop outside an editable surface. */
export function denyUnhandledExternalDrop(event: DragEvent): void {
  if (event.defaultPrevented) return;
  const hasFiles = Array.from(event.dataTransfer?.types ?? []).includes("Files") ||
    Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === "file");
  if (!hasFiles && isEditableTarget(event.target as HTMLElement | null)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
}
