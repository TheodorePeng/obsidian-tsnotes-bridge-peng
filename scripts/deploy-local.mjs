import { mkdir, mkdtemp, copyFile, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createHash } from "node:crypto";
const vault = join(
  homedir(),
  "Library/Mobile Documents/iCloud~md~obsidian/Documents/Math Peng",
);
const dest = join(vault, ".obsidian/plugins/tsnotes-bridge-peng");
const backup = await mkdtemp(join(tmpdir(), "tsnotes-bridge-backup-"));
const hashes = {};
for (const name of ["main.js", "manifest.json", "styles.css", "data.json"]) {
  try {
    const bytes = await readFile(join(dest, name));
    hashes[name] = createHash("sha256").update(bytes).digest("hex");
    await copyFile(join(dest, name), join(backup, name));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
await writeFile(join(backup, "baseline.json"), JSON.stringify(hashes), {
  mode: 0o600,
});
await mkdir(dest, { recursive: true });
for (const name of ["main.js", "manifest.json"]) {
  await stat(name);
  await copyFile(name, join(dest, name));
}
for (const name of ["main.js", "manifest.json"]) {
  const source = await readFile(name), installed = await readFile(join(dest, name));
  if(!source.equals(installed))throw Error("deployed_artifact_mismatch");
}
if(hashes["data.json"] && createHash("sha256").update(await readFile(join(dest,"data.json"))).digest("hex")!==hashes["data.json"])throw Error("settings_changed_during_deployment");
console.log(
  JSON.stringify({ deployedTo: dest, backup, settingsPreserved: true }),
);
