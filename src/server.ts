import { PlaybackOperations } from "./playback-operations";
import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { WebSocketServer } from "ws";
import type { LocalState } from "./local-state";
import { ClientSessions } from "./client-sessions";
const LIMIT = 1024 * 1024;
export interface RequestEnvelope {
  protocolVersion: string;
  requestId: string;
  action: string;
  payload: Record<string, unknown>;
}
export class BridgeServer {
  private server: Server;
  private wss: WebSocketServer;
  private sessions: ClientSessions;
  private tickets = new Map<string, { url: string; expires: number; clientId: string; target: string }>();
  private launches = new Map<string, { url: string; expires: number; clientId: string; target: string; result?: {success: boolean; reason: string} }>();
  private results = new Map<
    string,
    { signature: string; value: Promise<unknown>; bytes: number }
  >();
  private trimResults(): void {
    let size = [...this.results.values()].reduce((n, e) => n + e.bytes, 0);
    while (this.results.size > 512 || size > 2 * 1024 * 1024) {
      const key = this.results.keys().next().value!;
      size -= this.results.get(key)!.bytes;
      this.results.delete(key);
    }
  }
  readonly playback: PlaybackOperations;
  diagnostics = { httpRequests: 0, heartbeats: 0, playRequests: 0 };
  constructor(
    readonly local: LocalState,
    private saveLocal: () => Promise<void>,
    private action: (request: RequestEnvelope) => Promise<unknown>,
  ) {
    this.playback = new PlaybackOperations(()=>this.sessions.targetKey());
    this.sessions = new ClientSessions(local, () => { this.diagnostics.heartbeats++; });
    this.server = createServer((req, res) => {
      void (async () => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        const origin = req.headers.origin || "";
        if (
          req.method !== "POST" ||
          req.url !== "/v1" ||
          !/^chrome-extension:\/\/[a-p]{32}$/.test(origin) ||
          (local.origin && local.origin !== origin) ||
          !this.equal(req.headers.authorization || "", "Bearer " + local.secret)
        ) {
          res
            .writeHead(403)
            .end('{"success":false,"reasonCode":"unauthorized"}');
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > LIMIT) {
            res.writeHead(413).end();
            req.destroy();
            return;
          }
          chunks.push(chunk);
        }
        const r = JSON.parse(
          Buffer.concat(chunks).toString(),
        ) as RequestEnvelope;
        if (
          !["1.0", "1.1", "1.2"].includes(r.protocolVersion) ||
          typeof r.requestId !== "string" || !r.requestId ||
          r.requestId.length > 120 ||
          !r.payload || typeof r.payload !== "object" || Array.isArray(r.payload) ||
          ![
            "ensure",
            "find",
            "refresh",
            "open",
            "consume-launch",
            "launch-result",
            "status",
            "report-playback",
            "resource-query", "resource-begin", "resource-chunk", "resource-status",
            "resource-preview", "resource-commit", "resource-cancel",
          ].includes(r.action)
        )
          throw Error("invalid_request");
        if (!local.origin) {
          local.origin = origin;
          await this.saveLocal();
        }
        this.diagnostics.httpRequests++;
        const signature = createHash("sha256")
          .update(JSON.stringify([r.action, r.payload]))
          .digest("hex");
        const cached = this.results.get(r.requestId);
        if (cached && cached.signature !== signature)
          throw Error("request_id_conflict");
        const value = cached?.value || this.execute(r);
        if (!cached) {
          const entry = { signature, value, bytes: 256 };
          this.results.set(r.requestId, entry);
          this.trimResults();
          void value.then(
            (result) => {
              entry.bytes =
                256 + Buffer.byteLength(JSON.stringify(result ?? null));
              this.trimResults();
            },
            () => {
              entry.bytes = 256;
            },
          );
        }
        res.end(
          JSON.stringify({
            success: true,
            requestId: r.requestId,
            result: await value,
          }),
        );
      })().catch((e) => {
        if (!res.headersSent) res.writeHead(400);
        res.end(
          JSON.stringify({
            success: false,
            reasonCode: e instanceof Error ? e.message : "request_failed",
          }),
        );
      });
    });
    this.wss = new WebSocketServer({ server: this.server, maxPayload: LIMIT });
    this.wss.on("connection", (ws, req) => {
      const origin = req.headers.origin || "";
      if (
        !local.origin ||
        origin !== local.origin ||
        req.url !== "/v1/events"
      ) {
        ws.close(1008);
        return;
      }
      this.sessions.attach(ws);
    });
  }
  private equal(a: string, b: string): boolean {
    const x = Buffer.from(a),
      y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }
  private async execute(r: RequestEnvelope): Promise<unknown> {
    if (r.action === "status")
      return { vaultId: this.local.vaultId, connected: this.connected, protocolVersion: "1.2", capabilities:["resource-import-v1"] };
    if(r.action==="report-playback")return this.playback.report(r.payload);
    if (r.action === "consume-launch") {
      const ticket = String(r.payload.ticket || ""),
        p = this.tickets.get(ticket);
      if (!p || p.expires < Date.now() || p.url !== r.payload.url || p.clientId !== r.payload.clientId || p.target !== this.sessions.targetKey())
        throw Error("launch_ticket_invalid");
      this.tickets.delete(ticket);
      this.launches.set(ticket, p);
      return { url: p.url };
    }
    if (r.action === "launch-result") {
      const p = this.launches.get(String(r.payload.ticket || ""));
      if (!p || p.expires < Date.now() || p.url !== r.payload.url || p.clientId !== r.payload.clientId || p.target !== this.sessions.targetKey() || p.result || typeof r.payload.success !== "boolean") throw Error("launch_ticket_invalid");
      p.result = {success: r.payload.success, reason: String(r.payload.reason || "playback_not_located").slice(0,120)};
      return {received:true};
    }
    return this.action(r);
  }
  get connected(): boolean {
    return this.sessions.connected;
  }
  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.local.port, "127.0.0.1", () => {
        this.server.removeListener("error", reject);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw Error("listen_failed");
    this.local.port = address.port;
    await this.saveLocal();
  }
  ticket(url: string): string {
    for (const [key,p] of this.launches) if(p.expires<Date.now())this.launches.delete(key);
    for (const [key, p] of this.tickets)
      if (p.expires < Date.now()) this.tickets.delete(key);
    if (this.tickets.size + this.launches.size >= 16) throw Error("launch_busy");
    const key = randomBytes(32).toString("hex");
    this.tickets.set(key, { url, expires: Date.now() + 30000, clientId: this.sessions.targetId(), target: this.sessions.targetKey() });
    return key;
  }
  takeLaunchResult(ticket: string) {
    const p=this.launches.get(ticket);
    if(!p?.result)return null;
    this.launches.delete(ticket);
    return p.result;
  }
  clients() { return this.sessions.list(); }
  targetKey() { return this.sessions.targetKey(); }
  get pending() { return this.sessions.pending; }
  async bindClient(clientId: string): Promise<void> {
    const client=this.clients().find(c=>c.clientId===clientId&&c.capabilities.includes("capture-link"));
    if(!client)throw Error("browser_update_required");
    this.invalidateTarget();
    this.local.browserBindings={...this.local.browserBindings,[this.local.browserBundle]:clientId};
    await this.saveLocal();
  }
  invalidateTarget():void { this.playback.cancel();this.sessions.cancel(); this.tickets.clear(); this.launches.clear(); }
  supportsPlaybackV2():boolean{return this.sessions.supportsPlaybackV2();}
  async playV2(url:string,id:string):Promise<boolean>{
    const clientId=this.sessions.targetId();
    return this.sessions.playV2(url,id,()=>{this.playback.report({operationId:id,clientId,phase:"received"});},value=>{
      const r=value as {success?:boolean;reason?:string;reasonCode?:string;pausedAfterLocate?:boolean};
      this.playback.report({operationId:id,clientId,phase:r.success?"located":"failed",reasonCode:r.pausedAfterLocate?"playback_requires_user_gesture":r.reason||r.reasonCode});
    });
  }
  async capture():Promise<unknown> { return this.sessions.request("capture-link",{}); }
  async play(url: string): Promise<unknown> {
    this.diagnostics.playRequests++;
    return this.sessions.request("play",{url});
  }
  stop(): void {
    this.playback.cancel();this.sessions.stop();
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
    this.server.close();
    this.tickets.clear();this.launches.clear();this.results.clear();
  }
}
