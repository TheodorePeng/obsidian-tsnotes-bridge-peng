import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const out=await build({entryPoints:['src/record-presentation.ts'],bundle:true,platform:'node',format:'cjs',write:false});
const mod={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const {RecordPresentation,presentationStore,recordOpenMode}=mod.exports;
function fixture(saved=null){
 let serial=0,mode='window',ready=()=>{},opened=0,created=0,layoutSaves=0;
 const roots=[],all=[],store={id:saved,read:async()=>store.id,write:async id=>{store.id=id;}};
 const root=()=>{const r={id:'root'+(++serial),win:{closed:false},group:{}};roots.push(r);return r;};
 const main=root();
 const leaf=(container,path)=>{const l={id:'leaf'+(++serial),container,parent:container.group,state:path?{type:'markdown',state:{file:path}}:{type:'empty'},opens:0,editor:'draft',isDeferred:false,getContainer(){return this.container},getRoot(){return this.container},getViewState(){return this.state},async openFile(file){opened++;this.opens++;if(file.fail)throw Error('open_failed');this.state={type:'markdown',state:{file:file.path}};},detach(){this.detached=true;}};all.push(l);return l;};
 const original=leaf(main,'original.md');let active=original;
 const live=()=>all.filter(l=>!l.detached&&l.container.win&&!l.container.win.closed);
 const workspace={rootSplit:main,onLayoutReady(fn){ready=fn;fn();},iterateAllLeaves(fn){for(const l of live())if(fn(l))break;},getLeafById(id){return live().find(l=>l.id===id)||null},getLayout(){return {floating:{id:'floating',type:'floating',children:roots.filter(r=>r!==main&&r.win&&!r.win.closed).map(r=>({id:r.id,type:'window',children:[{id:r.id+'tabs',type:'tabs',children:live().filter(l=>l.container===r).map(l=>({id:l.id,type:'leaf'}))}]}))}}},openPopoutLeaf(){created++;return leaf(root())},setActiveLeaf(l){active=l;},getLeaf(){return live().find(l=>l.parent===active.parent&&l.state.type==='empty')||leaf(active.container)},async revealLeaf(l){l.isDeferred=false;active=l;},requestSaveLayout(){layoutSaves++}};
 const app={workspace};const make=()=>new RecordPresentation(app,()=>mode,store);let service=make();
 return {app,store,original,roots,all,leaf,main,make,get service(){return service},set service(v){service=v},setMode:v=>mode=v,counts:()=>({opened,created,layoutSaves}),live,get active(){return active}};
}
const A={path:'A.md'},B={path:'B.md'};
test('default mode, one owned window, distinct tabs, repeat preserves editor and main note',async()=>{
 assert.equal(recordOpenMode(undefined),'window');assert.equal(recordOpenMode('invalid'),'window');assert.equal(recordOpenMode('tab'),'tab');
 const f=fixture();await f.service.open(A);await f.service.open(B);const a=f.live().find(l=>l.getViewState().state?.file===A.path);a.editor='draft and selection';a.isDeferred=true;await f.service.open(A);
 assert.deepEqual(f.counts(),{opened:2,created:1,layoutSaves:1});assert.equal(a.opens,1);assert.equal(a.editor,'draft and selection');assert.equal(f.active,a);assert.equal(a.isDeferred,false);assert.equal(f.original.opens,0);assert.equal(f.original.state.state.file,'original.md');
});
test('matching file outside selected container stays intact; modes do not move or close tabs',async()=>{
 const f=fixture();const user=f.leaf(f.roots[0],A.path);const other={id:'user-window',win:{closed:false},group:{}};f.roots.push(other);const userWindow=f.leaf(other,A.path);
 await f.service.open(A);assert.notEqual(f.active,userWindow);assert.equal(f.counts().created,1);
 f.setMode('tab');await f.service.open(A);assert.equal(f.active,user);await f.service.open(B);assert.equal(f.active.container,f.main);assert.equal(f.counts().created,1);
 f.setMode('window');await f.service.open(B);assert.notEqual(f.active.container,f.main);assert.equal(f.counts().created,1);assert(f.live().includes(userWindow));
});
test('restored layout identity survives reload, closing or moving tabs never claims another window',async()=>{
 const f=fixture();await f.service.open(A);const id=f.store.id,owned=f.active.container;f.service.dispose();f.service=f.make();await f.service.open(B);assert.equal(f.store.id,id);assert.equal(f.counts().created,1);
 // Moving the A tab to the main window does not make it a presentation target.
 const a=f.live().find(l=>l.state.state?.file===A.path);a.container=f.main;a.parent=f.main.group;await f.service.open(A);assert.equal(f.active.container,owned);assert.equal(a.opens,1);
 owned.win.closed=true;f.service.layoutChanged();await f.service.open(A);assert.equal(f.counts().created,2);assert.notEqual(f.store.id,id);assert.equal(a.container,f.main);
});
test('simultaneous identical opens share a task; errors do not poison later opens',async()=>{
 const f=fixture();const first=f.service.open(A);assert.equal(first,f.service.open(A));await first;
 await assert.rejects(f.service.open({path:'bad.md',fail:true}),/open_failed/);await f.service.open(B);assert.equal(f.counts().created,1);assert.equal(f.active.state.state.file,B.path);
});
test('saved ID absent from restored layout creates a new owned window; no manual-window adoption',async()=>{
 const f=fixture('gone');await f.service.open(A);assert.equal(f.counts().created,1);assert.notEqual(f.store.id,'gone');
});
test('wrong container or nonempty returned tab cannot replace existing notes',async()=>{
 const f=fixture();f.app.workspace.getLeaf=()=>f.original;await assert.rejects(f.service.open(A),/wrong_container/);assert.equal(f.original.opens,0);assert(!f.original.detached);
 const g=fixture();let wrong;g.app.workspace.getLeaf=()=>wrong=g.leaf(g.main);await assert.rejects(g.service.open(A),/wrong_container/);assert.equal(wrong.detached,true);assert.equal(g.original.opens,0);
});
test('per-vault isolation, mode captured at enqueue, unload cancels queued operations',async()=>{
 const f=fixture(),g=fixture();await Promise.all([f.service.open(A),g.service.open(A)]);assert.notEqual(f.active.container,g.active.container);
 const first=f.service.open(B);f.setMode('tab');const next=f.service.open({path:'main.md'});await first;await next;assert.equal(f.active.container,f.main);
 const cancelled=f.service.open({path:'cancel.md'});f.service.dispose();await assert.rejects(cancelled,/stopped/);assert(!f.live().some(l=>l.state.state?.file==='cancel.md'));
});
test('persistence failure keeps created window and retries without making another window',async()=>{
 const f=fixture();let calls=0;f.store.write=async id=>{if(++calls===1)throw Error('disk');f.store.id=id};await assert.rejects(f.service.open(A),/disk/);await f.service.open(A);assert.equal(f.counts().created,1);
});
test('device store preserves corrupt original before replacing it and scopes state by vault',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tsnotes-presentation-test-')),id='11111111-1111-4111-8111-111111111111',file=join(dir,id+'.presentation.json');
 try{const store=presentationStore(id,dir);assert.equal(await store.read(),null);await store.write('root');assert.equal(await store.read(),'root');await writeFile(file,'broken');assert.equal(await store.read(),null);await store.write('replacement');const backup=(await readdir(dir)).find(n=>n.includes('.corrupt-'));assert.equal(await readFile(join(dir,backup),'utf8'),'broken');assert.equal(await store.read(),'replacement');assert.equal(await presentationStore('22222222-2222-4222-8222-222222222222',dir).read(),null);}finally{await rm(dir,{recursive:true});}
});
test('a new app workspace restores only the saved owned layout ID',async()=>{
 const old=fixture();await old.service.open(A);const saved=old.store.id;old.service.dispose();
 const next=fixture(saved),restored={id:saved,win:{closed:false},group:{}};next.roots.push(restored);const a=next.leaf(restored,A.path);await next.service.open(A);assert.equal(next.counts().created,0);assert.equal(next.active,a);assert.equal(a.opens,0);
});
test('same-container nonempty tab is never overwritten',async()=>{
 const f=fixture();await f.service.open(A);const a=f.active;f.app.workspace.getLeaf=()=>a;await assert.rejects(f.service.open(B),/wrong_container/);assert.equal(a.state.state.file,A.path);assert.equal(a.opens,1);assert(!a.detached);
});
test('native popout initialization may finish after openPopoutLeaf returns',async()=>{
 const f=fixture(),create=f.app.workspace.openPopoutLeaf;f.app.workspace.openPopoutLeaf=()=>{const l=create();l.container.win.closed=true;setTimeout(()=>{l.container.win.closed=false},10);return l};await f.service.open(A);assert.equal(f.counts().created,1);assert.equal(f.active.state.state.file,A.path);
});
test('new native leaf temporarily reports the main container until the document attaches',async()=>{
 const f=fixture(),create=f.app.workspace.openPopoutLeaf;f.app.workspace.openPopoutLeaf=()=>{const l=create(),container=l.container;l.container=f.main;setTimeout(()=>{l.container=container},10);return l};await f.service.open(A);assert.equal(f.counts().created,1);assert.notEqual(f.active.container,f.main);assert.equal(f.original.opens,0);
});
test('restored popout waits for its existing renderer without creating a replacement',async()=>{
 const f=fixture('restored'),root={id:'restored',win:{closed:false},group:{}};f.roots.push(root);const l=f.leaf(root,A.path);let attached=false;l.getContainer=()=>attached?root:f.main;setTimeout(()=>attached=true,10);await f.service.open(A);assert.equal(f.counts().created,0);assert.equal(f.active,l);
});
test('disposed native window sets win to null and can be rebuilt safely',async()=>{
 const f=fixture();await f.service.open(A);f.active.container.win=null;f.service.layoutChanged();await f.service.open(B);assert.equal(f.counts().created,2);assert.equal(f.original.opens,0);
});
