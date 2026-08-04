import { and, desc, eq } from "drizzle-orm";
import {
  type ConnectedAssistant,
  err,
  type OAuthConsentId,
  ok,
  parseOAuthConsentId,
  type Result,
  type UserId,
} from "../../shared/index.ts";
import {
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
} from "../auth/schema.ts";
import type { Db } from "../db/index.ts";

export type AssistantError =
  | { kind: "not_found"; message: string }
  | { kind: "internal_error"; message: string };

export type AssistantsService = {
  list(userId: UserId): Promise<Result<ConnectedAssistant[], AssistantError>>;
  revoke(
    userId: UserId,
    id: OAuthConsentId,
  ): Promise<Result<{ id: OAuthConsentId; clientId: string }, AssistantError>>;
};

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : "Unexpected error");

const displayName = (name: string | null, clientId: string): string => {
  const trimmed = name?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : clientId;
};

export const createAssistantsService = (db: Db): AssistantsService => ({
  async list(userId) {
    try {
      const rows = await db
        .select({
          id: oauthConsents.id,
          clientId: oauthConsents.clientId,
          createdAt: oauthConsents.createdAt,
          updatedAt: oauthConsents.updatedAt,
          clientName: oauthClients.name,
        })
        .from(oauthConsents)
        .leftJoin(oauthClients, eq(oauthClients.clientId, oauthConsents.clientId))
        .where(eq(oauthConsents.userId, userId))
        .orderBy(desc(oauthConsents.createdAt));

      const assistants = rows.map(
        (row): ConnectedAssistant => ({
          id: parseOAuthConsentId(row.id),
          clientId: row.clientId,
          name: displayName(row.clientName, row.clientId),
          connectedAt: row.createdAt?.getTime() ?? row.updatedAt?.getTime() ?? 0,
        }),
      );
      return ok(assistants);
    } catch (e) {
      return err({ kind: "internal_error", message: errorMessage(e) });
    }
  },

  async revoke(userId, id) {
    try {
      const rows = await db
        .select({ clientId: oauthConsents.clientId, userId: oauthConsents.userId })
        .from(oauthConsents)
        .where(eq(oauthConsents.id, id))
        .limit(1);
      const consent = rows[0];
      if (consent === undefined || consent.userId !== userId) {
        return err({ kind: "not_found", message: "No such connected assistant" });
      }

      const { clientId } = consent;
      // Deleting the consent + refresh token is what durably revokes: the client
      // can no longer mint a new token. The live access token is a stateless JWT
      // (verified against JWKS, never read from here), so it survives until it
      // expires — bounded by oauthProvider.accessTokenExpiresIn. Better Auth has
      // no server-side JWT revocation by design.
      await db
        .delete(oauthAccessTokens)
        .where(and(eq(oauthAccessTokens.userId, userId), eq(oauthAccessTokens.clientId, clientId)));
      await db
        .delete(oauthRefreshTokens)
        .where(
          and(eq(oauthRefreshTokens.userId, userId), eq(oauthRefreshTokens.clientId, clientId)),
        );
      await db.delete(oauthConsents).where(eq(oauthConsents.id, id));

      return ok({ id, clientId });
    } catch (e) {
      return err({ kind: "internal_error", message: errorMessage(e) });
    }
  },
});
