import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { WebSocket } from 'ws';
import { once } from 'node:events';
const out=await build({stdin:{contents:'export {BridgeServer} from "./src/server";export {PlaybackOperations} from "./src/playback-operations";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,external:['ws']});
const mod={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const {BridgeServer,PlaybackOperations}=mod.exports;
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',url='https://www.youtube.com/watch?v=abcdefghijk&t=35s&type=TSNotes';
test('operation reports are monotonic, target-scoped, private and never rebind other profiles',async()=>{
 let target='ego|'+A;const saved=[];const ops=new PlaybackOperations(()=>target,r=>saved.push(r));
 const id=ops.begin(url,A);assert.throws(()=>ops.report({operationId:id,clientId:A,phase:'toString'}),/invalid_playback_phase/);
 assert.throws(()=>ops.report({operationId:id,clientId:A,phase:'unconfirmed'}),/invalid_playback_phase/);
 const r=ops.report({operationId:id,clientId:B,phase:'located',url,secret:'private',reasonCode:'bad full url'});
 assert(r.instanceMismatch);assert(r.windowReady);assert.equal(target,'ego|'+A);assert(!JSON.stringify(saved).includes('abcdefghijk'));assert(!JSON.stringify(saved).includes('private'));
 assert.equal(ops.report({operationId:id,clientId:A,phase:'received'}).phase,'located');
 const pending=ops.begin(url,A),wait=ops.wait(pending);target='tabbit|'+B;ops.cancel();assert.equal(await wait,null);assert.throws(()=>ops.report({operationId:pending,clientId:A,phase:'located'}),/expired/);
 ops.loadHistory([{...r,url,secret:'private'},null,{operationId:'broken',site:'bad'}]);assert.equal(ops.history.length,1);assert(!JSON.stringify(ops.history).includes('private'));assert(!JSON.stringify(ops.history).includes('abcdefghijk'));
 const unknown=ops.begin(url,A);ops.unconfirmed(unknown,'acceptance_unconfirmed');assert.equal(ops.history.at(-1).phase,'unconfirmed');
});
test('1.2 acceptance, lost ack, disconnect after acceptance and authenticated fallback reporting',async(t)=>{
 const state={vaultId:A,secret:'a'.repeat(64),port:0,origin:'chrome-extension://'+'a'.repeat(32),browserBundle:'ego',browserBindings:{ego:A}};
 const bridge=new BridgeServer(state,async()=>{},async()=>({}));await bridge.start();let ws;
 try{
  ws=new WebSocket(`ws://127.0.0.1:${state.port}/v1/events`,{origin:state.origin});await once(ws,'open');let incoming=once(ws,'message');ws.send(JSON.stringify({type:'auth',secret:state.secret,protocolVersion:'1.2',clientId:A,clientName:'QA',sessionId:'current',capabilities:['play','capture-link','playback-v2']}));await incoming;
  const id=bridge.playback.begin(url,A);incoming=once(ws,'message');const accepted=bridge.playV2(url,id),msg=JSON.parse((await incoming)[0]);
  assert.equal(msg.operationId,id);ws.send(JSON.stringify({type:'play-accepted',requestId:msg.requestId,operationId:id,sessionId:'current'}));assert.equal(await accepted,true);
  ws.close();await once(ws,'close');await new Promise(r=>setTimeout(r,10));assert.equal(bridge.playback.history.at(-1).phase,'received','socket loss must not mark playback failed');
  const report=async(secret,payload)=>fetch(`http://127.0.0.1:${state.port}/v1`,{method:'POST',headers:{'Content-Type':'application/json',Origin:state.origin,Authorization:'Bearer '+secret},body:JSON.stringify({protocolVersion:'1.2',requestId:crypto.randomUUID(),action:'report-playback',payload})});
  assert.equal((await report('wrong',{operationId:id,clientId:B,phase:'located'})).ok,false);
  assert.equal((await report(state.secret,{operationId:id,clientId:B,phase:'located'})).ok,true);assert.equal((await bridge.playback.wait(id)).instanceMismatch,true);assert.equal(state.browserBindings.ego,A);
  // Lost acceptance only authorizes a URL fallback once; a late final result
  // still completes that same operation, never creates a second operation.
  ws=new WebSocket(`ws://127.0.0.1:${state.port}/v1/events`,{origin:state.origin});await once(ws,'open');incoming=once(ws,'message');ws.send(JSON.stringify({type:'auth',secret:state.secret,protocolVersion:'1.2',clientId:A,clientName:'QA',sessionId:'next',capabilities:['play','playback-v2']}));await incoming;
  const lateId=bridge.playback.begin(url,A);incoming=once(ws,'message');const fallback=bridge.playV2(url,lateId);const late=JSON.parse((await incoming)[0]);
  assert.equal(await fallback,false);
  ws.send(JSON.stringify({type:'play-result',requestId:late.requestId,sessionId:'next',result:{success:true}}));assert.equal((await bridge.playback.wait(lateId)).phase,'located');
  assert.equal(bridge.pending.size,0);
 }finally{ws?.terminate();bridge.stop();}
});
