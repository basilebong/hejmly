import { eq, inArray } from "drizzle-orm";
import { err, ok, parseUserId, type Result, type UserId } from "../../shared/index.ts";
import type { Db } from "../db/index.ts";
import { isAllowedEmail } from "./allowlist.ts";
import type { Auth } from "./index.ts";
import { oauthAccessTokens, oauthConsents, oauthRefreshTokens, users } from "./schema.ts";

export type MembershipError = { kind: "internal_error"; message: string };

export type MembershipService = {
  allowsEmail(email: unknown): boolean;
  isMember(userId: UserId): Promise<Result<boolean, MembershipError>>;
  revokeFormerMembers(): Promise<Result<{ revoked: UserId[] }, MembershipError>>;
};

export type CreateMembershipOptions = {
  auth: Auth;
  db: Db;
  allowedEmails: ReadonlySet<string>;
};

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : "Unexpected error");

export const findUserEmail = async (db: Db, userId: string): Promise<string | null> => {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.email ?? null;
};

export const createMembershipService = ({
  auth,
  db,
  allowedEmails,
}: CreateMembershipOptions): MembershipService => ({
  allowsEmail: (email) => isAllowedEmail(allowedEmails, email),

  async isMember(userId) {
    try {
      return ok(isAllowedEmail(allowedEmails, await findUserEmail(db, userId)));
    } catch (e) {
      return err({ kind: "internal_error", message: errorMessage(e) });
    }
  },

  async revokeFormerMembers() {
    try {
      const everyone = await db.select({ id: users.id, email: users.email }).from(users);
      const revoked = everyone
        .filter((user) => !isAllowedEmail(allowedEmails, user.email))
        .map((user) => parseUserId(user.id));
      if (revoked.length === 0) return ok({ revoked });

      const { internalAdapter } = await auth.$context;
      for (const userId of revoked) await internalAdapter.deleteUserSessions(userId);

      await db.delete(oauthAccessTokens).where(inArray(oauthAccessTokens.userId, revoked));
      await db.delete(oauthRefreshTokens).where(inArray(oauthRefreshTokens.userId, revoked));
      await db.delete(oauthConsents).where(inArray(oauthConsents.userId, revoked));

      return ok({ revoked });
    } catch (e) {
      return err({ kind: "internal_error", message: errorMessage(e) });
    }
  },
});
