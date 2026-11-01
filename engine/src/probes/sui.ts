// §4.4 probe:sui: read the Walrus Memory account object through Tatum's Sui gateway, saved raw.
// Tatum's Sui host no longer serves JSON-RPC (HTTP 404; its /_methods lists only GraphQL), and its gRPC
// host speaks native gRPC only, so the read goes over the gateway's GraphQL endpoint (DECISIONS D14).
import { delegateKeyToPublicKey } from "@mysten-incubation/memwal";
import { loadConfig, requireEnv } from "../config";
import { say } from "../log";
import { tatumLimiter } from "../util/ratelimit";
import { findDelegateKey } from "../verify/proof";
import { saveFixture } from "./fixture";
import { fetchRaw } from "./http";

const PROBE = "probe:sui";

export const ACCOUNT_OBJECT_QUERY = `query ($id: SuiAddress!) {
  object(address: $id) {
    address
    version
    digest
    owner { __typename }
    asMoveObject { contents { type { repr } json } }
  }
}`;

interface DelegateKeyJson {
  public_key?: string;
  sui_address?: string;
  label?: string;
}

interface GraphQlReply {
  data?: {
    object?: {
      address: string;
      version: number | string;
      digest: string;
      owner?: { __typename?: string };
      asMoveObject?: { contents?: { type?: { repr?: string }; json?: { owner?: string; delegate_keys?: DelegateKeyJson[] } } };
    } | null;
  };
  errors?: { message?: string }[];
}

export async function probeSui(): Promise<void> {
  const config = loadConfig();
  const env = requireEnv(config, ["TATUM_API_KEY", "MEMWAL_ACCOUNT_ID"]);
  const base = config.TATUM_SUI_RPC_URL.replace(/\/+$/, "");
  const headers = { "x-api-key": env.TATUM_API_KEY, accept: "application/json" };
  const redactedHeaders = { "x-api-key": "<TATUM_API_KEY>" };

  const methods = await fetchRaw(`${base}/_methods`, { headers }, { limiter: tatumLimiter });
  saveFixture("sui-gateway-methods.json", {
    probe: PROBE,
    request: { method: "GET", url: `${base}/_methods`, headers: redactedHeaders },
    response: methods,
  });
  say(`gateway interfaces (HTTP ${methods.status}): ${JSON.stringify(methods.body).slice(0, 240)}`);

  const request = { query: ACCOUNT_OBJECT_QUERY, variables: { id: env.MEMWAL_ACCOUNT_ID } };
  const res = await fetchRaw(
    `${base}/graphql`,
    { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(request) },
    { limiter: tatumLimiter },
  );
  const file = saveFixture("sui-graphql-account.json", {
    probe: PROBE,
    request: { method: "POST", url: `${base}/graphql`, headers: redactedHeaders, body: request },
    response: res,
  });

  say(`GraphQL object read: HTTP ${res.status} in ${res.ms} ms (attempts: ${res.attempts})`);
  const reply = (typeof res.body === "object" && res.body !== null ? res.body : {}) as GraphQlReply;
  if (reply.errors?.length) say(`  errors: ${JSON.stringify(reply.errors).slice(0, 400)}`);
  const obj = reply.data?.object;
  if (!obj) {
    say("  No object at MEMWAL_ACCOUNT_ID. It may be a wallet address instead of the account object ID.");
  } else {
    const contents = obj.asMoveObject?.contents;
    say(`  objectId  ${obj.address}`);
    say(`  version   ${obj.version}`);
    say(`  digest    ${obj.digest}`);
    say(`  type      ${contents?.type?.repr}`);
    say(`  owner     ${obj.owner?.__typename} object; account owner ${contents?.json?.owner}`);
    const delegates = contents?.json?.delegate_keys ?? [];
    say(`  registered delegate keys: ${delegates.map((d) => `"${d.label}" ${d.sui_address}`).join(", ") || "(none)"}`);
    if (config.MEMWAL_PRIVATE_KEY) {
      const where = findDelegateKey(JSON.stringify(contents?.json ?? {}), await delegateKeyToPublicKey(config.MEMWAL_PRIVATE_KEY));
      say(`  MEMWAL_PRIVATE_KEY's public key in object content: ${where ?? "NOT FOUND (this key is not a registered delegate)"}`);
    }
  }
  say(`  saved ${file}`);
}
