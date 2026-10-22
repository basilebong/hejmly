import * as v from "valibot";

const portSchema = v.pipe(
  v.string(),
  v.transform(Number),
  v.number(),
  v.integer(),
  v.minValue(1),
  v.maxValue(65535),
);

const flagSchema = v.pipe(
  v.string(),
  v.transform((s) => s !== "" && s !== "false" && s !== "0"),
);

const urlSchema = v.pipe(v.string(), v.url());
const nonEmptySchema = v.pipe(v.string(), v.minLength(1));
const secretSchema = v.pipe(v.string(), v.minLength(32));
const emailListSchema = v.pipe(
  v.string(),
  v.check(
    (raw) => raw.split(",").some((entry) => entry.trim().length > 0),
    "must list at least one email",
  ),
);

const isTimeZone = (raw: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return true;
  } catch {
    return false;
  }
};
const timeZoneSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.check(isTimeZone, "Use an IANA time zone like Europe/Berlin"),
);

const envSchema = v.object({
  PORT: v.optional(portSchema, "3000"),
  CI: v.optional(flagSchema, ""),
  E2E_BASE_URL: v.optional(urlSchema, "http://localhost:5173"),
  BETTER_AUTH_SECRET: v.optional(secretSchema),
  BETTER_AUTH_URL: v.optional(urlSchema),
  GOOGLE_ID: v.optional(nonEmptySchema),
  GOOGLE_SECRET: v.optional(nonEmptySchema),
  MCP_HOST: v.optional(nonEmptySchema),
  DATABASE_PATH: v.optional(nonEmptySchema),
  HEJMLY_ALLOWED_EMAILS: v.optional(nonEmptySchema),
});

export type Env = v.InferOutput<typeof envSchema>;

export const parseEnv = (raw: Record<string, string | undefined>): Env => v.parse(envSchema, raw);

const runtimeEnvSchema = v.object({
  PORT: v.optional(portSchema, "3000"),
  E2E_BASE_URL: v.optional(urlSchema, "http://localhost:5173"),
  BETTER_AUTH_URL: urlSchema,
  BETTER_AUTH_SECRET: secretSchema,
  GOOGLE_ID: nonEmptySchema,
  GOOGLE_SECRET: nonEmptySchema,
  DATABASE_PATH: nonEmptySchema,
  HEJMLY_ALLOWED_EMAILS: emailListSchema,
  HEJMLY_TIMEZONE: v.optional(timeZoneSchema, "UTC"),
  MCP_HOST: v.optional(nonEmptySchema),
});

export type RuntimeEnv = v.InferOutput<typeof runtimeEnvSchema>;

export const parseRuntimeEnv = (raw: Record<string, string | undefined>): RuntimeEnv =>
  v.parse(runtimeEnvSchema, raw);
