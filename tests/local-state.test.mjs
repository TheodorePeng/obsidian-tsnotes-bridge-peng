import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const b = await build({
  entryPoints: ["src/local-state.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const mod = { exports: {} };
new Function("require", "module", "exports", b.outputFiles[0].text)(
  createRequire(import.meta.url),
  mod,
  mod.exports,
);
const { loadLocalState } = mod.exports;
test("stable Vault identity survives path moves; secrets stay machine local with owner-only mode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tsnotes-state-test-"));
  try {
    const first = await loadLocalState("/test/original", undefined, dir);
    first.state.port = 54321;
    first.state.browserBindings={"com.citrolabs.ego.lite":"11111111-1111-4111-8111-111111111111"};
    await first.save();
    const moved = await loadLocalState("/test/moved", first.state.vaultId, dir);
    assert.equal(moved.state.vaultId, first.state.vaultId);
    assert.equal(moved.state.secret, first.state.secret);
    assert.equal(moved.state.port, 54321);
    assert.deepEqual(moved.state.browserBindings,first.state.browserBindings);
    assert.equal(
      (await stat(join(dir, first.state.vaultId + ".json"))).mode & 0o777,
      0o600,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
