// Pane ids are persisted user data. React accepts any string as a key, but DOM
// `id` / ARIA IDREF values must contain no ASCII whitespace. Encode the complete
// persisted id once and use these helpers at both ends of each relationship so
// hand-edited or older ids cannot split into multiple IDREF tokens.
function paneDomIdFragment(paneId: string): string {
  return encodeURIComponent(paneId);
}

export function paneTabDomId(paneId: string): string {
  return `pane-tab-${paneDomIdFragment(paneId)}`;
}

export function panePanelDomId(paneId: string): string {
  return `pane-panel-${paneDomIdFragment(paneId)}`;
}
