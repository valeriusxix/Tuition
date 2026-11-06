// §11 chain reads through Tatum's Sui gateway. The gateway serves GraphQL, not JSON-RPC (DECISIONS D14).
import { z } from "zod";
import { fetchRaw } from "../probes/http";
import { tatumLimiter } from "../util/ratelimit";

export const ACCOUNT_OBJECT_QUERY = `query ($id: SuiAddress!) {
  object(address: $id) {
    address
    version
    digest
    owner { __typename }
    asMoveObject { contents { type { repr } json } }
  }
}`;

const AccountReplySchema = z.object({
  data: z
    .object({
      object: z
        .object({
          address: z.string(),
          version: z.union([z.number(), z.string()]),
          digest: z.string(),
          owner: z.object({ __typename: z.string() }),
          asMoveObject: z.object({
            contents: z.object({
              type: z.object({ repr: z.string() }),
              json: z.looseObject({ owner: z.string().optional() }),
            }),
          }),
        })
        .nullable(),
    })
    .optional(),
  errors: z.array(z.looseObject({ message: z.string().optional() })).optional(),
});

export interface AccountObject {
  objectId: string;
  version: string;
  digest: string;
  type: string;
  owner: string;
  accountOwner: string | null;
  /** The Move object's fields, as JSON text, for finding the delegate key. */
  contentJson: string;
}

/** Pure: the account object out of a GraphQL reply. Throws if the reply has no object. */
export function parseAccountReply(body: unknown): AccountObject {
  const reply = AccountReplySchema.parse(body);
  if (reply.errors?.length) throw new Error(`Sui GraphQL error: ${JSON.stringify(reply.errors).slice(0, 300)}`);
  const obj = reply.data?.object;
  if (!obj) throw new Error("No object at this ID. MEMWAL_ACCOUNT_ID may be a wallet address instead of the account object ID.");
  const { type, json } = obj.asMoveObject.contents;
  return {
    objectId: obj.address,
    version: String(obj.version),
    digest: obj.digest,
    type: type.repr,
    owner: obj.owner.__typename,
    accountOwner: json.owner ?? null,
    contentJson: JSON.stringify(json),
  };
}

export async function readAccountObject(rpcUrl: string, apiKey: string, accountId: string): Promise<AccountObject> {
  const url = `${rpcUrl.replace(/\/+$/, "")}/graphql`;
  const res = await fetchRaw(
    url,
    {
      method: "POST",
      headers: { "x-api-key": apiKey, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ query: ACCOUNT_OBJECT_QUERY, variables: { id: accountId } }),
    },
    { limiter: tatumLimiter },
  );
  if (res.status !== 200) throw new Error(`Tatum Sui gateway answered HTTP ${res.status}`);
  return parseAccountReply(res.body);
}
