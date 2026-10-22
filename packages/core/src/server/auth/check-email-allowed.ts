import { APIError } from "better-auth/api";
import { isAllowedEmail } from "./allowlist.ts";

export const checkEmailAllowed = (allowed: ReadonlySet<string>, email: unknown): void => {
  if (isAllowedEmail(allowed, email)) return;
  const shown = typeof email === "string" && email.length > 0 ? email : "<empty>";
  throw new APIError("FORBIDDEN", {
    code: "EMAIL_NOT_ALLOWED",
    message: `Email "${shown}" is not on the Hejmly allowlist. Ask the admin to add it.`,
  });
};
