// A pane's colour, drawn the one way everywhere it stands for that pane: the
// zen pane switcher and the snapshot browser. A pane that no longer exists has
// no colour, so its swatch keeps the shape in a neutral fill.
export function PaneSwatch({ color }: { color?: string }) {
  return (
    <span
      className="paneSwatch"
      aria-hidden="true"
      style={color === undefined ? undefined : { background: color }}
    />
  );
}
