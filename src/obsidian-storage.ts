import { App, TFile, parseYaml, stringifyYaml } from "obsidian";
import { safePath, type Fields } from "./model";
import type { RecordStorage, Relation } from "./records";
export function storageFor(app: App): RecordStorage {
  const directory = async (path: string) => {
    const chunks = safePath(path).split("/");
    let current = "";
    for (const chunk of chunks) {
      current = current ? current + "/" + chunk : chunk;
      if (!app.vault.getAbstractFileByPath(current))
        await app.vault.createFolder(current);
    }
  };
  const relationPath = (path: string) => {
    safePath(path);
    if (!/\/_data\/playlists\/[a-f0-9-]{36}\.json$/.test(path))
      throw Error("invalid_relation_path");
  };
  return {
    verify: async (path, id) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw Error("document_missing");
      const raw = await app.vault.read(file),
        match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (!match) throw Error("invalid_frontmatter");
      const props = parseYaml(match[1]);
      if (!props || String(props.TSNotesID) !== id)
        throw Error("document_identity_changed");
    },
    exists: (path) => !!app.vault.getAbstractFileByPath(path),
    create: async (path, props) => {
      safePath(path);
      await directory(path.slice(0, path.lastIndexOf("/")));
      await app.vault.create(path, "---\n" + stringifyYaml(props) + "---\n");
    },
    update: async (path, change) => {
      safePath(path);
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw Error("document_missing");
      const before = await app.vault.read(file),
        match = before.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (!match) throw Error("invalid_frontmatter");
      const parsed = parseYaml(match[1]);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw Error("invalid_frontmatter");
      await app.fileManager.processFrontMatter(file, (props) => {
        if (String(props.TSNotesID) !== String(parsed.TSNotesID))
          throw Error("document_changed");
        change(props);
      });
    },
    readRelation: async (path) => {
      relationPath(path);
      if (!(await app.vault.adapter.exists(path))) return null;
      return JSON.parse(await app.vault.adapter.read(path)) as Relation;
    },
    writeRelation: async (path, value) => {
      relationPath(path);
      await directory(path.slice(0, path.lastIndexOf("/")));
      if (await app.vault.adapter.exists(path)) {
        const old = JSON.parse(await app.vault.adapter.read(path));
        if (
          old.version !== 1 ||
          old.playlistId !== value.playlistId ||
          old.sourceKey !== value.sourceKey
        )
          throw Error("relation_file_conflict");
      }
      await app.vault.adapter.write(
        path,
        JSON.stringify(value, null, 2) + "\n",
      );
    },
    open: async (path) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw Error("document_missing");
      await app.workspace.getLeaf(false).openFile(file, { active: true });
    },
  };
}
