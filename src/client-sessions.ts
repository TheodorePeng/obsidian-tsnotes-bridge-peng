import { randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocket } from "ws";
import type { LocalState } from "./local-state";

interface Client { ws: WebSocket; clientId: string; clientName: string; sessionId: string; capabilities: string[] }
interface Pending { client: Client; kind: string; target: string; resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout>; accepted?:()=>void; operationId?:string }
export class ClientSessions {
  private peers = new Map<string, Client>();
  readonly pending = new Map<string, Pending>();
  constructor(private local: LocalState, private heartbeat: () => void) {}
  targetKey(): string { return `${this.local.browserBundle}|${this.local.browserBindings?.[this.local.browserBundle] || ""}`; }
  targetId(): string {
    const id = this.local.browserBindings?.[this.local.browserBundle];
    if (!id) throw Error("browser_not_bound");
    return id;
  }
  private selected(): Client {
    const peer = this.peers.get(this.targetId());
    if (!peer || peer.ws.readyState !== WebSocket.OPEN) throw Error("browser_disconnected");
    return peer;
  }
  get connected(): boolean { try { return !!this.selected(); } catch { return false; } }
  list() { return [...this.peers.values()].filter(p=>p.ws.readyState===WebSocket.OPEN).map(({clientId,clientName,sessionId,capabilities})=>({clientId,clientName,sessionId,capabilities})); }
  attach(ws: WebSocket): void {
    let client: Client | null = null;
    const timer = setTimeout(()=>ws.close(1008),3000);
    ws.on("message", bytes => {
      try {
        const msg = JSON.parse(bytes.toString());
        if (!client) {
          const actual=Buffer.from(String(msg.secret||"")),expected=Buffer.from(this.local.secret);
          if(msg.type!=="auth"||actual.length!==expected.length||!timingSafeEqual(actual,expected)) throw Error("unauthorized");
          const modern=["1.1","1.2"].includes(msg.protocolVersion);
          if(modern&&(!/^[a-f0-9-]{36}$/.test(msg.clientId)||typeof msg.sessionId!=="string"||!msg.sessionId||msg.sessionId.length>160||typeof msg.clientName!=="string"||msg.clientName.length>80||/[\u0000-\u001f]/.test(msg.clientName)||!Array.isArray(msg.capabilities)))throw Error("invalid_client");
          const id=modern?msg.clientId:`legacy-${randomUUID()}`;
          if(this.peers.size>=8||this.peers.has(id))throw Error("client_conflict");
          client={ws,clientId:id,clientName:modern?msg.clientName:"旧版本客户端，请更新",sessionId:modern?msg.sessionId:"legacy",capabilities:modern?msg.capabilities.filter((v:unknown)=>v==="play"||v==="capture-link"||v==="playback-v2"):[]};
          this.peers.set(id,client);clearTimeout(timer);
          ws.send(JSON.stringify({type:"ready",protocolVersion:"1.2",capabilities:["play","capture-link","playback-v2"]}));
          return;
        }
        if(msg.type==="ping"){this.heartbeat();ws.send(JSON.stringify({type:"pong"}));return;}
        const pending=this.pending.get(msg.requestId);
        if(pending&&pending.client===client&&msg.sessionId===client.sessionId&&pending.target===this.targetKey()&&msg.type==="play-accepted"&&pending.kind==="play"&&pending.operationId===msg.operationId)pending.accepted?.();
        if(pending&&pending.client===client&&msg.sessionId===client.sessionId&&msg.type===`${pending.kind}-result`){
          clearTimeout(pending.timer);this.pending.delete(msg.requestId);
          pending.resolve(pending.target===this.targetKey()?msg.result:{success:false,reasonCode:"target_changed"});
        }
      } catch { ws.close(1008); }
    });
    ws.on("close",()=>{clearTimeout(timer);if(client&&this.peers.get(client.clientId)===client){this.peers.delete(client.clientId);this.cancel("browser_disconnected",client);}});
    ws.on("error",()=>ws.close());
  }
  request(kind: "play"|"capture-link", payload: Record<string,unknown>, accepted?:()=>void): Promise<unknown> {
    const client=this.selected();
    if(!client.capabilities.includes(kind))throw Error("browser_update_required");
    if(this.pending.size>=8||(kind==="capture-link"&&[...this.pending.values()].some(p=>p.kind===kind)))throw Error("capture_busy");
    const requestId=randomUUID(),timeout=kind==="capture-link"?8000:payload.operationId?45000:20000,target=this.targetKey();
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{this.pending.delete(requestId);resolve({success:false,reasonCode:kind==="capture-link"?"capture_timeout":"play_timeout"});},timeout);
      this.pending.set(requestId,{client,kind,target,resolve,timer,accepted,operationId:typeof payload.operationId==="string"?payload.operationId:undefined});
      try {client.ws.send(JSON.stringify({type:kind,...payload,requestId,sessionId:client.sessionId,expiresAt:Date.now()+(kind==="play"&&!payload.operationId?19000:timeout)}));}
      catch {clearTimeout(timer);this.pending.delete(requestId);resolve({success:false,reasonCode:"browser_disconnected"});}
    });
  }
  supportsPlaybackV2():boolean {try{return this.selected().capabilities.includes("playback-v2");}catch{return false;}}
  playV2(url:string,operationId:string,onAccepted:()=>void,onResult:(value:unknown)=>void):Promise<boolean>{
    if(!this.supportsPlaybackV2())return Promise.resolve(false);
    return new Promise(resolve=>{
      let settled=false;
      const finish=(accepted:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);if(accepted)onAccepted();resolve(accepted);};
      const timer=setTimeout(()=>finish(false),1500);
      void this.request("play",{url,operationId},()=>finish(true)).then(result=>{
        const r=result as {success?:boolean;reasonCode?:string};
        if(!["browser_disconnected","play_timeout","target_changed","bridge_stopped"].includes(r.reasonCode||"")){finish(true);onResult(result);}else finish(false);
      }).catch(()=>finish(false));
    });
  }
  cancel(reason="target_changed",client?:Client):void {
    for(const [id,p]of this.pending){if(client&&p.client!==client)continue;clearTimeout(p.timer);p.resolve({success:false,reasonCode:reason});this.pending.delete(id);}
  }
  stop():void {this.cancel("bridge_stopped");for(const p of this.peers.values())p.ws.terminate();this.peers.clear();}
}
