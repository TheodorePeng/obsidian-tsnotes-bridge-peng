import { build } from "esbuild";
import test from "node:test";
import assert from "node:assert/strict";
import {runInNewContext} from "node:vm";
const b = await build({
  entryPoints: ["src/link-target.ts"],
  bundle: true,
  format: "esm",
  write: false,
});
const { linkAt, eventElement, linkFromElement } = await import(
  "data:text/javascript;base64," +
    Buffer.from(b.outputFiles[0].text).toString("base64")
);
test("Markdown label and raw URL hit testing preserves encoded Baidu paths", () => {
  const url =
    "https://pan.baidu.com/pfile/video?path=%2F%E8%AF%BE%20%E7%A8%8B%2Fa%2Bb.mp4&type=TSNotes&t=37s";
  const line = "Before [jump](" + url + ") after";
  assert.equal(linkAt(line, 10), url);
  assert.equal(linkAt(line, 2), null);
  const angle = "[00:37](<" + url.replace("video?", "video(a)?") + ">)";
  assert.equal(linkAt(angle, 3), url.replace("video?", "video(a)?"));
  assert.equal(linkAt(url, 35), url);
});
test("adopted popout nodes resolve across realms and text-node targets", () => {
  const foreign = runInNewContext('new (class Element { nodeType=1; closest(){return this;} })()');
  class Element {}
  assert.equal(foreign instanceof Element,false);
  assert.equal(eventElement(foreign),foreign);
  assert.equal(eventElement({nodeType:3,parentElement:foreign}),foreign);
  assert.equal(eventElement(null),null);
  assert.equal(eventElement({}),null);
});

test("live-preview label without href resolves its source link before editor handlers", () => {
  assert.equal(typeof linkFromElement, "function");
  for (const url of [
    "https://www.youtube.com/watch?v=-F2W0BsuLxU&type=TSNotes&t=35s",
    "https://www.youtube.com/watch?v=-F2W0BsuLxU&t=35s&type=TSNotes",
    "https://pan.baidu.com/pfile/video?path=%2F%E8%AF%BE%20%E7%A8%8B%2Fa%2Bb.mp4&t=37s&type=TSNotes",
  ]) {
    const label = {};
    const underline = { closest: selector => selector.startsWith(".cm-link") ? label : null };
    const line = `[00:35](${url})`;
    const view = {
      posAtDOM: node => { assert.equal(node, label); return 101; },
      state: { doc: { lineAt: () => ({ from: 100, text: line }) } },
    };
    assert.equal(linkFromElement(underline, node => { assert.equal(node, label); return view; }), url);
  }
});

test("Properties and reading links keep their href; unrelated text and detached editors are ignored", () => {
  assert.equal(typeof linkFromElement, "function");
  const url = "https://www.youtube.com/watch?v=-F2W0BsuLxU&t=35s&type=TSNotes";
  const anchor = { getAttribute: name => name === "href" ? url : null };
  assert.equal(linkFromElement({ closest: () => anchor }, () => { throw Error("must not inspect editor"); }), url);
  const label = {};
  const target = { closest: selector => selector.startsWith(".cm-link") ? label : null };
  assert.equal(linkFromElement(target, () => null), null);
  assert.equal(linkFromElement(target, () => ({posAtDOM: () => { throw Error("detached node"); }})), null);
  assert.equal(linkFromElement({ closest: () => null }, () => { throw Error("unrelated text"); }), null);
});
