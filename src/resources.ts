import {App,MarkdownView,TFile,TFolder,parseYaml,stringifyYaml} from "obsidian";
import {createHash,randomUUID} from "node:crypto";
import {mkdir,readFile,writeFile,rename,rm,stat,appendFile,readdir} from "node:fs/promises";
import {join} from "node:path";
import {homedir} from "node:os";
import {safePath,fileName,type BridgeSettings,type Fields} from "./model";
import type {RecordService} from "./records";
import {libraryPaths} from "./library";
import {assertLibraryLayout} from "./obsidian-storage";
import {ResourceIndex,type ResourceEntry} from "./resource-index";

const hash=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const uuid=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9-]{36}$/i.test(value);
interface Part {name:string;size:number;sha256:string;mime?:string}
interface Upload {id:string;clientId:string;documentId:string;kind:string;language:string;title:string;resourceId:string;path:string;folder:string;parts:Part[];expectedHash:string|null;update:boolean;expires:number;committed?:boolean}
export function splitResource(raw:string):{props:Fields;body:string}{
  const match=raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);if(!match)throw Error("resource_frontmatter_missing");
  const props=parseYaml(match[1]);if(!props||typeof props!=="object"||Array.isArray(props))throw Error("invalid_frontmatter");
  return {props,body:raw.slice(match[0].length)};
}
export class ResourceService {
  readonly index=new ResourceIndex();
  private tail:Promise<unknown>=Promise.resolve();private active=true;private paused=false;
  private readonly local:string;
  constructor(private app:App,private records:RecordService,private settings:()=>BridgeSettings,vaultId:string,localRoot?:string){if(!uuid(vaultId))throw Error("invalid_vault_id");this.local=localRoot||join(homedir(),"Library","Application Support","TSNotes Bridge Peng","resource-imports",vaultId);}
  dispose(){this.active=false;}
  private assertActive(){if(!this.active)throw Error("plugin_unloaded");if(this.paused||this.records.maintenanceActive)throw Error("library_maintenance_in_progress");}
  async beginMaintenance():Promise<()=>void>{
    if(this.paused)throw Error("resource_maintenance_in_progress");this.paused=true;
    try{
      await this.tail.catch(()=>undefined);
      for(const name of await readdir(this.local).catch(()=>[]))if(uuid(name)){
        const upload=JSON.parse(await readFile(join(this.uploadDir(name),"upload.json"),"utf8").catch(()=>"null")) as Upload|null;
        if(upload&&!upload.committed&&upload.expires>Date.now())throw Error("active_resource_upload：请先完成或取消资源导入");
      }
      return ()=>{this.paused=false;};
    }catch(error){this.paused=false;throw error;}
  }
  private parent(id:unknown){if(!uuid(id))throw Error("invalid_document_id");const parent=this.records.index.byId(id);if(!parent||parent.props["Record Type"]!=="video")throw Error("video_record_missing");return parent;}
  private async directory(path:string){let current="";for(const piece of safePath(path).split("/")){current=current?current+"/"+piece:piece;const f=this.app.vault.getAbstractFileByPath(current);if(f&&!(f instanceof TFolder))throw Error("resource_directory_conflict");if(!f)await this.app.vault.createFolder(current);}}
  private file(path:string){const f=this.app.vault.getAbstractFileByPath(safePath(path));if(!(f instanceof TFile))throw Error("resource_document_missing");return f;}
  private async noDraft(file:TFile){const raw=await this.app.vault.read(file);let dirty=false;this.app.workspace.iterateAllLeaves(leaf=>{if(leaf.view instanceof MarkdownView&&leaf.view.file===file&&leaf.view.getMode()==="source"&&leaf.view.editor.getValue()!==raw)dirty=true;});if(dirty)throw Error("unsaved_resource_editor");return raw;}
  private async atomic(path:string,value:string|Buffer){await mkdir(this.local,{recursive:true,mode:0o700});const tmp=path+"."+randomUUID()+".tmp";await writeFile(tmp,value,{mode:0o600,flag:"wx"});await rename(tmp,path);}
  private uploadDir(id:string){if(!uuid(id))throw Error("invalid_upload_id");return join(this.local,id);}
  private async save(upload:Upload){await this.atomic(join(this.uploadDir(upload.id),"upload.json"),JSON.stringify(upload));}
  private async load(id:unknown,clientId:string):Promise<Upload>{if(!uuid(id))throw Error("invalid_upload_id");const u=JSON.parse(await readFile(join(this.uploadDir(id),"upload.json"),"utf8")) as Upload;if(u.id!==id||u.clientId!==clientId||u.expires<Date.now())throw Error("resource_upload_expired");return u;}
  private async link(entry:ResourceEntry){
    const parent=this.parent(entry.props["TSNotes Parent ID"]),file=this.file(parent.path),field=entry.props["Resource Type"]==="subtitle"?"Subtitles":"AI Notes",link="[["+entry.path.replace(/\.md$/,"")+"]]";
    await this.noDraft(file);
    await this.app.fileManager.processFrontMatter(file,props=>{
      if(props.TSNotesID!==parent.props.TSNotesID)throw Error("document_identity_changed");
      const old=props[field];if(old!==undefined&&(!Array.isArray(old)||old.some((v:unknown)=>typeof v!=="string")))throw Error("resource_link_property_conflict");
      // Native renames can shorten a full link. Resolve it before appending our
      // canonical destination so one resource does not acquire two links.
      const others=(old||[]).filter((value:string)=>{
        if(value===link)return false;
        const path=value.match(/^\[\[([^|#\]]+)(?:[|#][^\]]*)?\]\]$/)?.[1];
        return !path||this.app.metadataCache?.getFirstLinkpathDest?.(path,parent.path)?.path!==entry.path;
      });
      props[field]=[...new Set([...others,link])];
    });
    const resourceFile=this.file(entry.path);
    await this.noDraft(resourceFile);
    await this.app.fileManager.processFrontMatter(resourceFile,props=>{if(props.ResourceID!==entry.props.ResourceID)throw Error("resource_identity_changed");props.Video="[["+parent.path.replace(/\.md$/,"")+"]]";});
  }
  async renamed(oldPath:string,newPath:string){
    if(this.records.maintenanceActive)return;
    for(const entry of [...this.index.entries.values()]){
      const parent=this.records.index.byId(String(entry.props["TSNotes Parent ID"]));if(!parent||(entry.path!==newPath&&parent.path!==newPath))continue;
      const field=entry.props["Resource Type"]==="subtitle"?"Subtitles":"AI Notes";
      const file=this.file(parent.path),old="[["+oldPath.replace(/\.md$/,"")+"]]",next="[["+entry.path.replace(/\.md$/,"")+"]]";
      await this.app.fileManager.processFrontMatter(file,props=>{if(Array.isArray(props[field]))props[field]=props[field].map((v:unknown)=>v===old?next:v);});
      await this.link(entry);
    }
  }
  async handle(action:string,p:Record<string,unknown>):Promise<unknown>{const next=this.tail.catch(()=>undefined).then(()=>{this.assertActive();return this.execute(action,p);});this.tail=next;return next;}
  private async execute(action:string,p:Record<string,unknown>):Promise<unknown>{
    assertLibraryLayout(this.app,this.settings());
    const clientId=String(p.importClientId||"");if(!/^[a-p]{32}$/.test(clientId))throw Error("invalid_import_client");
    if(action==="resource-query"||action==="resource-begin"){
      const parent=this.parent(p.documentId);await this.records.index.byId(String(parent.props.TSNotesID));
      const kind=String(p.kind),language=kind==="subtitle"?String(p.language||"und").trim().toLowerCase():"und";
      if(!["subtitle","ai-notes"].includes(kind)||!/^[a-z0-9-]{1,40}$/.test(language))throw Error("invalid_resource_kind_or_language");
      const folder=safePath(`${libraryPaths(this.settings()).resources}/${parent.props.TSNotesID}`),existing=this.index.find(String(parent.props.TSNotesID),kind,language);
      if(action==="resource-query")return {exists:!!existing,path:existing?.path,resourceId:existing?.props.ResourceID,folder};
      if(existing&&p.update!==true){await this.link(existing);return {skipped:true,path:existing.path};}
      let before:string|null=null;if(existing){before=await this.noDraft(this.file(existing.path));const parsed=splitResource(before);if(parsed.props.ResourceID!==existing.props.ResourceID)throw Error("resource_identity_changed");if(hash(parsed.body)!==parsed.props["Imported Body Hash"])throw Error("resource_body_locally_modified");}
      const assets=Array.isArray(p.assets)?p.assets as Part[]:[];
      if(assets.length>100||!Number.isInteger(p.bodySize)||Number(p.bodySize)<1||Number(p.bodySize)>5*1024*1024||!/^[a-f0-9]{64}$/.test(String(p.bodyHash)))throw Error("resource_payload_invalid");
      const names=new Set<string>();let total=Number(p.bodySize);
      for(const a of assets){if(!/^[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(a.name)||a.name.split(".")[0]!==a.sha256||!Number.isInteger(a.size)||a.size<1||a.size>20*1024*1024||names.has(a.name))throw Error("resource_asset_invalid");names.add(a.name);total+=a.size;}
      if(total>105*1024*1024)throw Error("resource_payload_too_large");
      await mkdir(this.local,{recursive:true,mode:0o700});let activeUploads=0;
      for(const name of await readdir(this.local))if(uuid(name)){
        const path=this.uploadDir(name);const old=JSON.parse(await readFile(join(path,"upload.json"),"utf8").catch(()=>"null")) as Upload|null;
        if(old&&old.expires<Date.now())await rm(path,{recursive:true,force:true});else if(old&&!old.committed)activeUploads++;
      }
      if(activeUploads>=8)throw Error("resource_upload_limit");
      const id=randomUUID(),resourceId=existing?String(existing.props.ResourceID):randomUUID();
      const path=existing?.path||`${folder}/${fileName(String(p.title||"Video"))} - ${kind==="subtitle"?"字幕."+language:"AI 笔记"}.md`;
      if(!existing&&this.app.vault.getAbstractFileByPath(path))throw Error("resource_filename_conflict");
      const upload:Upload={id,clientId,documentId:String(parent.props.TSNotesID),kind,language,title:String(p.title||"Video").slice(0,200),resourceId,path,folder,parts:[{name:"body",size:Number(p.bodySize),sha256:String(p.bodyHash)},...assets],expectedHash:before===null?null:hash(before),update:p.update===true,expires:Date.now()+600000};
      await mkdir(this.uploadDir(id),{recursive:true,mode:0o700});await this.save(upload);return {uploadId:id};
    }
    const u=await this.load(p.uploadId,clientId),dir=this.uploadDir(u.id);
    if(action==="resource-cancel"){await rm(dir,{recursive:true,force:true});return {cancelled:true};}
    if(action==="resource-status")return {committed:!!u.committed,documentId:u.documentId,path:u.path};
    if(action==="resource-chunk"){
      if(u.committed)throw Error("resource_already_committed");
      const part=u.parts.find(a=>a.name===p.part),data=String(p.data||"");if(!part||data.length>180000||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw Error("resource_chunk_invalid");
      const bytes=Buffer.from(data,"base64"),offset=Number(p.offset);if(bytes.toString("base64")!==data||!Number.isInteger(offset)||offset<0||offset+bytes.length>part.size)throw Error("resource_chunk_invalid");
      const path=join(dir,part.name),size=await stat(path).then(s=>s.size).catch(()=>0);
      if(size===offset)await appendFile(path,bytes,{mode:0o600});
      else if(offset+bytes.length<=size){const old=await readFile(path);if(!old.subarray(offset,offset+bytes.length).equals(bytes))throw Error("resource_chunk_conflict");}
      else throw Error("resource_chunk_out_of_order");return {received:offset+bytes.length};
    }
    if(action!=="resource-preview"&&action!=="resource-commit")throw Error("unsupported_resource_operation");
    const parent=this.parent(u.documentId);let body="";
    for(const part of u.parts){const bytes=await readFile(join(dir,part.name));if(bytes.length!==part.size||hash(bytes)!==part.sha256)throw Error("resource_part_incomplete");if(part.name==="body"){body=bytes.toString("utf8");if(!Buffer.from(body,"utf8").equals(bytes))throw Error("invalid_resource_utf8");}}
    if(/(?<!\\)<\s*(script|iframe|object|embed)\b/i.test(body))throw Error("unsafe_resource_markup");
    const current=this.app.vault.getAbstractFileByPath(u.path),before=current instanceof TFile?await this.noDraft(current):null;
    if(action==="resource-preview")return {before:before?splitResource(before).body:"",after:body,expectedHash:before===null?null:hash(before)};
    if(u.committed){const existing=this.index.byId(u.resourceId);if(!existing)throw Error("committed_resource_missing");await this.link(existing);return {written:true,path:existing.path,resourceId:u.resourceId};}
    if((before===null?null:hash(before))!==u.expectedHash)throw Error("resource_changed_since_upload");
    if(u.expectedHash!==null&&p.expectedHash!==u.expectedHash)throw Error("resource_update_confirmation_required");
    const matching=this.index.find(u.documentId,u.kind,u.language);if(matching&&matching.props.ResourceID!==u.resourceId)throw Error("resource_created_concurrently");
    const field=u.kind==="subtitle"?"Subtitles":"AI Notes",parentRaw=await this.noDraft(this.file(parent.path)),parentProps=splitResource(parentRaw).props;
    if(parentProps.TSNotesID!==u.documentId)throw Error("document_identity_changed");
    if(parentProps[field]!==undefined&&!Array.isArray(parentProps[field]))throw Error("resource_link_property_conflict");
    this.assertActive();
    for(const part of u.parts.filter(p=>p.name!=="body")){
      await this.directory(`${u.folder}/assets`);const path=`${u.folder}/assets/${part.name}`,bytes=await readFile(join(dir,part.name));
      const old=this.app.vault.getAbstractFileByPath(path);if(old){if(!(old instanceof TFile)||hash(Buffer.from(await this.app.vault.readBinary(old)))!==part.sha256)throw Error("resource_asset_conflict");}
      else await this.app.vault.createBinary(path,Uint8Array.from(bytes).buffer);
    }
    const now=new Date().toISOString(),old=before?splitResource(before):null;
    const props:Fields={...(old?.props||{}),ResourceID:u.resourceId,"TSNotes Parent ID":u.documentId,"Resource Type":u.kind,Video:"[["+parent.path.replace(/\.md$/,"")+"]]","Imported time":old?.props["Imported time"]||now,"Updated time":now,"Source Hash":u.parts[0].sha256,"Imported Body Hash":hash(body),...(u.kind==="subtitle"?{Language:u.language}:{})};
    const content="---\n"+stringifyYaml(props)+"---\n"+body;
    if(before!==null){await mkdir(join(this.local,"backups"),{recursive:true,mode:0o700});await this.atomic(join(this.local,"backups",u.id+".md"),before);await this.app.vault.process(this.file(u.path),raw=>{if(hash(raw)!==u.expectedHash||hash(splitResource(raw).body)!==splitResource(raw).props["Imported Body Hash"])throw Error("resource_update_conflict");return content;});}
    else{await this.directory(u.path.slice(0,u.path.lastIndexOf("/")));await this.app.vault.create(u.path,content);}
    const entry={path:u.path,props};this.index.set(entry);u.committed=true;await this.save(u);
    try{await this.link(entry);}catch(error){return {written:true,linked:false,path:u.path,resourceId:u.resourceId,linkError:error instanceof Error?error.message:"resource_link_failed"};}
    return {written:true,linked:true,path:u.path,resourceId:u.resourceId};
  }
}
