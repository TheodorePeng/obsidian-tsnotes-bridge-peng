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
const { linkAt, eventElement } = await import(
  "data:text/javascript;base64," +
    Buffer.from(b.outputFiles[0].text).toString("base64")
);
test("Markdown label and raw URL hit testing preserves encoded Baidu paths", () => {
  const url =
    "https://pan.baidu.com/pfile/video?path=%2F%E8%AF%BE%20%E7%A8%8B%2Fa%2Bb.mp4&type=TSNotes&t=37s";
  const line = "Before [jump](" + url + ") after";
  assert.equal(linkAt(line, 10), url);
  assert.equal(linkAt(line, 2), null);
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
