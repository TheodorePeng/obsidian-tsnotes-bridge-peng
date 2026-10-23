import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { WebSocket, WebSocketServer } from "ws";
import { once } from "node:events";
const output=await build({entryPoints:["src/server.ts"],bundle:true,platform:"node",format:"cjs",write:false,external:["ws"]});
const mod={exports:{}};new Function("require","module","exports",output.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const {BridgeServer}=mod.exports;
const A="11111111-1111-4111-8111-111111111111",B="22222222-2222-4222-8222-222222222222";
test("bound client routing rejects wrong peer replies, offline fallback, changed target and late results",async(t)=>{
 const state={vaultId:"test",secret:"a".repeat(64),port:0,origin:"chrome-extension://"+"a".repeat(32),browserBundle:"ego",browserBindings:{ego:A,tabbit:B}};
 const bridge=new BridgeServer(state,async()=>{},async()=>({}));
 assert.equal(typeof bridge.capture,"function","capture request must be supported");
 const clients=[];await bridge.start();
 async function connect(id){const ws=new WebSocket(`ws://127.0.0.1:${state.port}/v1/events`,{origin:state.origin});clients.push(ws);await once(ws,"open");const ready=once(ws,"message");ws.send(JSON.stringify({type:"auth",secret:state.secret,protocolVersion:"1.1",clientId:id,clientName:id,sessionId:"session-"+id,capabilities:["play","capture-link"]}));assert.equal(JSON.parse((await ready)[0]).protocolVersion,"1.2");return ws;}
 try{
  const a=await connect(A),b=await connect(B);assert.equal(bridge.clients().length,2);
  const request=once(a,"message"),result=bridge.capture();const msg=JSON.parse((await request)[0]);assert.equal(msg.type,"capture-link");
  let resolved=false;result.then(()=>{resolved=true});b.send(JSON.stringify({type:"capture-link-result",requestId:msg.requestId,sessionId:"session-"+B,result:{success:true,seconds:999}}));await new Promise(r=>setTimeout(r,10));assert.equal(resolved,false);
  a.send(JSON.stringify({type:"capture-link-result",requestId:msg.requestId,sessionId:"old-session",result:{success:true,seconds:888}}));await new Promise(r=>setTimeout(r,10));assert.equal(resolved,false);
  a.send(JSON.stringify({type:"capture-link-result",requestId:msg.requestId,sessionId:"session-"+A,result:{success:true,seconds:35}}));assert.equal((await result).seconds,35);
  const next=once(a,"message"),cancelled=bridge.capture();await next;state.browserBundle="tabbit";bridge.invalidateTarget();assert.equal((await cancelled).reasonCode,"target_changed");
  assert.equal(bridge.pending.size,0);a.send(JSON.stringify({type:"capture-link-result",requestId:msg.requestId,sessionId:"session-"+A,result:{success:true,seconds:777}}));
  t.mock.timers.enable({apis:["setTimeout"]});const timed=bridge.capture();t.mock.timers.tick(8001);assert.equal((await timed).reasonCode,"capture_timeout");assert.equal(bridge.pending.size,0);t.mock.timers.reset();
  const nextB=once(b,"message"),offline=bridge.capture();await nextB;b.close();assert.equal((await offline).reasonCode,"browser_disconnected");assert.equal(bridge.connected,false);await assert.rejects(()=>bridge.capture(),/browser_disconnected/);
 }finally{for(const ws of clients)ws.terminate();bridge.stop();}
});
