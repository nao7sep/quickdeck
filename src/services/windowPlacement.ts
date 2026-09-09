// Tauri reports physical outer bounds; setSize takes physical client dimensions.
import { isTauri } from "@tauri-apps/api/core";
import { availableMonitors, getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { logWarn, serializeError } from "./logger";
export type WindowPlacementMode = "normal" | "maximized";
export type WindowBounds = { x: number; y: number; width: number; height: number };
export type WindowPlacementRecord = { normalBounds: WindowBounds | null; mode: WindowPlacementMode };

type MonitorRect = {
  workArea: { position: { x: number; y: number }; size: { width: number; height: number } };
};
const DEBOUNCE_MS = 400;
let flushPlacement: (() => Promise<void>) | null = null;
const report = (operation: string, error: unknown) =>
  logWarn(operation, { error: serializeError(error) });

function parseWindowBounds(value: unknown): WindowBounds | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const values = [record.x, record.y, record.width, record.height];
  if (!values.every((value) => typeof value === "number" && Number.isSafeInteger(value))) return null;
  const [x, y, width, height] = values as number[];
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}


export function normalizeWindowPlacement(value: unknown): WindowPlacementRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  return {
    normalBounds: parseWindowBounds(source.normalBounds),
    mode: source.mode === "maximized" ? "maximized" : "normal",
  };
}

export function restorableBounds(
  saved: WindowBounds | null,
  monitors: readonly MonitorRect[],
): WindowBounds | null {
  const bounds = parseWindowBounds(saved);
  if (!bounds) return null;
  // Raw Tauri setters do not recover an unavailable monitor. Fit an
  // intersecting work area; otherwise leave the designed placement alone.
  const area = monitors.find(({ workArea: area }) =>
    bounds.x < area.position.x + area.size.width && bounds.x + bounds.width > area.position.x
    && bounds.y < area.position.y + area.size.height && bounds.y + bounds.height > area.position.y,
  )?.workArea;
  if (!area) return null;
  const width = Math.min(bounds.width, area.size.width);
  const height = Math.min(bounds.height, area.size.height);
  return {
    x: Math.max(area.position.x, Math.min(bounds.x, area.position.x + area.size.width - width)),
    y: Math.max(area.position.y, Math.min(bounds.y, area.position.y + area.size.height - height)),
    width,
    height,
  };
}

export function settledWindowPlacement(
  previous: WindowPlacementRecord,
  snapshot: { bounds: WindowBounds | null; minimized: boolean; fullscreen: boolean; maximized: boolean },
): WindowPlacementRecord {
  if (snapshot.minimized || snapshot.fullscreen) return previous;
  return snapshot.maximized
    ? { normalBounds: previous.normalBounds, mode: "maximized" }
    : { normalBounds: snapshot.bounds ?? previous.normalBounds, mode: "normal" };
}


export function resolveWindowRestoration(
  saved: WindowPlacementRecord | null,
  monitors: readonly MonitorRect[],
): WindowPlacementRecord {
  return {
    normalBounds: restorableBounds(saved?.normalBounds ?? null, monitors),
    mode: saved?.mode ?? "maximized",
  };
}

// The official window-state plugin captures fullscreen geometry even when its
// FULLSCREEN restore flag is off, and overwrites the preceding maximized mode.
// Keep this local owner until its update_state preserves those transient states.
export async function initializeMainWindowPlacement(
  saved: WindowPlacementRecord | null,
  persist: (record: WindowPlacementRecord) => Promise<void>,
): Promise<void> {
  if (!isTauri() || flushPlacement) return;
  const win = getCurrentWindow();
  // Windows requires a visible HWND before positioning or maximizing.
  await win.show();
  const readBounds = async () => {
    const [position, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
    return { x: position.x, y: position.y, width: size.width, height: size.height };
  };
  const snapshot = async () => {
    const [minimized, fullscreen, maximized] = await Promise.all([
      win.isMinimized(), win.isFullscreen(), win.isMaximized(),
    ]);
    return {
      bounds: minimized || fullscreen || maximized ? null : await readBounds().catch((error) => {
        report("read normal window bounds", error);
        return null;
      }),
      minimized, fullscreen, maximized,
    };
  };
  let record: WindowPlacementRecord = {
    normalBounds: saved?.normalBounds ?? null,
    mode: saved?.mode ?? "maximized",
  };
  // Geometry is best effort; a failed read or setter must not skip saved mode.
  try {
    const opening = await readBounds();
    record.normalBounds = opening;
    const openingInnerSize = await win.innerSize();
    const bounds = restorableBounds(saved?.normalBounds ?? null, await availableMonitors());
    if (bounds) {
      try {
        // Measure the frame after moving so it uses the destination display's DPI.
        await win.setPosition(new PhysicalPosition(bounds.x, bounds.y));
        const [outer, inner] = await Promise.all([win.outerSize(), win.innerSize()]);
        await win.setSize(new PhysicalSize(
          Math.max(1, bounds.width - Math.max(0, outer.width - inner.width)),
          Math.max(1, bounds.height - Math.max(0, outer.height - inner.height)),
        ));
      } catch (error) {
        report("restore window bounds", error);
        await win.setPosition(new PhysicalPosition(opening.x, opening.y));
        await win.setSize(openingInnerSize);
      }
    }
    record.normalBounds = await readBounds();
  } catch (error) {
    report("restore normal window placement", error);
  }
  if (record.mode === "maximized") {
    try {
      // Yield once after show; Windows drops a maximize during HWND creation.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await win.maximize();
    } catch (error) {
      report("restore maximized window", error);
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let eventTail = Promise.resolve();
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  const saveSnapshot = async () => {
    try {
      record = settledWindowPlacement(record, await snapshot());
    } catch (error) {
      report("capture window placement", error);
    }
    await persist(record);
  };
  const inspect = async () => {
    const current = await snapshot();
    cancel();
    if (current.minimized || current.fullscreen) return;
    record = settledWindowPlacement(record, current);
    if (current.maximized) {
      await persist(record);
    } else {
      timer = setTimeout(() => {
        timer = undefined;
        eventTail = eventTail.then(saveSnapshot).catch((error) => report("save window placement", error));
      }, DEBOUNCE_MS);
    }
  };
  const enqueueInspect = () => {
    eventTail = eventTail.then(inspect).catch((error) => report("inspect window placement", error));
  };
  // Startup geometry has completed before ordinary events acquire persistence.
  for (const register of [win.onMoved.bind(win), win.onResized.bind(win)]) {
    try {
      await register(enqueueInspect);
    } catch (error) {
      report("listen for window placement", error);
    }
  }
  flushPlacement = async () => {
    cancel();
    await eventTail;
    cancel();
    await saveSnapshot();
  };
}

export async function flushMainWindowPlacement(): Promise<void> {
  await flushPlacement?.();
}

export async function showMainWindowWithoutPlacement(): Promise<void> {
  if (isTauri()) await getCurrentWindow().show();
}
