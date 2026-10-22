import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
export interface LocalState {
  vaultId: string;
  secret: string;
  port: number;
  origin: string;
  browserBundle: string;
}
export async function loadLocalState(
  vaultPath: string,
  knownVaultId?: string,
  stateDirectory?: string,
): Promise<{ state: LocalState; save: () => Promise<void> }> {
  const dir =
    stateDirectory ||
    join(homedir(), "Library", "Application Support", "TSNotes Bridge Peng");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const legacyFile = join(
    dir,
    createHash("sha256").update(vaultPath).digest("hex") + ".json",
  );
  if (knownVaultId && !/^[a-f0-9-]{36}$/.test(knownVaultId))
    throw Error("invalid_vault_identity");
  let file = knownVaultId ? join(dir, knownVaultId + ".json") : legacyFile;
  let state: LocalState;
  try {
    try {
      state = JSON.parse(await readFile(file, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT" || file === legacyFile)
        throw e;
      state = JSON.parse(await readFile(legacyFile, "utf8"));
    }
    if (knownVaultId && state.vaultId !== knownVaultId)
      throw Error("vault_pairing_identity_conflict");
    if (!state.vaultId || !/^[a-f0-9]{64}$/.test(state.secret))
      throw Error("invalid_local_pairing");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    state = {
      vaultId: knownVaultId || randomUUID(),
      secret: randomBytes(32).toString("hex"),
      port: 0,
      origin: "",
      browserBundle: "com.citrolabs.ego.lite",
    };
  }
  file = join(dir, state.vaultId + ".json");
  const save = async () => {
    const tmp = file + ".tmp";
    await writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
    await rename(tmp, file);
  };
  await save();
  return { state, save };
}
