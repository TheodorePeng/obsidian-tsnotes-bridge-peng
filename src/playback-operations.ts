import { randomUUID } from "node:crypto";
export interface PlaybackRecord { operationId: string; phase: "received"|"window-ready"|"located"|"failed"|"unconfirmed"; at: number; site: string; reasonCode?: string; clientShort?: string; instanceMismatch?: boolean; windowReady?:boolean }
interface Operation { id:string; site:string; target:string; expectedClientId?:string; expires:number; record?:PlaybackRecord; listeners:Set<()=>void> }
export class PlaybackOperations {
  private operations=new Map<string,Operation>();
  readonly history:PlaybackRecord[]=[];
  constructor(private target:()=>string,private save:(records:PlaybackRecord[])=>void=()=>undefined){}
  setPersistence(save:(records:PlaybackRecord[])=>void):void{this.save=save;}
  loadHistory(records:unknown[]):void{
    const safe:PlaybackRecord[]=[];
    for(const value of records.slice(-20)){
      if(!value||typeof value!=="object")continue;const r=value as PlaybackRecord;
      if(!/^[a-f0-9-]{36}$/i.test(r.operationId)||!Number.isFinite(r.at)||!["received","window-ready","located","failed","unconfirmed"].includes(r.phase)||!["youtube.com","www.youtube.com","m.youtube.com","youtu.be","bilibili.com","www.bilibili.com","m.bilibili.com","pan.baidu.com"].includes(r.site))continue;
      safe.push({operationId:r.operationId,at:r.at,phase:r.phase,site:r.site,...(r.clientShort&&/^[a-f0-9]{8}$/i.test(r.clientShort)?{clientShort:r.clientShort}:{}),...(r.reasonCode&&/^[a-z0-9_]{1,80}$/.test(r.reasonCode)?{reasonCode:r.reasonCode}:{}),instanceMismatch:r.instanceMismatch===true,windowReady:r.windowReady===true});
    }
    this.history.splice(0,this.history.length,...safe);
  }
  private remember(record:PlaybackRecord):void{
    const old=this.history.findIndex(r=>r.operationId===record.operationId);if(old>=0)this.history.splice(old,1);this.history.push(record);while(this.history.length>20)this.history.shift();this.save([...this.history]);
  }
  unconfirmed(id:string,reasonCode:"acceptance_unconfirmed"|"result_unconfirmed"|"browser_launch_failed"):void{
    const op=this.operations.get(id);if(!op||op.target!==this.target())return;
    if(op.record?.phase==="located"||op.record?.phase==="failed")return;
    const record:PlaybackRecord={...op.record,operationId:id,site:op.site,at:Date.now(),phase:reasonCode==="browser_launch_failed"?"failed":"unconfirmed",reasonCode};
    this.remember(record);
  }
  begin(url:string,expectedClientId?:string):string {
    for(const [id,o]of this.operations)if(o.expires<Date.now())this.operations.delete(id);
    if(this.operations.size>=32)throw Error("playback_busy");
    const id=randomUUID();this.operations.set(id,{id,site:new URL(url).hostname,target:this.target(),expectedClientId,expires:Date.now()+120000,listeners:new Set()});return id;
  }
  report(payload:Record<string,unknown>):PlaybackRecord {
    const op=this.operations.get(String(payload.operationId||""));
    if(!op||op.expires<Date.now()||op.target!==this.target())throw Error("playback_operation_expired");
    if(typeof payload.clientId!=="string"||!/^[a-f0-9-]{36}$/i.test(payload.clientId))throw Error("invalid_playback_client");
    const phase=String(payload.phase) as PlaybackRecord["phase"],order={unconfirmed:-1,received:0,"window-ready":1,located:2,failed:2};
    if(phase==="unconfirmed"||!Object.hasOwn(order,phase))throw Error("invalid_playback_phase");
    if(op.record&&(order[phase]<order[op.record.phase]||order[op.record.phase]===2))return op.record;
    const reason=typeof payload.reasonCode==="string"&&/^[a-z0-9_]{1,80}$/.test(payload.reasonCode)?payload.reasonCode:undefined;
    op.record={operationId:op.id,phase,site:op.site,at:Date.now(),clientShort:payload.clientId.slice(0,8),instanceMismatch:!!op.expectedClientId&&op.expectedClientId!==payload.clientId,...(reason?{reasonCode:reason}:{}),windowReady:payload.windowReady===true||op.record?.windowReady===true||phase==="window-ready"||phase==="located"};
    this.remember(op.record);for(const fn of op.listeners)fn();return op.record;
  }
  async wait(id:string,acceptedOnly=false):Promise<PlaybackRecord|null>{
    const op=this.operations.get(id);if(!op)return null;
    return new Promise(resolve=>{
      let timer:ReturnType<typeof setTimeout>;
      const done=(value:PlaybackRecord|null)=>{clearTimeout(timer);op.listeners.delete(update);resolve(value);};
      const update=()=>{
        if(op.target!==this.target()){done(null);return;}
        if(op.record&&(acceptedOnly||op.record.phase==="located"||op.record.phase==="failed")){done(op.record);return;}
      };
      timer=setTimeout(()=>done(null),acceptedOnly?30000:45000);op.listeners.add(update);update();
    });
  }
  cancel():void{for(const o of this.operations.values()){o.target="cancelled";for(const fn of o.listeners)fn();}this.operations.clear();}
}
