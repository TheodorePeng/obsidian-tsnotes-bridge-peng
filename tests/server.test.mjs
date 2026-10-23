import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
const r = await build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  external: ["ws"],
});
const module = { exports: {} };
new Function("require", "module", "exports", r.outputFiles[0].text)(
  createRequire(import.meta.url),
  module,
  module.exports,
);
const { BridgeServer } = module.exports;
test("loopback authentication, single-use tickets, idempotency and shutdown", async () => {
  const state = {
    vaultId: "v",
    secret: "a".repeat(64),
    port: 0,
    origin: "",
    browserBundle: "com.citrolabs.ego.lite",
    browserBindings:{"com.citrolabs.ego.lite":"11111111-1111-4111-8111-111111111111"},
  };
  let writes = 0;
  const bridge = new BridgeServer(
    state,
    async () => {},
    async () => ({ writes: ++writes }),
  );
  await bridge.start();
  const send = async (
    action,
    payload = {},
    requestId = crypto.randomUUID(),
    auth = true,
  ) => {
    if (["consume-launch","launch-result"].includes(action)) payload={clientId:"11111111-1111-4111-8111-111111111111",...payload};
    const r = await fetch(`http://127.0.0.1:${state.port}/v1`, {
      method: "POST",
      headers: {
        Origin: "chrome-extension://" + "a".repeat(32),
        Authorization: auth ? "Bearer " + state.secret : "bad",
      },
      body: JSON.stringify({
        protocolVersion: "1.0",
        requestId,
        action,
        payload,
      }),
    });
    return { status: r.status, ...(await r.json()) };
  };
  try {
    assert.equal((await send("status", {}, undefined, false)).status, 403);
    const ticket = bridge.ticket(
      "https://www.youtube.com/watch?v=a&type=TSNotes",
    );
    assert.equal(
      (
        await send("consume-launch", {
          ticket,
          url: "https://www.youtube.com/watch?v=a&type=TSNotes",
        })
      ).success,
      true,
    );
    assert.equal(
      (
        await send("consume-launch", {
          ticket,
          url: "https://www.youtube.com/watch?v=a&type=TSNotes",
        })
      ).reasonCode,
      "launch_ticket_invalid",
    );
    assert.equal((await send("launch-result", {ticket,url:"wrong",success:true})).reasonCode,"launch_ticket_invalid");
    assert.equal(bridge.takeLaunchResult(ticket),null);
    assert.equal((await send("launch-result", {ticket,url:"https://www.youtube.com/watch?v=a&type=TSNotes",success:false,reason:"target_media_not_located"})).success,true);
    assert.deepEqual(bridge.takeLaunchResult(ticket),{success:false,reason:"target_media_not_located"});
    assert.equal(bridge.takeLaunchResult(ticket),null);
    assert.equal((await send("ensure", { x: 1 }, "id")).result.writes, 1);
    assert.equal((await send("ensure", { x: 1 }, "id")).result.writes, 1);
    assert.equal(
      (await send("ensure", { x: 2 }, "id")).reasonCode,
      "request_id_conflict",
    );
    assert.equal((await send("delete")).reasonCode, "invalid_request");
    assert.deepEqual((await send("status")).result.capabilities,["resource-import-v1"]);
    for(const stage of ["query","begin","chunk","status","preview","commit","cancel"]){assert.equal((await send("resource-"+stage,{documentId:"test"})).success,true);}
    assert.equal((await send("resource-query",{},undefined,false)).status,403);
    assert.equal((await send("resource-delete")).reasonCode,"invalid_request");
    assert.equal((await send("resource-query",[])).reasonCode,"invalid_request");
    assert.equal(bridge.diagnostics.heartbeats, 0);
  } finally {
    bridge.stop();
  }
});
