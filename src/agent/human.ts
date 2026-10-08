import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import { z } from "zod";
import { AgentError, failure, publicResult } from "./contracts.js";
import type { PrivyAuthorizationInput, RideAuthPageConfig } from "../oauth.js";

export function mountHumanConfirmation(
  app: Express,
  options: {
    backend: string;
    base: string;
    cookieKey: string;
    auth: RideAuthPageConfig;
    exchange: (
      input: PrivyAuthorizationInput,
    ) => Promise<{ rideAuthToken: string }>;
  },
): void {
  if (options.cookieKey.length < 32)
    throw new Error(
      "Human session cookie key must contain at least 32 characters",
    );
  const key = createHash("sha256").update(options.cookieKey).digest(),
    origin = new URL(options.base).origin;
  const seal = (v: unknown) => {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv),
      body = Buffer.concat([cipher.update(JSON.stringify(v)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
  };
  const unseal = (v: string) => {
    try {
      const b = Buffer.from(v, "base64url"),
        decipher = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
      decipher.setAuthTag(b.subarray(12, 28));
      const s = JSON.parse(
        Buffer.concat([
          decipher.update(b.subarray(28)),
          decipher.final(),
        ]).toString(),
      );
      if (s.expires_at < Date.now()) throw 0;
      return s as { token: string; csrf: string; expires_at: number };
    } catch {
      throw new AgentError(
        "AUTH_REQUIRED",
        "Sign in to Ride to confirm.",
        false,
        401,
      );
    }
  };
  app.get("/agent/confirm/:proposalId", async (req, res) => {
    if (!/^proposal_[a-zA-Z0-9_-]{8,100}$/.test(req.params.proposalId)) {
      res.status(404).end();
      return;
    }
    const template = await readFile(
      fileURLToPath(new URL("../../public/confirm.html", import.meta.url)),
      "utf8",
    );
    const config = {
      proposal_id: req.params.proposalId,
      privy_app_id: options.auth.privyAppId,
      privy_client_id: options.auth.privyClientId,
      privy_sdk: options.auth.jsSdkUrl,
    };
    res
      .set("Cache-Control", "no-store")
      .type("html")
      .send(
        template.replace(
          "/*CONFIG*/{}",
          JSON.stringify(config).replaceAll("<", "\\u003c"),
        ),
      );
  });
  app.post("/agent/human/login", async (req, res) => {
    try {
      if (req.get("origin") !== origin)
        throw new AgentError(
          "ORIGIN_REQUIRED",
          "Ride browser origin is required.",
          false,
          403,
        );
      const input = z
        .object({
          privyId: z.string().min(1),
          privyAccessToken: z.string().min(1),
          email: z.string().optional(),
          walletAddress: z.string().optional(),
          privyWalletId: z.string().optional(),
          authProvider: z.string().optional(),
          accessCode: z.string().optional(),
        })
        .strict()
        .parse(req.body);
      const exchanged = await options.exchange(input),
        csrf = randomBytes(32).toString("base64url");
      res.cookie(
        "ride_agent_human",
        seal({
          token: exchanged.rideAuthToken,
          csrf,
          expires_at: Date.now() + 15 * 60_000,
        }),
        {
          httpOnly: true,
          secure: new URL(origin).protocol === "https:",
          sameSite: "strict",
          path: "/agent",
          maxAge: 15 * 60_000,
        },
      );
      res.set("Cache-Control", "no-store").json({ csrf });
    } catch (e) {
      res.status(e instanceof AgentError ? e.httpStatus : 400).json(failure(e));
    }
  });
  const allowed = new Set([
    "proposal",
    "confirm",
    "reject",
    "authorize",
    "revoke",
    "portfolio",
    "updates",
  ]);
  app.post("/agent/human/:operation", async (req, res) => {
    try {
      if (req.get("origin") !== origin || !allowed.has(req.params.operation))
        throw new AgentError(
          "ORIGIN_REQUIRED",
          "Ride browser origin is required.",
          false,
          403,
        );
      const cookies = Object.fromEntries(
        (req.headers.cookie ?? "").split(";").map((x) => x.trim().split("=")),
      );
      const session = unseal(cookies.ride_agent_human ?? ""),
        given = Buffer.from(req.get("x-ride-csrf") ?? ""),
        expected = Buffer.from(session.csrf);
      if (given.length !== expected.length || !timingSafeEqual(given, expected))
        throw new AgentError(
          "CSRF_REQUIRED",
          "Refresh the Ride sign-in session.",
          false,
          403,
        );
      const response = await fetch(
        new URL(`/agent/human/${req.params.operation}`, options.backend),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify(req.body),
          signal: AbortSignal.timeout(25000),
          redirect: "error",
        },
      );
      const value = publicResult(await response.json());
      res.status(response.status).set("Cache-Control", "no-store").json(value);
    } catch (e) {
      res.status(e instanceof AgentError ? e.httpStatus : 503).json(failure(e));
    }
  });
}
