import { isTauri } from "@tauri-apps/api/core";
import {
  availableMonitors,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";

export type WindowPlacementMode = "normal" | "maximized";
export type WindowBounds = { x: number; y: number; width: number; height: number };
export type WindowPlacementRecord = { normalBounds: WindowBounds | null; mode: WindowPlacementMode };

const DEBOUNCE_MS = 400;
type MonitorWorkArea = {
  workArea: { position: { x: number; y: number }; size: { width: number; height: number } };
  scaleFactor: number;
};
let suppression = 0;
let flushPlacement: (() => Promise<void>) | null = null;

export function normalizeWindowPlacement(value: unknown): WindowPlacementRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const mode: WindowPlacementMode = source.mode === "maximized" ? "maximized" : "normal";
  const raw = source.normalBounds;
  if (raw === null) return { normalBounds: null, mode };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { normalBounds: null, mode };
  const bounds = raw as Record<string, unknown>;
  const values = [bounds.x, bounds.y, bounds.width, bounds.height];
  if (!values.every((item) => typeof item === "number" && Number.isFinite(item))) {
    return { normalBounds: null, mode };
  }
  return { normalBounds: bounds as WindowBounds, mode };
}

export function usableWindowBounds(
  bounds: WindowBounds,
  minimum: { width: number; height: number },
  monitors: readonly MonitorWorkArea[],
): boolean {
  const values = [bounds.x, bounds.y, bounds.width, bounds.height];
  if (!values.every(Number.isFinite) || !values.every(Number.isInteger)) return false;
  return monitors.some((monitor) => {
    const area = monitor.workArea;
    return bounds.width >= Math.ceil(minimum.width * monitor.scaleFactor)
      && bounds.height >= Math.ceil(minimum.height * monitor.scaleFactor)
      && bounds.x >= area.position.x && bounds.y >= area.position.y
      && bounds.x + bounds.width <= area.position.x + area.size.width
      && bounds.y + bounds.height <= area.position.y + area.size.height;
  });
}

export function resolveWindowRestoration(
  saved: WindowPlacementRecord | null,
  minimum: { width: number; height: number },
  monitors: readonly MonitorWorkArea[],
): WindowPlacementRecord {
  return {
    normalBounds: saved?.normalBounds && usableWindowBounds(saved.normalBounds, minimum, monitors)
      ? { ...saved.normalBounds }
      : null,
    mode: saved?.mode === "normal" || saved?.mode === "maximized" ? saved.mode : "maximized",
  };
}

export function settledWindowPlacement(
  previous: WindowPlacementRecord,
  snapshot: {
    bounds: WindowBounds;
    minimized: boolean;
    fullscreen: boolean;
    maximized: boolean;
  },
): WindowPlacementRecord {
  if (snapshot.minimized || snapshot.fullscreen) {
    return { normalBounds: previous.normalBounds ? { ...previous.normalBounds } : null, mode: previous.mode };
  }
  if (snapshot.maximized) {
    return { normalBounds: previous.normalBounds ? { ...previous.normalBounds } : null, mode: "maximized" };
  }
  return { normalBounds: { ...snapshot.bounds }, mode: "normal" };
}

export async function withWindowPlacementSuppressed<T>(operation: () => Promise<T>): Promise<T> {
  suppression += 1;
  try { return await operation(); } finally { suppression -= 1; }
}

export async function initializeMainWindowPlacement(
  saved: WindowPlacementRecord | null,
  minimum: { width: number; height: number },
  persist: (record: WindowPlacementRecord) => Promise<void>,
): Promise<void> {
  if (!isTauri() || flushPlacement) return;
  const win = getCurrentWindow();
  const monitors = await availableMonitors();
  const restoration = resolveWindowRestoration(saved, minimum, monitors);
  const [openingPosition, openingSize] = await Promise.all([win.outerPosition(), win.outerSize()]);
  if (restoration.normalBounds) {
    const bounds = restoration.normalBounds;
    try {
      await withWindowPlacementSuppressed(async () => {
        await win.setSize(new PhysicalSize(bounds.width, bounds.height));
        await win.setPosition(new PhysicalPosition(bounds.x, bounds.y));
      });
      const [position, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
      if (position.x !== bounds.x || position.y !== bounds.y || size.width !== bounds.width || size.height !== bounds.height) {
        throw new Error("Tauri adjusted the restored window bounds");
      }
    } catch {
      await withWindowPlacementSuppressed(async () => {
        await win.setSize(openingSize);
        await win.setPosition(openingPosition);
      });
    }
  }

  const [normalPosition, normalSize] = await Promise.all([win.outerPosition(), win.outerSize()]);
  let normalBounds: WindowBounds = {
    x: normalPosition.x, y: normalPosition.y, width: normalSize.width, height: normalSize.height,
  };
  let mode = restoration.mode;
  let enabled = false;
  let transient = false;
  let timer: number | undefined;
  let eventQueue = Promise.resolve();

  const cancel = () => { if (timer !== undefined) window.clearTimeout(timer); timer = undefined; };
  const save = () => persist({ normalBounds: { ...normalBounds }, mode });
  const inspect = async () => {
    if (!enabled || suppression > 0) return;
    const [minimized, fullscreen, maximized] = await Promise.all([
      win.isMinimized(), win.isFullscreen(), win.isMaximized(),
    ]);
    if (minimized || fullscreen) { transient = true; cancel(); return; }
    if (maximized) {
      transient = false; cancel();
      if (mode !== "maximized") { mode = "maximized"; await save(); }
      return;
    }
    cancel();
    transient = false;
    timer = window.setTimeout(() => {
      timer = undefined;
      eventQueue = eventQueue.then(async () => {
        if (!enabled || suppression > 0 || await win.isMinimized() || await win.isFullscreen() || await win.isMaximized()) return;
        const [position, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
        normalBounds = { x: position.x, y: position.y, width: size.width, height: size.height };
        mode = "normal";
        await save();
      }).catch(() => {});
    }, DEBOUNCE_MS);
  };
  const enqueueInspect = () => { eventQueue = eventQueue.then(inspect).catch(() => {}); };
  await Promise.all([win.onMoved(enqueueInspect), win.onResized(enqueueInspect)]);

  flushPlacement = async () => {
    cancel();
    await eventQueue;
    if (!enabled) return;
    if (await win.isMaximized() && !await win.isMinimized() && !await win.isFullscreen()) mode = "maximized";
    await save();
  };
  if (restoration.mode === "maximized") await withWindowPlacementSuppressed(() => win.maximize());
  await win.show();
  await new Promise((resolve) => window.setTimeout(resolve, 500));
  enabled = true;
  transient = await win.isMinimized() || await win.isFullscreen();
  const maximized = await win.isMaximized();
  if (restoration.mode === "maximized" && !maximized) mode = "normal";
}

export async function showMainWindowWithoutPlacement(): Promise<void> {
  if (isTauri()) await getCurrentWindow().show();
}

export async function flushMainWindowPlacement(): Promise<void> {
  await flushPlacement?.();
}
