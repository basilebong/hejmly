import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

import { forgetThisDevice } from "@/lib/push-device";
import { QUERY_CACHE_PERSIST_KEY, queryClient } from "@/lib/query-client";

const baseURL =
  import.meta.env.VITE_AUTH_URL ??
  (typeof window === "undefined" ? "http://localhost:5173" : window.location.origin);

const authClient = createAuthClient({ baseURL, plugins: [oauthProviderClient()] });

export const signInWithGoogle = (callbackURL = "/"): Promise<unknown> =>
  authClient.signIn.social({
    provider: "google",
    callbackURL,
    errorCallbackURL: "/sign-in/rejected",
  });

export const signOut = async (): Promise<unknown> => {
  await forgetThisDevice();
  const result = await authClient.signOut();
  queryClient.clear();
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(QUERY_CACHE_PERSIST_KEY);
  }
  return result;
};

export const useSession = authClient.useSession;

export const submitOAuthConsent = async (accept: boolean): Promise<string> => {
  const { data, error } = await authClient.oauth2.consent({ accept });
  if (error !== null) throw new Error(error.message ?? "Consent request failed");
  if (data === null || typeof data.url !== "string") {
    throw new Error("Consent response did not include a redirect");
  }
  return data.url;
};
