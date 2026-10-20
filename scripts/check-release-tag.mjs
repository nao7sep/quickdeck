// Fails unless RELEASE_TAG is "v" plus tauri.conf.json's version. The release
// workflow runs it as `npm run check:release-tag` before it builds a tagged release.
import { readFile } from "node:fs/promises";

const tauriConfig = JSON.parse(
  await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);
const expected = `v${tauriConfig.version}`;
const actual = process.env.RELEASE_TAG;

if (actual !== expected) {
  throw new Error(
    `Release tag must match tauri.conf.json: expected ${expected}, received ${actual ?? "nothing"}.`,
  );
}
