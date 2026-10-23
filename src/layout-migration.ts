import {App,MarkdownView,TFile,TFolder} from "obsidian";
import {createHash,randomUUID} from "node:crypto";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import {join} from "node:path";
import {homedir} from "node:os";
import {libraryPaths} from "./library";
import {safePath,type BridgeSettings} from "./model";
import type {RecordService} from "./records";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
export function layoutMoves(settings:BridgeSettings){const p=libraryPaths(settings);return [{from:`${p.root}/${settings.videos}/Videos.base`,to:p.videoBase},{from:`${p.root}/${settings.playlists}/Playlists.base`,to:p.playlistBase},{from:`${p.root}/${settings.playlists}/_records/README.md`,to:p.readme}];}
export function legacyViewPath(path:string,settings:BridgeSettings){return layoutMoves(settings).find(move=>move.to===path)?.from;}
export interface LayoutPreview {id:string;digest:string;moves:{from:string;to:string;sha256:string}[];references:{path:string;sha256:string}[];issues:string[]}
export class LayoutMigration {
  private local:string;
  constructor(private app:App,private records:RecordService,private settings:()=>BridgeSettings,vaultId:string,localRoot?:string){this.local=localRoot||join(homedir(),"Library","Application Support","TSNotes Bridge Peng","layout-migrations",vaultId);}
  async preview():Promise<LayoutPreview>{
    const moves:LayoutPreview["moves"]=[],references:LayoutPreview["references"]=[],issues:string[]=[];
    for(const move of layoutMoves(this.settings())){
      const file=this.app.vault.getAbstractFileByPath(safePath(move.from));if(!file)continue;
      if(!(file instanceof TFile)){issues.push("非文件："+move.from);continue;}
      if(this.app.vault.getAbstractFileByPath(move.to))issues.push("目标已存在："+move.to);
      moves.push({...move,sha256:hash(await this.app.vault.read(file))});
    }
    for(const file of this.app.vault.getFiles()){
      if(!["md","base","canvas"].includes(file.extension)||moves.some(m=>m.from===file.path))continue;
      const raw=await this.app.vault.read(file),links=this.app.metadataCache.resolvedLinks[file.path]||{};
      if(moves.some(m=>links[m.from]||raw.includes(m.from)||raw.includes(encodeURI(m.from))))references.push({path:file.path,sha256:hash(raw)});
    }
    const digest=hash(JSON.stringify({moves,references,issues}));return {id:randomUUID(),digest,moves,references,issues};
  }
  async apply(plan:LayoutPreview,confirmed:string):Promise<string>{
    return this.records.maintain(async()=>{
      if(confirmed!==plan.digest||plan.issues.length)throw Error("layout_preview_not_confirmed");
      const current=await this.preview();if(current.digest!==plan.digest)throw Error("layout_preview_stale");
      const paths=new Set([...plan.moves.map(m=>m.from),...plan.references.map(r=>r.path)]);
      const files:Record<string,string>={};for(const path of paths){const file=this.app.vault.getAbstractFileByPath(path);if(!(file instanceof TFile))throw Error("layout_file_missing");files[path]=await this.app.vault.read(file);}
      let dirty=false;this.app.workspace.iterateAllLeaves(leaf=>{if(leaf.view instanceof MarkdownView&&leaf.view.file&&paths.has(leaf.view.file.path)&&leaf.view.getMode()==="source"&&leaf.view.editor.getValue()!==files[leaf.view.file.path])dirty=true;});if(dirty)throw Error("unsaved_layout_editor");
      const folder=join(this.local,plan.id);await mkdir(folder,{recursive:true,mode:0o700});
      const journal={version:1,plan,files,completed:[] as string[],phase:"prepared"};
      const save=()=>writeFile(join(folder,"journal.json"),JSON.stringify(journal,null,2),{mode:0o600});await save();
      // Move the guide first: subsequent native Base renames may legitimately
      // rewrite its links. It must not remain a pending source with an old hash.
      const ordered=[...plan.moves].sort((a,b)=>Number(b.to.endsWith("/README.md"))-Number(a.to.endsWith("/README.md")));
      for(const move of ordered){
        const file=this.app.vault.getAbstractFileByPath(move.from);if(!(file instanceof TFile)||hash(await this.app.vault.read(file))!==move.sha256||this.app.vault.getAbstractFileByPath(move.to))throw Error("layout_file_changed");
        let parent="";for(const part of safePath(move.to).split("/").slice(0,-1)){parent=parent?parent+"/"+part:part;const f=this.app.vault.getAbstractFileByPath(parent);if(f&&!(f instanceof TFolder))throw Error("layout_directory_conflict");if(!f)await this.app.vault.createFolder(parent);}
        await this.app.fileManager.renameFile(file,move.to);journal.completed.push(move.to);await save();
      }
      // Native renames normally update links. Explicit full-path links are also
      // repaired when the user's automatic-link setting is disabled.
      for(const original of paths){
        const path=plan.moves.find(m=>m.from===original)?.to||original,file=this.app.vault.getAbstractFileByPath(path);if(!(file instanceof TFile))throw Error("layout_file_missing");
        await this.app.vault.process(file,raw=>{
          for(const move of plan.moves)raw=raw.split("[["+move.from).join("[["+move.to).split("]("+encodeURI(move.from)).join("]("+encodeURI(move.to));
          if(path===libraryPaths(this.settings()).readme&&!raw.includes("<!-- TSNotes layout v3 -->"))raw+="\n\n<!-- TSNotes layout v3 -->\n## 当前布局与资源导入（v3）\n\n本节目录取代上文旧目录示例。Videos.base 与 Playlists.base 位于 TSNotes 根目录；本说明位于 _data/README.md。原有个人补充保留。\n\nResources/<视频 TSNotesID>/ 按需保存字幕、百度 AI 笔记及 assets 图片。资源通过 ResourceID 和 TSNotes Parent ID 关联，不能复制视频 TSNotesID。主笔记的 Subtitles、AI Notes 为入口，个人正文不由导入器改写。重复导入默认跳过，手动更新先预览；本地改过的资源不覆盖。\n\n_data/playlists 保存正式成员及来源序号，必须随 Vault 备份。Playlist Videos.base 仍在 Playlists/_records，以 this.TSNotesID 筛选嵌入它的 Playlist。\n<!-- /TSNotes layout v3 -->\n";
          return raw;
        });
      }
      journal.phase="complete";await save();return folder;
    });
  }
}
