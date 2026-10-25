import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
const b = await build({
  entryPoints: ["src/records.ts"],
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
const { RecordService } = mod.exports;
function fixture() {
  const files = new Map(),
    relations = new Map();
  let opens = 0;
  const storage = {
    verify: async (p, id) => {
      assert.equal(files.get(p)?.props.TSNotesID, id);
    },
    exists: (p) =>
      files.has(p) ||
      [...files.keys()].some((path) => path.startsWith(p + "/")),
    create: async (p, props, body = "") => {
      assert(!files.has(p));
      files.set(p, { props: structuredClone(props), body });
    },
    update: async (p, change) => {
      change(files.get(p).props);
    },
    readRelation: async (p) => structuredClone(relations.get(p) || null),
    writeRelation: async (p, v) => {
      relations.set(p, structuredClone(v));
    },
    open: async () => {
      opens++;
    },
  };
  return {
    service: new RecordService(storage),
    files,
    relations,
    storage,
    get opens() {
      return opens;
    },
  };
}
const video = (id = "abcdefghijk", playlist) => ({
  site: "youtube",
  mode: playlist ? "playlist_video" : "normal_video",
  record: {
    dedupeKey: playlist ? `yt:pv:${playlist}:${id}` : `yt:v:${id}`,
    fields: {
      title: "Video",
      videoId: id,
      url: `https://www.youtube.com/watch?v=${id}`,
      dedupeUrl: `https://www.youtube.com/watch?v=${id}`,
      urlTsnotes: `https://www.youtube.com/watch?v=${id}&type=TSNotes`,
      durationSec: 20,
      playlistIndex: 2,
    },
  },
  ...(playlist
    ? {
        parent: {
          dedupeKey: "yt:pl:" + playlist,
          fields: {
            title: "Playlist",
            playlistId: playlist,
            playlistVideoCount: 10,
            dedupeUrl: "https://www.youtube.com/playlist?list=" + playlist,
          },
        },
      }
    : {}),
});
test("one main note across playlists, move, duplicate preserves body and properties, explicit refresh", async () => {
  const f = fixture(),
    v = video();
  const first = await f.service.ensure(v),
    path = first.path;
  f.files.get(path).body = "Human body";
  f.files.get(path).props.Status = "Learning";
  v.record.fields.title = "Changed";
  await f.service.ensure(v);
  assert.equal(f.files.get(path).props.Title, undefined);
  assert.equal(f.files.get(path).body, "Human body");
  await f.service.ensure(video(undefined, "one"));
  await f.service.ensure(video(undefined, "two"));
  assert.equal(
    [...f.files.values()].filter((x) => x.props["Record Type"] === "video")
      .length,
    1,
  );
  assert.equal(f.relations.size, 2);
  const old = f.files.get(path);
  f.files.delete(path);
  f.files.set("Moved/Renamed.md", old);
  f.service.index.remove(path);
  f.service.index.set({
    path: "Moved/Renamed.md",
    props: structuredClone(old.props),
  });
  assert.equal((await f.service.ensure(v)).path, "Moved/Renamed.md");
  v.record.fields.durationSec = 35;
  const preview = await f.service.refresh(v);
  assert.equal(preview.changes.Duration, "00:35");
  assert.equal(preview.changes.Title, undefined);
  assert.equal(old.props.Title, undefined);
  assert.equal(old.props.Duration, "00:20");
  await f.service.refresh(v, true, preview);
  assert.equal(old.props.Title, undefined);
  assert.equal(old.props.Duration, "00:35");
  assert.equal(old.props.Status, "Learning");
  assert.equal(old.body, "Human body");
  assert.equal(old.props.TSNotesID, first.documentId);
});
test("concurrent duplicate requests serialize and duplicate UUID fails closed", async () => {
  const f = fixture();
  const results = await Promise.all(
    Array.from({ length: 200 }, () => f.service.ensure(video())),
  );
  assert.equal(results.filter((x) => x.created).length, 1);
  assert.equal(f.files.size, 1);
  const [path, file] = [...f.files][0];
  f.service.index.set({ path: "Copy.md", props: structuredClone(file.props) });
  await assert.rejects(f.service.ensure(video()), /duplicate_uuid/);
  assert.equal(f.files.size, 1);
});
test("repeat save projects playlist links by ID after native link shortening", async () => {
  const f = fixture(), value = video(undefined, "one");
  const first = await f.service.ensure(value), entry = f.files.get(first.path);
  entry.props.Playlists = ["[[Playlist]]"];
  f.service.index.set({path: first.path, props: structuredClone(entry.props)});
  await f.service.ensure(value);
  assert.equal(entry.props.Playlists.length, 1);
  assert(entry.props.Playlists[0].includes("TSNotes/Library/Playlists/_records/Playlist"));
  assert.equal(entry.props["Playlist IDs"].length, 1);
  await f.service.ensure(value); assert.equal(entry.props.Playlists.length, 1);
});
test("Bilibili parts remain separate; weak URL cannot merge different CID", async () => {
  const f = fixture();
  const bili = (part, cid) => ({
    site: "bilibili",
    mode: "normal_video",
    record: {
      dedupeKey: "bili:v:BV1test:p" + part,
      fields: {
        title: "Bili",
        videoId: "BV1test",
        cid: String(cid),
        url: "https://www.bilibili.com/video/BV1test/?p=" + part,
        dedupeUrl: "https://www.bilibili.com/video/BV1test/?p=" + part,
      },
    },
  });
  const one = await f.service.ensure(bili(1, 10)),
    two = await f.service.ensure(bili(2, 20));
  assert.notEqual(one.documentId, two.documentId);
  const wrong = bili(1, 30);
  wrong.record.dedupeKey = "other";
  await assert.rejects(f.service.ensure(wrong), /identity_conflict/);
});
test("1000 synthetic indexed records and ordered playlist membership without body writes", async () => {
  const f = fixture();
  for (let i = 0; i < 1000; i++)
    await f.service.ensure(video("video" + String(i).padStart(6, "0")), false);
  assert.equal(f.files.size, 1000);
  for (let i = 0; i < 500; i++) {
    const v = video("video" + String(i).padStart(6, "0"), "scale");
    v.record.fields.playlistIndex = 500 - i;
    await f.service.ensure(v, false);
  }
  assert.equal(f.files.size, 1001);
  const relation = [...f.relations.values()][0];
  assert.equal(relation.members.length, 500);
  assert.equal(relation.members[0].sourceIndex, 1);
  assert([...f.files.values()].filter(f => f.props["Record Type"] === "video").every((f) => f.body === ""));
});
test("write succeeds even if open fails; no recreate to fix display", async () => {
  const f = fixture();
  f.storage.open = async () => {
    throw Error("display_failed");
  };
  const r = await f.service.ensure(video());
  assert.equal(r.written, true);
  assert.equal(r.opened, false);
  assert.equal(r.openError, "display_failed");
  await f.service.ensure(video());
  assert.equal(f.files.size, 1);
});

test("missing relation data fails closed and preserves existing playlist list", async () => {
  const f = fixture();
  await f.service.ensure(video(undefined, "one"));
  const parent = [...f.files.values()].find(
    (x) => x.props["Record Type"] === "playlist",
  );
  const before = structuredClone(parent.props.Videos);
  f.relations.clear();
  await assert.rejects(
    f.service.ensure(video("another123", "one")),
    /relations_missing/,
  );
  assert.deepEqual(parent.props.Videos, before);
});

test("exact key does not hide another strong identity candidate", async () => {
  const f = fixture();
  const a = await f.service.ensure(video("first123456"));
  const b = await f.service.ensure(video("second12345"));
  const ambiguous = video("second12345");
  ambiguous.record.dedupeKey = "yt:v:first123456";
  await assert.rejects(f.service.ensure(ambiguous), /identity_conflict/);
});
test("refresh requires the same previewed identity and exact field changes", async () => {
  const f = fixture();
  await f.service.ensure(video());
  const v = video();
  v.record.fields.title = "new";
  v.record.fields.durationSec = 35;
  const preview = await f.service.refresh(v);
  v.record.fields.durationSec = 36;
  await assert.rejects(f.service.refresh(v, true, preview), /preview_changed/);
});

test("removed or malformed managed identity is quarantined until repaired, not recreated", async () => {
  const f = fixture();
  const first = await f.service.ensure(video());
  const props = structuredClone(f.files.get(first.path).props);
  delete props.TSNotesID;
  f.service.index.set({ path: first.path, props });
  await assert.rejects(f.service.ensure(video()), /invalid_document_metadata/);
  assert.equal(f.files.size, 1);
  f.service.index.set({
    path: first.path,
    props: structuredClone(f.files.get(first.path).props),
  });
  assert.equal((await f.service.ensure(video())).documentId, first.documentId);
});

test("rename reconciliation rejects a relation belonging to another playlist", async () => {
  const f = fixture();
  await f.service.ensure(video("first123456", "A"));
  await f.service.ensure(video("second12345", "B"));
  const parents = [...f.service.index.entries.values()].filter(
    (e) => e.props["Record Type"] === "playlist",
  );
  const before = structuredClone(parents[0].props.Videos);
  parents[0].props["Relations Path"] = parents[1].props["Relations Path"];
  await assert.rejects(
    f.service.reconcileLinks(),
    /damaged_playlist_relations/,
  );
  assert.deepEqual(parents[0].props.Videos, before);
});
