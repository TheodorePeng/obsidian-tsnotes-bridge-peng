import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
const b=await build({entryPoints:["src/link-target.ts"],bundle:true,format:"esm",write:false});
const m=await import("data:text/javascript;base64,"+Buffer.from(b.outputFiles[0].text).toString("base64"));
test("capture result produces only a validated time link, never arbitrary browser text",()=>{
 assert.equal(typeof m.captureMarkdown,"function");
 const data={success:true,url:"https://www.youtube.com/watch?v=abcdefghijk&t=35s&type=TSNotes",seconds:35,sampledAt:Date.now(),sessionId:"test",markdown:"EVIL"};
 assert.equal(m.captureMarkdown(data),"[00:35](https://www.youtube.com/watch?v=abcdefghijk&t=35s&type=TSNotes) ");
 for(const change of [{url:"javascript:alert(1)"},{seconds:36},{url:data.url+"&t=20s"},{sampledAt:0},{seconds:NaN}])assert.throws(()=>m.captureMarkdown({...data,...change}));
});

function editor(text,from={line:0,ch:0},to=from){
 return {text,from,to,transactions:[],getValue(){return this.text},getCursor(side){return side==="from"?this.from:this.to},listSelections(){return [{anchor:this.from,head:this.to}]},posToOffset(p){return this.text.split("\n").slice(0,p.line).reduce((n,l)=>n+l.length+1,0)+p.ch},transaction(tx,origin){this.transactions.push({tx,origin});const c=tx.changes[0],o=this.posToOffset(c.from);this.text=this.text.slice(0,o)+c.text+this.text.slice(o);this.from=this.to=tx.selection.from}};
}
test("insertion preserves selected Chinese text and uses one transaction; changed selection/text and YAML are rejected",()=>{
 assert.equal(typeof m.snapshotInsertion,"function");
 const e=editor("原有笔记 保留文字",{line:0,ch:5},{line:0,ch:9}),s=m.snapshotInsertion(e);
 m.applyInsertion(e,s,"[00:35](https://x/) ");
 assert.equal(e.text,"原有笔记 保留文字 [00:35](https://x/) ");assert.equal(e.transactions.length,1);
 const changed=editor("内容",{line:0,ch:2}),snapshot=m.snapshotInsertion(changed);changed.text+="新编辑";assert.throws(()=>m.applyInsertion(changed,snapshot,"link"),/editor_changed/);
 const moved=editor("内容",{line:0,ch:2}),snap=m.snapshotInsertion(moved);moved.to={line:0,ch:1};assert.throws(()=>m.applyInsertion(moved,snap,"link"),/editor_changed/);
 assert.throws(()=>m.snapshotInsertion(editor("---\nTitle: hello\n---\n正文",{line:1,ch:1})),/frontmatter/);
 assert.doesNotThrow(()=>m.snapshotInsertion(editor("---\nTitle: hello\n---\n正文",{line:3,ch:1})));
 const multiple=editor("text");multiple.listSelections=()=>[{anchor:multiple.from,head:multiple.to},{anchor:multiple.from,head:multiple.to}];assert.throws(()=>m.snapshotInsertion(multiple),/multiple_cursors/);
});
