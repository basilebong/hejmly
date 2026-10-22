import { inArray, like } from "drizzle-orm";
import * as v from "valibot";
import {
  err,
  ok,
  parseUserId,
  type Result,
  type UserId,
  UserIdSchema,
} from "../../shared/index.ts";
import type { Db } from "../db/index.ts";
import { isAllowedEmail } from "./allowlist.ts";
import type { Auth } from "./index.ts";
import {
  oauthAccessTokens,
  oauthConsents,
  oauthRefreshTokens,
  users,
  verifications,
} from "./schema.ts";
import { findUserEmail } from "./users.ts";

export type MembershipError =
  | { kind: "empty_allowlist"; message: string }
  | { kind: "internal_error"; message: string; cause: unknown };

export type MembershipService = {
  allowsEmail(email: unknown): boolean;
  isMember(userId: UserId): Promise<Result<boolean, MembershipError>>;
  revokeFormerMembers(): Promise<Result<{ formerMembers: UserId[] }, MembershipError>>;
};

export type CreateMembershipOptions = {
  auth: Auth;
  db: Db;
  allowedEmails: ReadonlySet<string>;
};

const internalError = (cause: unknown): MembershipError => ({
  kind: "internal_error",
  message: cause instanceof Error ? cause.message : "Unexpected error",
  cause,
});

const authorizationCodeSchema = v.object({
  type: v.literal("authorization_code"),
  userId: UserIdSchema,
});

const authorizationCodeOwner = (value: string): UserId | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  const code = v.safeParse(authorizationCodeSchema, parsed);
  return code.success ? code.output.userId : null;
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
      return err(internalError(e));
    }
  },

  async revokeFormerMembers() {
    if (allowedEmails.size === 0) {
      return err({
        kind: "empty_allowlist",
        message: "The allowlist is empty; refusing to revoke every user",
      });
    }
    try {
      const everyone = await db.select({ id: users.id, email: users.email }).from(users);
      const formerMembers = everyone
        .filter((user) => !isAllowedEmail(allowedEmails, user.email))
        .map((user) => parseUserId(user.id));
      if (formerMembers.length === 0) return ok({ formerMembers });

      const { internalAdapter } = await auth.$context;
      for (const userId of formerMembers) await internalAdapter.deleteUserSessions(userId);

      await db.delete(oauthAccessTokens).where(inArray(oauthAccessTokens.userId, formerMembers));
      await db.delete(oauthRefreshTokens).where(inArray(oauthRefreshTokens.userId, formerMembers));
      await db.delete(oauthConsents).where(inArray(oauthConsents.userId, formerMembers));

      // The OAuth provider keeps an unexchanged authorization code as a
      // verification row whose JSON value names the user; left alone it could
      // still be traded for fresh tokens after this pass.
      const formerIds = new Set<UserId>(formerMembers);
      const pendingCodes = (
        await db
          .select({ id: verifications.id, value: verifications.value })
          .from(verifications)
          .where(like(verifications.value, '%"authorization_code"%'))
      )
        .filter((row) => {
          const owner = authorizationCodeOwner(row.value);
          return owner !== null && formerIds.has(owner);
        })
        .map((row) => row.id);
      if (pendingCodes.length > 0) {
        await db.delete(verifications).where(inArray(verifications.id, pendingCodes));
      }

      return ok({ formerMembers });
    } catch (e) {
      return err(internalError(e));
    }
  },
});
