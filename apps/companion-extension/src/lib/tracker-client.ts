/**
 * Session Tracker API client. Auth = the companion DEVICE token (Bearer). credentials: "omit" so
 * neither tracker web cookies nor anything else rides along; Capcom data never reaches here raw.
 */
import {
  companionPairResponseSchema,
  companionStateSchema,
  companionSyncResponseSchema,
  findForbiddenKeys,
  type CompanionPairResponse,
  type CompanionState,
  type CompanionSyncRequest,
  type CompanionSyncResponse,
} from "@sf6/capcom-core";

export class TrackerError extends Error {
  override readonly name = "TrackerError";
  constructor(
    readonly status: number | null,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
  /** 401 = token unknown or revoked → the pairing is gone. */
  get unauthorized(): boolean {
    return this.status === 401;
  }
}

export class TrackerClient {
  constructor(
    readonly baseUrl: string,
    private readonly deviceToken: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(path: string, init: { method: string; body?: unknown }): Promise<unknown> {
    if (init.body !== undefined) {
      const leaks = findForbiddenKeys(init.body);
      if (leaks.length > 0) {
        // Defence in depth: refuse to send anything that even looks like a credential.
        throw new TrackerError(null, "forbidden_payload", `refusing to send ${leaks.join(", ")}`);
      }
    }
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (this.deviceToken) headers.authorization = `Bearer ${this.deviceToken}`;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, "")}${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        credentials: "omit",
        cache: "no-store",
      });
    } catch (err) {
      throw new TrackerError(null, "network", err instanceof Error ? err.message : String(err));
    }
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const code =
        data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : `http_${res.status}`;
      throw new TrackerError(res.status, code, `tracker answered ${res.status} (${code})`);
    }
    return data;
  }

  async pair(code: string, deviceName: string): Promise<CompanionPairResponse> {
    const data = await this.request("/api/companion/pair", {
      method: "POST",
      body: { code, deviceName },
    });
    return companionPairResponseSchema.parse(data);
  }

  async state(): Promise<CompanionState> {
    return companionStateSchema.parse(
      await this.request("/api/companion/state", { method: "GET" }),
    );
  }

  async sync(payload: CompanionSyncRequest): Promise<CompanionSyncResponse> {
    const data = await this.request("/api/companion/sync", { method: "POST", body: payload });
    return companionSyncResponseSchema.parse(data);
  }

  async disconnect(): Promise<void> {
    await this.request("/api/companion/disconnect", { method: "POST", body: {} });
  }
}
