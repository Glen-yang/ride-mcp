import type { Express, RequestHandler } from "express";
import {
  AgentError,
  failure,
  inputs,
  mutationTools,
  stateTools,
  publicResult,
  TOOL_NAMES,
  type ToolName,
} from "./contracts.js";
import { invokeAgent } from "./mcp.js";
import { accountCopiesInput } from "../account_reads.js";
import type { Result } from "./contracts.js";

export function mountAgentProxy(
  app: Express,
  auth: RequestHandler,
  backend: string,
  readOnly = false,
  accountRead?: (
    name: "get_portfolio" | "get_my_copies",
    args: unknown,
    token: string,
  ) => Promise<Result>,
): void {
  app.post("/agent/v1/:operation", auth, async (req, res) => {
    try {
      const name = req.params.operation;
      if (
        typeof name !== "string" ||
        (!TOOL_NAMES.includes(name as ToolName) &&
          name !== "proposal" &&
          !(accountRead && name === "get_my_copies"))
      )
        throw new AgentError("NOT_FOUND", "Unknown operation.", false, 404);
      if (
        readOnly &&
        (mutationTools.has(name as ToolName) ||
          (stateTools.has(name as ToolName) && name !== "recommend_traders") ||
          name === "proposal")
      )
        throw new AgentError(
          "READ_ONLY",
          "Trading is not enabled on this deployment.",
          false,
          403,
        );
      const scope = mutationTools.has(name as ToolName)
        ? "ride:trade"
        : "ride:read";
      if (!req.auth?.scopes.includes(scope))
        throw new AgentError(
          "SCOPE_REQUIRED",
          `Missing ${scope} permission.`,
          false,
          403,
        );
      const coreToken = req.auth?.extra?.rideAuthToken;
      if (typeof coreToken !== "string")
        throw new AgentError(
          "AUTH_REQUIRED",
          "A Ride OAuth session is required.",
          false,
          401,
        );
      const args =
        name === "proposal"
          ? req.body
          : name === "get_my_copies"
            ? accountCopiesInput.parse(req.body)
            : inputs[name as ToolName].parse(req.body);
      const value =
        accountRead && (name === "get_portfolio" || name === "get_my_copies")
          ? await accountRead(name, args, coreToken)
          : await invokeAgent(backend, coreToken, name, args);
      res.set("Cache-Control", "no-store").json(publicResult(value));
    } catch (e) {
      res.status(e instanceof AgentError ? e.httpStatus : 400).json(failure(e));
    }
  });
}
