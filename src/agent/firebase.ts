import { createPrivateKey } from "node:crypto";
import { AgentError } from "./contracts.js";

export interface FirebaseAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}
// Existing Ride uses FCM_SERVICE_ACCOUNT_JSON_BASE64. Keep the V3 raw-JSON
// setting compatible, and never include credential text in an error/result.
export function firebaseAccount(
  env: NodeJS.ProcessEnv = process.env,
): FirebaseAccount | null {
  const raw =
    env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() ||
    env.FCM_SERVICE_ACCOUNT_JSON?.trim();
  const encoded = env.FCM_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  if (!raw && !encoded) return null;
  try {
    if (!raw && !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded!)) throw 0;
    const account = JSON.parse(
      raw || Buffer.from(encoded!, "base64").toString("utf8"),
    );
    if (
      account.type !== "service_account" ||
      typeof account.project_id !== "string" ||
      !/^[a-z][a-z0-9-]{4,60}$/.test(account.project_id) ||
      typeof account.client_email !== "string" ||
      !account.client_email.endsWith(".gserviceaccount.com") ||
      typeof account.private_key !== "string" ||
      createPrivateKey(account.private_key).asymmetricKeyType !== "rsa" ||
      (env.RIDE_AGENT_FCM_PROJECT_ID &&
        account.project_id !== env.RIDE_AGENT_FCM_PROJECT_ID)
    )
      throw 0;
    return {
      project_id: account.project_id,
      client_email: account.client_email,
      private_key: account.private_key,
    };
  } catch {
    throw new AgentError(
      "PUSH_CONFIGURATION_INVALID",
      "Ride push credentials are invalid or belong to a different Firebase project.",
      false,
      503,
    );
  }
}
