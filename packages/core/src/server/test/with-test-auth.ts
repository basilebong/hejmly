import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSignature } from "better-auth/crypto";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { parseAllowedEmails } from "../auth/allowlist.ts";
import { type Auth, createAuth } from "../auth/index.ts";
import { createDb, type Db } from "../db/index.ts";

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../drizzle");

type WithTestAuthOptions = {
  allowedEmails?: string;
  baseURL?: string;
};

type TestAuthContext = {
  auth: Auth;
  db: Db;
  signSessionCookie: (sessionToken: string) => Promise<string>;
};

export const withTestAuth = async <T>(
  options: WithTestAuthOptions,
  fn: (ctx: TestAuthContext) => Promise<T>,
): Promise<T> => {
  const db = createDb({ path: ":memory:" });
  migrate(db, { migrationsFolder });

  const secret = "test-secret-must-be-at-least-32-chars-long";
  const baseURL = options.baseURL ?? "http://localhost:5173";
  const auth = createAuth({
    db,
    baseURL,
    secret,
    google: { clientId: "test-google-id", clientSecret: "test-google-secret" },
    allowedEmails: parseAllowedEmails(options.allowedEmails),
    useSecureCookies: false,
    mcpResource: `${baseURL}/mcp`,
  });

  const signSessionCookie = async (sessionToken: string): Promise<string> =>
    `${sessionToken}.${await makeSignature(sessionToken, secret)}`;

  return fn({ auth, db, signSessionCookie });
};
