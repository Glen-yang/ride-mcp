import { AgentError } from "./contracts.js";
import type {
  AccountSnapshot,
  Candidate,
  Portfolio,
  PositionIntent,
  Execution,
} from "./domain.js";

export interface SourceSnapshot {
  observed_at: number;
  revision: string;
  account_value_usdc: string;
  positions: PositionIntent[];
  complete: boolean;
}
export interface VenueAdapter {
  candidates(): Promise<Candidate[]>;
  profile(id: string): Promise<Candidate>;
  preflight(
    user: string,
    portfolio: Portfolio | null,
  ): Promise<AccountSnapshot>;
  bind(user: string, portfolio: Portfolio): Promise<AccountSnapshot>;
  account(user: string, portfolio: Portfolio): Promise<AccountSnapshot>;
  source(trader: Candidate): Promise<SourceSnapshot>;
  submit(
    user: string,
    portfolio: Portfolio,
    execution: Execution,
  ): Promise<{ task_id: string }>;
  execution(
    user: string,
    portfolio: Portfolio,
    execution: Execution,
  ): Promise<{
    task_id?: string;
    status: Execution["status"];
    observed_quantity: string | null;
    settled: boolean;
  }>;
  fence(user: string, portfolio: Portfolio): Promise<void>;
  cancelIncreasing(user: string, portfolio: Portfolio): Promise<void>;
  release(user: string, portfolio: Portfolio): Promise<void>;
  notify(
    user: string,
    event: {
      id: string;
      kind: string;
      message: string;
      portfolio_id: string | null;
    },
  ): Promise<void>;
}
// Private, authenticated execution boundary. It holds Core S2S identity, never
// signing secrets. Its responses are normalized; machine routes cannot confirm.
export class BridgeAdapter implements VenueAdapter {
  constructor(
    private url: string,
    private token: string,
    privateHttpHost?: string,
  ) {
    const u = new URL(url);
    const privateHttp =
      u.protocol === "http:" &&
      u.hostname === privateHttpHost &&
      /^[a-z0-9-]+\.railway\.internal$/.test(u.hostname);
    if (
      u.protocol !== "https:" &&
      !["127.0.0.1", "localhost"].includes(u.hostname) &&
      !privateHttp
    )
      throw new Error("Executor must use HTTPS, loopback or an explicitly configured private host");
    if (u.username || u.password)
      throw new Error("Executor URL must not contain credentials");
    if (!token) throw new Error("Missing executor service token");
  }
  private async call<T>(operation: string, input: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(
        new URL(`/internal/agent/${operation}`, this.url),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(20000),
          redirect: "error",
        },
      );
    } catch {
      throw new AgentError(
        "EXECUTOR_UNAVAILABLE",
        "Execution boundary did not respond; pending submissions remain unresolved.",
        true,
        503,
      );
    }
    const data = (await response.json()) as {
      error?: { code: string; message: string };
    };
    if (!response.ok)
      throw new AgentError(
        data.error?.code ?? "EXECUTOR_ERROR",
        data.error?.message ?? "Execution boundary rejected the request.",
        response.status >= 500,
        response.status,
      );
    return data as T;
  }
  candidates() {
    return this.call<Candidate[]>("candidates", {});
  }
  profile(id: string) {
    return this.call<Candidate>("profile", { trader_id: id });
  }
  preflight(user: string, portfolio: Portfolio | null) {
    return this.call<AccountSnapshot>("preflight", {
      user_id: user,
      portfolio,
    });
  }
  bind(user: string, portfolio: Portfolio) {
    return this.call<AccountSnapshot>("bind", { user_id: user, portfolio });
  }
  account(user: string, portfolio: Portfolio) {
    return this.call<AccountSnapshot>("account", { user_id: user, portfolio });
  }
  source(trader: Candidate) {
    return this.call<SourceSnapshot>("source", { trader_id: trader.id });
  }
  submit(user: string, portfolio: Portfolio, execution: Execution) {
    return this.call<{ task_id: string }>("submit", {
      user_id: user,
      portfolio,
      execution,
    });
  }
  execution(user: string, portfolio: Portfolio, execution: Execution) {
    return this.call<{
      task_id?: string;
      status: Execution["status"];
      observed_quantity: string | null;
      settled: boolean;
    }>("execution", { user_id: user, portfolio, execution });
  }
  async fence(user: string, portfolio: Portfolio) {
    await this.call("fence", { user_id: user, portfolio });
  }
  async release(user: string, portfolio: Portfolio) {
    await this.call("release", { user_id: user, portfolio });
  }
  async cancelIncreasing(user: string, portfolio: Portfolio) {
    await this.call("cancel_increasing", { user_id: user, portfolio });
  }
  async notify(
    user: string,
    event: {
      id: string;
      kind: string;
      message: string;
      portfolio_id: string | null;
    },
  ) {
    await this.call("notify", { user_id: user, event });
  }
}
