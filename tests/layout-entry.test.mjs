import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {createRequire} from "node:module";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
const require=createRequire(import.meta.url);
class TFile{constructor(path,content=""){this.path=path;this.content=content;this.extension=path.split(".").at(-1);}}
class TFolder{constructor(path){this.path=path;}}
async function moduleAt(path){const b=await build({entryPoints:[path],bundle:true,format:"cjs",platform:"node",write:false,external:["obsidian"]});const mod={exports:{}};new Function("require","module","exports",b.outputFiles[0].text)(name=>name==="obsidian"?{TFile,TFolder,MarkdownView:class{},parseYaml:JSON.parse,stringifyYaml:JSON.stringify}:require(name),mod,mod.exports);return mod.exports;}
const {ensureLibraryViews}=await moduleAt("src/obsidian-storage.ts"),{LayoutMigration,layoutMoves}=await moduleAt("src/layout-migration.ts"),{libraryPaths}=await moduleAt("src/library.ts");
const settings={root:"TSNotes",videos:"Videos",playlists:"Playlists",fields:{}};
const {LibraryMaintenance}=await moduleAt("src/library-maintenance.ts");
test("legacy entry files defer initialization while keeping shared Base",async()=>{
  const moves=layoutMoves(settings),files=new Map(moves.map(m=>[m.from,new TFile(m.from,"customized")])),shared="TSNotes/Playlists/_records/Playlist Videos.base";files.set(shared,new TFile(shared,"custom shared"));
  const app={vault:{getAbstractFileByPath:p=>files.get(p),createFolder:async p=>files.set(p,new TFolder(p)),create:async(p,content)=>files.set(p,new TFile(p,content))}};
  await ensureLibraryViews(app,settings);await ensureLibraryViews(app,settings);
  const maintenance=new LibraryMaintenance(app,{maintain:fn=>fn()},()=>settings,"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",".obsidian/plugins/tsnotes-bridge-peng/data.json");
  await assert.rejects(()=>maintenance.viewPreview(),/先预览并迁移/);await assert.rejects(()=>maintenance.applyViews([]),/先预览并迁移/);
  for(const m of moves){assert.equal(files.get(m.from).content,"customized");assert.equal(files.has(m.to),false);}assert.equal(files.get(shared).content,"custom shared");
});
test("preview covers only three entry files and references, detects destination conflict",async()=>{
  const moves=layoutMoves(settings),files=new Map(moves.map(m=>[m.from,new TFile(m.from,"customized")]));files.set("Personal.md",new TFile("Personal.md","[[TSNotes/Videos/Videos.base]]"));
  const app={metadataCache:{resolvedLinks:{}},vault:{getAbstractFileByPath:p=>files.get(p),getFiles:()=>[...files.values()],read:async f=>f.content}};
  const manager=new LayoutMigration(app,{maintain:fn=>fn()},()=>settings,"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  const p=await manager.preview();assert.equal(p.moves.length,3);assert.deepEqual(p.references.map(f=>f.path),["Personal.md"]);assert.equal(p.issues.length,0);
  await assert.rejects(()=>manager.apply(p,"wrong-digest"),/not_confirmed/);
  files.set(libraryPaths(settings).videoBase,new TFile(libraryPaths(settings).videoBase,"other"));assert.equal((await manager.preview()).issues.length,1);
});
test("native Base renames may update the already moved guide without aborting migration",async()=>{
  const moves=layoutMoves(settings),files=new Map(moves.map(m=>[m.from,new TFile(m.from,m.from.endsWith(".md")?"personal text\n[[TSNotes/Videos/Videos.base]]\n[[TSNotes/Playlists/Playlists.base]]":"custom Base")]));
  const original=files.get(moves[2].from).content,renamed=[];
  const app={metadataCache:{resolvedLinks:{}},workspace:{iterateAllLeaves(){}},vault:{getAbstractFileByPath:p=>files.get(p),getFiles:()=>[...files.values()].filter(f=>f instanceof TFile),read:async f=>f.content,createFolder:async p=>files.set(p,new TFolder(p)),process:async(f,fn)=>{f.content=fn(f.content);}},fileManager:{renameFile:async(f,to)=>{const from=f.path;files.delete(from);f.path=to;files.set(to,f);renamed.push(to);for(const file of files.values())if(file instanceof TFile)file.content=file.content.replaceAll("[["+from+"]]","[["+to.split("/").at(-1)+"]]");}}};
  const root=await mkdtemp(join(tmpdir(),"tsnotes-layout-test-"));
  try{const manager=new LayoutMigration(app,{maintain:fn=>fn()},()=>settings,"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",root),p=await manager.preview();const backup=await manager.apply(p,p.digest);assert.equal(renamed[0],moves[2].to);for(const m of moves){assert.equal(files.has(m.from),false);assert.equal(files.has(m.to),true);}assert.match(files.get(moves[2].to).content,/personal text/);assert.match(files.get(moves[2].to).content,/TSNotes layout v3/);const journal=JSON.parse(await readFile(join(backup,"journal.json"),"utf8"));assert.equal(journal.phase,"complete");assert.equal(journal.files[moves[2].from],original);assert.equal((await manager.preview()).moves.length,0);}finally{await rm(root,{recursive:true,force:true});}
});
