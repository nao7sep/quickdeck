function isEditableTarget(target: EventTarget | null): boolean {
  return Boolean((target as Element | null)?.closest?.(
    "textarea, [contenteditable='true'], input:not([type]), input[type='text'], input[type='search'], input[type='url'], input[type='email'], input[type='number'], input[type='password'], input[type='tel']",
  ));
}

/** Refuse every external drop not already owned by a product target while
 * retaining native non-file text/link editing. */
export function denyUnhandledExternalDrop(event: DragEvent): void {
  if (event.defaultPrevented) return;
  const hasFiles = Array.from(event.dataTransfer?.types ?? []).includes("Files") ||
    Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === "file");
  if (!hasFiles && isEditableTarget(event.target)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
}
