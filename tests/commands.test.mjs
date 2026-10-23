import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {createRequire} from "node:module";
const notices=[],writes=[],realRequire=createRequire(import.meta.url);
const b=await build({entryPoints:["src/main.ts"],bundle:true,platform:"node",format:"cjs",write:false,external:["obsidian","ws","@codemirror/view"]});
const mod={exports:{}};
new Function("require","module","exports",b.outputFiles[0].text)(name=>name==="obsidian"?{Plugin:class{constructor(app){this.app=app}},PluginSettingTab:class{},Modal:class{},Notice:class{constructor(text){notices.push(text)}},Setting:class{},TFile:class{},FileSystemAdapter:class{}}:name==="@codemirror/view"?{EditorView:{}}:realRequire(name),mod,mod.exports);
Object.defineProperty(globalThis,"navigator",{configurable:true,value:{clipboard:{writeText:async text=>{writes.push(text)}}}});
const Plugin=mod.exports.default;
function fixture(){
 const file={path:"Daily.md",extension:"md"};
 const editor={text:"保留文字",pos:{line:0,ch:4},cm:{state:{readOnly:false},composing:false},getValue(){return this.text},getCursor(){return this.pos},listSelections(){return [{anchor:this.pos,head:this.pos}]},posToOffset(p){return p.ch},transaction(tx){const c=tx.changes[0];this.text=this.text.slice(0,c.from.ch)+c.text+this.text.slice(c.from.ch);this.pos=tx.selection.from;}};
 const ctx={file,editor,getMode:()=>"source"},app={vault:{getAbstractFileByPath:path=>path===file.path?file:null},workspace:{activeEditor:ctx}};
 const p=new Plugin(app);p.local={browserBundle:"ego"};p.saveLocal=async()=>{};
 p.bridge={targetKey:()=>"ego|client",invalidateTarget(){},capture:async()=>({success:true,url:"https://www.youtube.com/watch?v=abcdefghijk&t=35s&type=TSNotes",seconds:35,sampledAt:Date.now(),sessionId:"session"})};
 return {p,app,file,editor,ctx};
}
test("copy and insert have separate side effects, and failure preserves the clipboard",async()=>{
 writes.length=0;const {p,editor,ctx}=fixture();await p.captureTimeLink("copy");assert.equal(writes.length,1);assert.equal(editor.text,"保留文字");
 await p.captureTimeLink("insert",editor,ctx);assert.equal(writes.length,1);assert.match(editor.text,/保留文字 \[00:35\]/);
 p.bridge.capture=async()=>{throw Error("browser_disconnected")};await assert.rejects(()=>p.captureTimeLink("copy"),/browser_disconnected/);assert.equal(writes.length,1);
});
test("pending capture cannot insert after document/caret/window/target changes or unload",async()=>{
 for(const mutate of [f=>{f.editor.text+="新的编辑"},f=>{f.editor.pos={line:0,ch:1}},f=>{f.app.workspace.activeEditor={}},f=>{f.file.path="Renamed.md"},f=>{f.p.editorEpoch++},f=>f.p.invalidateTarget(),f=>{f.p.active=false}]){
  const f=fixture();let release;const result=await f.p.bridge.capture();f.p.bridge.capture=()=>new Promise(r=>{release=r});const op=f.p.captureTimeLink("insert",f.editor,f.ctx);mutate(f);release(result);await assert.rejects(op,/editor_changed|target_changed|plugin_unloaded/);assert(!f.editor.text.includes("[00:35]"));
 }
});
test("read-only, reading view, IME and duplicate commands do not write",async()=>{
 for(const mutate of [f=>{f.editor.cm.state.readOnly=true},f=>{f.editor.cm.composing=true},f=>{f.ctx.getMode=()=>"preview"}]){const f=fixture();mutate(f);await assert.rejects(()=>f.p.captureTimeLink("insert",f.editor,f.ctx));assert.equal(f.editor.text,"保留文字");}
 const f=fixture();let release;const result=await f.p.bridge.capture();f.p.bridge.capture=()=>new Promise(r=>{release=r});const pending=f.p.captureTimeLink("copy");await assert.rejects(()=>f.p.captureTimeLink("copy"),/capture_busy/);release(result);await pending;
});

test("command labels are English and stable command IDs are retained",()=>{
 const source=fs.readFileSync("src/main.ts","utf8");
 for(const [id,name] of [["copy-videoplay-tsnotes-link","Copy current VideoPlay timestamp link"],["insert-videoplay-tsnotes-link","Insert current VideoPlay timestamp link"]]) assert(source.includes(`id:"${id}",name:"${name}"`));
});
