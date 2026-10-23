export interface ResourceEntry {path:string;props:Record<string,unknown>}
const uuid=(value:unknown)=>typeof value==="string"&&/^[a-f0-9-]{36}$/i.test(value);
export class ResourceIndex {
  readonly entries=new Map<string,ResourceEntry>();
  set(entry:ResourceEntry):void{this.remove(entry.path);if(entry.props.ResourceID||entry.props["TSNotes Parent ID"]||entry.props["Resource Type"])this.entries.set(entry.path,{path:entry.path,props:structuredClone(entry.props)});}
  remove(path:string):void{this.entries.delete(path);}
  private unique(entries:ResourceEntry[]):ResourceEntry|null{
    if(entries.length>1)throw Error("duplicate_resource_identity");
    const entry=entries[0];if(!entry)return null;const p=entry.props;
    if(!uuid(p.ResourceID)||!uuid(p["TSNotes Parent ID"])||!["subtitle","ai-notes"].includes(String(p["Resource Type"]))||p.TSNotesID||["video","playlist"].includes(String(p["Record Type"])))throw Error("resource_identity_invalid");
    if([...this.entries.values()].filter(e=>e.props.ResourceID===p.ResourceID).length>1)throw Error("duplicate_resource_identity");
    return entry;
  }
  byId(id:string):ResourceEntry|null{return this.unique([...this.entries.values()].filter(e=>e.props.ResourceID===id));}
  find(parentId:string,kind:string,language="und"):ResourceEntry|null{return this.unique([...this.entries.values()].filter(e=>e.props["TSNotes Parent ID"]===parentId&&e.props["Resource Type"]===kind&&(kind!=="subtitle"||String(e.props.Language||"und").trim().toLowerCase()===language.trim().toLowerCase())));}
}
