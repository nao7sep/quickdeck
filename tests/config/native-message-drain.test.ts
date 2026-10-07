// @vitest-environment node
// These source-level wiring checks do not exercise a Win32 session.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("checks settlement and deadline before taking each Windows message", () => {
  const source = readFileSync(new URL("../../src-tauri/src/quit.rs", import.meta.url), "utf8");
  const drain = source.slice(source.indexOf("MsgWaitForMultipleObjects(", source.indexOf("fn pump_until_saved")));
  const inner = drain.slice(drain.indexOf("loop {"));
  const fetch = inner.indexOf("PeekMessageW(");
  expect(fetch).toBeGreaterThan(-1);
  expect(inner.slice(0, fetch)).toContain("saved.try_recv()");
  expect(inner.slice(0, fetch)).toContain("Instant::now() >= deadline");
  expect(inner.indexOf("PostQuitMessage(")).toBeGreaterThan(fetch);
  expect(inner.indexOf("DispatchMessageW(")).toBeGreaterThan(fetch);
});
