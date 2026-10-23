import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {createRequire} from "node:module";
import {mkdtemp,rm,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
const digest=s=>createHash("sha256").update(s).digest("hex"),real=createRequire(import.meta.url);
class TFile {constructor(path){this.path=path;this.extension=path.split(".").at(-1);}}
class TFolder {constructor(path){this.path=path;}}
class MarkdownView {}
const mocks={TFile,TFolder,MarkdownView,parseYaml:JSON.parse,stringifyYaml:p=>JSON.stringify(p)+"\n"};
async function moduleAt(path){const b=await build({entryPoints:[path],bundle:true,platform:"node",format:"cjs",write:false,external:["obsidian"]});const mod={exports:{}};new Function("require","module","exports",b.outputFiles[0].text)(name=>name==="obsidian"?mocks:real(name),mod,mod.exports);return mod.exports;}
const {ResourceService,splitResource}=await moduleAt("src/resources.ts"),{ResourceIndex}=await moduleAt("src/resource-index.ts");
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,client="a".repeat(32);
const encode=(props,body="")=>"---\n"+JSON.stringify(props)+"\n---\n"+body;
async function fixture(t){
  const local=await mkdtemp(join(tmpdir(),"tsnotes-resource-unit-"));t.after(()=>rm(local,{recursive:true,force:true}));
  const files=new Map(),raw=new Map(),parent={path:"Moved/Video.md",props:{TSNotesID:id(1),"Record Type":"video",Title:"Video"}};
  files.set(parent.path,new TFile(parent.path));raw.set(parent.path,encode(parent.props,"我的个人笔记\n"));let failLink=false;
  const app={workspace:{iterateAllLeaves(){}},vault:{getAbstractFileByPath:path=>files.get(path),read:async file=>raw.get(file.path),createFolder:async path=>files.set(path,new TFolder(path)),create:async(path,value)=>{assert(!files.has(path));files.set(path,new TFile(path));raw.set(path,value);},process:async(file,fn)=>raw.set(file.path,fn(raw.get(file.path)))},fileManager:{processFrontMatter:async(file,fn)=>{if(failLink&&file.path===parent.path)throw Error("simulated_link_failure");const p=splitResource(raw.get(file.path));fn(p.props);raw.set(file.path,encode(p.props,p.body));}}};
  const service=new ResourceService(app,{maintenanceActive:false,index:{byId:key=>key===id(1)?parent:null}},()=>({root:"TSNotes"}),id(9),local);
  const call=(action,p={})=>service.handle("resource-"+action,{importClientId:client,...p});
  const upload=async(body,extra={})=>{const started=await call("begin",{documentId:id(1),kind:"subtitle",language:"zh-CN",title:"标题",bodyHash:digest(body),bodySize:Buffer.byteLength(body),assets:[],...extra});if(started.uploadId)await call("chunk",{uploadId:started.uploadId,part:"body",offset:0,data:Buffer.from(body).toString("base64")});return started;};
  return {call,upload,service,files,raw,parent,local,app,failLinks:()=>{failLink=true;},fixLinks:()=>{failLink=false;}};
}
test("create/skip/retry preserves personal body and independent resource identity",async t=>{
  const f=await fixture(t),u=await f.upload("[00:35](https://www.youtube.com/watch?v=x&t=35s&type=TSNotes) 字幕\n");
  const result=await f.call("commit",{uploadId:u.uploadId});assert.equal(result.linked,true);assert.equal(splitResource(f.raw.get(f.parent.path)).body,"我的个人笔记\n");
  const parsed=splitResource(f.raw.get(result.path));assert.notEqual(parsed.props.ResourceID,id(1));assert.equal(parsed.props.TSNotesID,undefined);assert.equal(parsed.props.Language,"zh-cn");
  assert.equal((await f.call("query",{documentId:id(1),kind:"subtitle",language:"zh-CN"})).exists,true);
  const before=f.raw.get(result.path);assert.equal((await f.upload("different")).skipped,true);assert.equal(f.raw.get(result.path),before);
  assert.equal((await f.call("commit",{uploadId:u.uploadId})).resourceId,result.resourceId);
});
test("update requires preview confirmation, preserves UUID and unknown fields, and backs up",async t=>{
  const f=await fixture(t),a=await f.upload("first\n"),created=await f.call("commit",{uploadId:a.uploadId});
  const p=splitResource(f.raw.get(created.path));p.props.Personal="keep";f.raw.set(created.path,encode(p.props,p.body));
  const b=await f.upload("second\n",{update:true});await assert.rejects(()=>f.call("commit",{uploadId:b.uploadId}),/confirmation_required/);
  const preview=await f.call("preview",{uploadId:b.uploadId});assert.equal(preview.before,"first\n");assert.equal(preview.after,"second\n");
  const result=await f.call("commit",{uploadId:b.uploadId,expectedHash:preview.expectedHash});assert.equal(result.resourceId,created.resourceId);assert.equal(splitResource(f.raw.get(result.path)).props.Personal,"keep");assert.equal((await readdir(join(f.local,"backups"))).length,1);
  f.raw.set(created.path,f.raw.get(created.path)+"my edits\n");await assert.rejects(()=>f.upload("third",{update:true}),/locally_modified/);
});
test("concurrent creation, bad chunks, wrong owners, cancellation and incomplete uploads fail closed",async t=>{
  const f=await fixture(t),a=await f.upload("a"),b=await f.upload("b");
  await assert.rejects(()=>f.service.handle("resource-status",{uploadId:a.uploadId,importClientId:"b".repeat(32)}),/expired/);
  await assert.rejects(()=>f.call("chunk",{uploadId:a.uploadId,part:"../outside",offset:0,data:"YQ=="}),/invalid/);
  await f.call("commit",{uploadId:a.uploadId});await assert.rejects(()=>f.call("commit",{uploadId:b.uploadId}),/changed|concurrently/);
  const c=await f.upload("c",{kind:"ai-notes"});await f.call("cancel",{uploadId:c.uploadId});await assert.rejects(()=>f.call("commit",{uploadId:c.uploadId}));
});
test("written resource survives failed link and retry repairs instead of duplicating",async t=>{
  const f=await fixture(t),u=await f.upload("body");f.failLinks();const a=await f.call("commit",{uploadId:u.uploadId});assert.equal(a.written,true);assert.equal(a.linked,false);f.fixLinks();const b=await f.call("commit",{uploadId:u.uploadId});assert.equal(a.path,b.path);assert.equal(f.service.index.entries.size,1);assert.equal(splitResource(f.raw.get(f.parent.path)).props.Subtitles.length,1);
});
test("native shortened wikilinks resolve to one managed resource link",async t=>{
  const f=await fixture(t),u=await f.upload("body"),r=await f.call("commit",{uploadId:u.uploadId});
  const parent=splitResource(f.raw.get(f.parent.path));parent.props.Subtitles=["[[short renamed]]","[[Personal unrelated]]"];f.raw.set(f.parent.path,encode(parent.props,parent.body));
  f.app.metadataCache={getFirstLinkpathDest:path=>path==="short renamed"?f.files.get(r.path):null};await f.call("begin",{documentId:id(1),kind:"subtitle",language:"zh-cn"});
  assert.deepEqual(splitResource(f.raw.get(f.parent.path)).props.Subtitles,["[[Personal unrelated]]","[["+r.path.replace(/\.md$/,"")+"]]"]);
});
test("resource index handles moves, ordinary-note transitions and copied UUID conflicts",()=>{
  const index=new ResourceIndex(),props={ResourceID:id(2),"TSNotes Parent ID":id(1),"Resource Type":"subtitle",Language:"EN"};index.set({path:"a.md",props});props.Language="zh";assert.equal(index.find(id(1),"subtitle","en").path,"a.md");index.remove("a.md");index.set({path:"moved.md",props:{...props,Language:"en"}});index.set({path:"copy.md",props:{...props,Language:"en"}});assert.throws(()=>index.byId(id(2)),/duplicate_resource/);index.remove("copy.md");index.set({path:"moved.md",props:{}});assert.equal(index.find(id(1),"subtitle","en"),null);
});
