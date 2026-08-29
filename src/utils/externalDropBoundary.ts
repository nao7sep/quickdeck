import { isEditableTarget } from "./shortcuts";

/** Tauri's configured native interception owns OS file delivery. This secondary
 * renderer boundary refuses any external file or URL drop that still reaches
 * the DOM while retaining native non-file text editing. */
export function denyUnhandledExternalDrop(event: DragEvent): void {
  if (event.defaultPrevented) return;
  const hasFiles = Array.from(event.dataTransfer?.types ?? []).includes("Files") ||
    Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === "file");
  if (!hasFiles && isEditableTarget(event.target as HTMLElement | null)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
}
