import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { oauthClientResources, oauthClients, oauthResources } from "./schema.ts";

export type ResourceBackfill = {
  resourceCreated: boolean;
  clientsLinked: number;
};

// Better Auth 1.7 will only mint a token for a resource the requesting client is
// linked to through `oauthClientResource`, and it writes those links in exactly one
// place: dynamic client registration. Clients that registered under 1.6 therefore
// have none, and every one of them is refused with `invalid_target` the moment 1.7
// takes over. Migration 0007 cannot fix this itself because the resource identifier
// comes from BETTER_AUTH_URL at runtime, not from anything SQL can see.
//
// The seeded row mirrors what the plugin's own seeding writes (name defaults to the
// identifier), and `resourceSeedMode` defaults to "insertOnly", so the plugin leaves
// this row alone once it boots.
//
// Changing BETTER_AUTH_URL registers a second resource and leaves every client linked
// to both. Nothing here or in the plugin removes the old row. That is inert — a token
// minted for the old identifier carries the old `aud`, which the MCP guard checks
// against the current base URL and refuses — but the rows do accumulate, so a
// deployment that moves to a real domain wants them cleaned out by hand.
export const linkExistingClientsToResource = async (
  db: Db,
  resourceIdentifier: string,
): Promise<ResourceBackfill> => {
  const now = new Date();

  const existingResource = await db
    .select({ identifier: oauthResources.identifier })
    .from(oauthResources)
    .where(eq(oauthResources.identifier, resourceIdentifier))
    .limit(1);

  const resourceCreated = existingResource.length === 0;
  if (resourceCreated) {
    await db.insert(oauthResources).values({
      id: crypto.randomUUID(),
      identifier: resourceIdentifier,
      name: resourceIdentifier,
      createdAt: now,
      updatedAt: now,
    });
  }

  const clients = await db.select({ clientId: oauthClients.clientId }).from(oauthClients);
  if (clients.length === 0) return { resourceCreated, clientsLinked: 0 };

  const clientIds = clients.map((c) => c.clientId);
  const linked = await db
    .select({ clientId: oauthClientResources.clientId })
    .from(oauthClientResources)
    .where(eq(oauthClientResources.resourceId, resourceIdentifier));
  const alreadyLinked = new Set(linked.map((l) => l.clientId));

  const missing = clientIds.filter((clientId) => !alreadyLinked.has(clientId));
  if (missing.length === 0) return { resourceCreated, clientsLinked: 0 };

  await db.insert(oauthClientResources).values(
    missing.map((clientId) => ({
      id: crypto.randomUUID(),
      clientId,
      resourceId: resourceIdentifier,
      createdAt: now,
    })),
  );

  return { resourceCreated, clientsLinked: missing.length };
};
