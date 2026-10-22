import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { LocalState } from "./local-state";
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
  private peer: WebSocket | null = null;
  private tickets = new Map<string, { url: string; expires: number }>();
  private launches = new Map<string, { url: string; expires: number; result?: {success: boolean; reason: string} }>();
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }
  >();
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
  diagnostics = { httpRequests: 0, heartbeats: 0, playRequests: 0 };
  constructor(
    readonly local: LocalState,
    private saveLocal: () => Promise<void>,
    private action: (request: RequestEnvelope) => Promise<unknown>,
  ) {
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
          r.protocolVersion !== "1.0" ||
          !r.requestId ||
          r.requestId.length > 120 ||
          !r.payload ||
          ![
            "ensure",
            "find",
            "refresh",
            "open",
            "consume-launch",
            "launch-result",
            "status",
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
      let authenticated = false;
      const authTimer = setTimeout(() => ws.close(1008), 3000);
      ws.on("message", (bytes) => {
        try {
          const msg = JSON.parse(bytes.toString());
          if (!authenticated) {
            if (
              msg.type !== "auth" ||
              !this.equal(String(msg.secret || ""), local.secret)
            ) {
              ws.close(1008);
              return;
            }
            authenticated = true;
            clearTimeout(authTimer);
            this.peer?.close(1000);
            this.peer = ws;
            ws.send(JSON.stringify({ type: "ready" }));
            return;
          }
          if (msg.type === "ping") {
            this.diagnostics.heartbeats++;
            ws.send(JSON.stringify({ type: "pong" }));
          }
          if (msg.type === "play-result") {
            const p = this.pending.get(msg.requestId);
            if (p) {
              clearTimeout(p.timer);
              this.pending.delete(msg.requestId);
              p.resolve(msg.result);
            }
          }
        } catch {
          ws.close(1008);
        }
      });
      ws.on("close", () => {
        clearTimeout(authTimer);
        if (this.peer === ws) this.peer = null;
      });
      ws.on("error", () => ws.close());
    });
  }
  private equal(a: string, b: string): boolean {
    const x = Buffer.from(a),
      y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }
  private async execute(r: RequestEnvelope): Promise<unknown> {
    if (r.action === "status")
      return { vaultId: this.local.vaultId, connected: this.connected };
    if (r.action === "consume-launch") {
      const ticket = String(r.payload.ticket || ""),
        p = this.tickets.get(ticket);
      this.tickets.delete(ticket);
      if (!p || p.expires < Date.now() || p.url !== r.payload.url)
        throw Error("launch_ticket_invalid");
      this.launches.set(ticket, p);
      return { url: p.url };
    }
    if (r.action === "launch-result") {
      const p = this.launches.get(String(r.payload.ticket || ""));
      if (!p || p.expires < Date.now() || p.url !== r.payload.url || p.result || typeof r.payload.success !== "boolean") throw Error("launch_ticket_invalid");
      p.result = {success: r.payload.success, reason: String(r.payload.reason || "playback_not_located").slice(0,120)};
      return {received:true};
    }
    return this.action(r);
  }
  get connected(): boolean {
    return this.peer?.readyState === WebSocket.OPEN;
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
    this.tickets.set(key, { url, expires: Date.now() + 30000 });
    return key;
  }
  takeLaunchResult(ticket: string) {
    const p=this.launches.get(ticket);
    if(!p?.result)return null;
    this.launches.delete(ticket);
    return p.result;
  }
  play(url: string): Promise<unknown> {
    if (!this.connected) return Promise.reject(Error("browser_disconnected"));
    if (this.pending.size >= 8) return Promise.reject(Error("play_busy"));
    this.diagnostics.playRequests++;
    const requestId = randomBytes(16).toString("hex");
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ success: false, reasonCode: "play_timeout" });
      }, 20000);
      this.pending.set(requestId, { resolve, timer });
      this.peer!.send(JSON.stringify({ type: "play", url, requestId, expiresAt: Date.now() + 19000 }));
    });
  }
  stop(): void {
    this.peer = null;
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
    this.server.close();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve({ success: false, reasonCode: "bridge_stopped" });
    }
    this.pending.clear();
    this.tickets.clear();
    this.launches.clear();
    this.results.clear();
  }
}
