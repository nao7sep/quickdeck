import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Windows installer configuration", () => {
  const tauriDir = join(process.cwd(), "src-tauri");
  const config = JSON.parse(readFileSync(join(tauriDir, "tauri.conf.json"), "utf8"));
  const nsis = config.bundle?.windows?.nsis;

  it("allows current-user and all-users installation", () => {
    expect(nsis?.installMode).toBe("both");
  });

  it.each(["installerIcon", "uninstallerIcon"])("uses the app icon for %s", (field) => {
    const icon = nsis?.[field];
    expect(icon).toMatch(/\.ico$/i);
    expect(existsSync(join(tauriDir, icon))).toBe(true);
  });
});
