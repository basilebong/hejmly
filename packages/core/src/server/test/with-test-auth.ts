import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSignature } from "better-auth/crypto";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { parseAllowedEmails } from "../auth/allowlist.ts";
import { type Auth, createAuth } from "../auth/index.ts";
import { createMembershipService, type MembershipService } from "../auth/membership.ts";
import { createDb, type Db } from "../db/index.ts";

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../drizzle");

type WithTestAuthOptions = {
  allowedEmails?: string;
  baseURL?: string;
  path?: string;
};

type TestAuth = {
  auth: Auth;
  membership: MembershipService;
};

type TestAuthContext = TestAuth & {
  db: Db;
  signSessionCookie: (sessionToken: string) => Promise<string>;
  restart: (options: { allowedEmails: string }) => TestAuth;
};

export const withTestAuth = async <T>(
  options: WithTestAuthOptions,
  fn: (ctx: TestAuthContext) => Promise<T>,
): Promise<T> => {
  const db = createDb({ path: options.path ?? ":memory:" });
  migrate(db, { migrationsFolder });

  const secret = "test-secret-must-be-at-least-32-chars-long";
  const baseURL = options.baseURL ?? "http://localhost:5173";
  const boot = (rawAllowedEmails: string | undefined): TestAuth => {
    const allowedEmails = parseAllowedEmails(rawAllowedEmails);
    const auth = createAuth({
      db,
      baseURL,
      secret,
      google: { clientId: "test-google-id", clientSecret: "test-google-secret" },
      allowedEmails,
      useSecureCookies: false,
      mcpResource: `${baseURL}/mcp`,
    });
    return { auth, membership: createMembershipService({ auth, db, allowedEmails }) };
  };

  const signSessionCookie = async (sessionToken: string): Promise<string> =>
    `${sessionToken}.${await makeSignature(sessionToken, secret)}`;

  return fn({
    ...boot(options.allowedEmails),
    db,
    signSessionCookie,
    restart: ({ allowedEmails }) => boot(allowedEmails),
  });
};

// Better Auth 1.7 requires every `internalAdapter.createUser` call to declare how
// the user was provisioned. Hejmly only ever creates users through the Google
// social provider, so tests that seed a user directly must say the same thing.
export const googleProvisioningSource = {
  method: "oauth",
  oauth: { providerId: "google" },
} as const;
