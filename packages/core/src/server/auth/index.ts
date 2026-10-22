import { oauthProvider } from "@better-auth/oauth-provider";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { parseUserId } from "../../shared/index.ts";
import type { Db } from "../db/index.ts";
import { isAllowedEmail } from "./allowlist.ts";
import { checkEmailAllowed } from "./check-email-allowed.ts";
import * as authSchema from "./schema.ts";
import { findUserEmail } from "./users.ts";

export type CreateAuthOptions = {
  db: Db;
  baseURL: string;
  secret: string;
  google: { clientId: string; clientSecret: string };
  allowedEmails: ReadonlySet<string>;
  useSecureCookies: boolean;
  mcpResource: string;
};

// Better Auth looks accounts up by (providerId, accountId) but declares no unique
// index for it, so two racing OAuth callbacks could insert the same account twice.
// Declaring it here, not in schema.ts, keeps it alive across `auth:generate`.
const accountUniqueness = {
  id: "hejmly-account-uniqueness",
  schema: {
    account: {
      fields: {},
      indexes: [
        {
          fields: ["providerId", "accountId"],
          unique: true,
          name: "accounts_provider_account_unique",
        },
      ],
    },
  },
} satisfies BetterAuthPlugin;

export const createAuth = (opts: CreateAuthOptions) => {
  const plugins: BetterAuthPlugin[] = [
    accountUniqueness,
    jwt(),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/consent",
      // The registered resource set IS the audience allowlist: a token request
      // naming an unregistered `resource` is rejected, and one that omits it is
      // bound to this single registered resource rather than to every audience
      // the server knows. This replaces 1.6's `validAudiences`, whose unbound
      // tokens carried the whole list (GHSA-p2fr-6hmx-4528).
      resources: [opts.mcpResource],
      // Defaults to true in 1.7, and stated here because the whole point of the
      // upgrade rests on it: without per-client enforcement a token is no longer
      // bound to the one resource it was issued for.
      enforcePerClientResources: true,
      // Hejmly serves exactly one protected resource, and any assistant that
      // completes DCR is here to reach it, so every registered client is linked
      // to it. Per-client enforcement stays on: a client still cannot request a
      // resource it was never linked to.
      clientRegistrationDefaultResources: [opts.mcpResource],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      requirePKCE: true,
      // MCP access tokens are stateless JWTs verified locally against our JWKS,
      // so Better Auth cannot revoke them server-side before they expire. This
      // short TTL bounds the gap between "Revoke" and the token losing access;
      // durable revocation lives in AssistantsService.revoke (deletes consent +
      // refresh token, so no new token can be minted).
      accessTokenExpiresIn: 60 * 15,
    }),
  ];

  return betterAuth({
    appName: "Hejmly",
    baseURL: opts.baseURL,
    secret: opts.secret,

    database: drizzleAdapter(opts.db, {
      provider: "sqlite",
      usePlural: true,
      schema: authSchema,
    }),

    socialProviders: {
      google: {
        clientId: opts.google.clientId,
        clientSecret: opts.google.clientSecret,
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
        // A cached session is served without reading the database, where boot
        // revocation deletes a former member's session. Keying the cache version
        // on membership sends their stale cache back to the database instead.
        version: (_session, user) =>
          isAllowedEmail(opts.allowedEmails, user.email) ? "1" : "former-member",
      },
    },

    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            checkEmailAllowed(opts.allowedEmails, user.email);
          },
        },
      },
      // The user hook above only fires on first sign-up. A user whose row
      // survives their removal from the allowlist would otherwise sign straight
      // back in, so membership is re-checked whenever a session is minted.
      session: {
        create: {
          before: async (session) => {
            const email = await findUserEmail(opts.db, parseUserId(session.userId));
            checkEmailAllowed(opts.allowedEmails, email);
          },
        },
      },
    },

    advanced: {
      cookiePrefix: "Hejmly",
      useSecureCookies: opts.useSecureCookies,
    },

    plugins,
  });
};

export type Auth = ReturnType<typeof createAuth>;
