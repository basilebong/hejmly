import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { isAPIError } from "better-auth/api";
import { parseUserId, type UserId } from "../../shared/index.ts";

export type McpAuthConfig = {
  issuer: string;
  audience: string;
  jwksUrl: string;
};

// `jwksOrigin` is where the server itself reaches its JWKS to verify tokens. It
// must be the server's own loopback (e.g. http://localhost:3000) whenever
// `baseURL` is fronted by a dev proxy (Vite) or reverse proxy (Caddy) —
// verifying a token must not depend on a round-trip back through that proxy.
// It is required (no default) so the loopback decision is always explicit at
// the call site. issuer/audience stay public to match the JWT's claims.
export const deriveMcpAuthConfig = (baseURL: string, jwksOrigin: string): McpAuthConfig => ({
  issuer: `${baseURL}/api/auth`,
  audience: `${baseURL}/mcp`,
  jwksUrl: `${jwksOrigin}/api/auth/jwks`,
});

export type AuthedMcpHandler = (req: Request, actor: UserId) => Promise<Response>;

// Derived from the verifier rather than imported from jose, which is a transitive
// dependency of the auth stack and not one of ours to import directly.
type ResourceActions = ReturnType<ReturnType<typeof oauthProviderResourceClient>["getActions"]>;
type VerifiedToken = Awaited<ReturnType<ResourceActions["verifyAccessTokenRequest"]>>;

const invalidToken = (): Response =>
  new Response(JSON.stringify({ error: "invalid_token" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });

export const createMcpAuthGuard = (config: McpAuthConfig) => {
  const { verifyAccessTokenRequest } = oauthProviderResourceClient().getActions();

  return (handler: AuthedMcpHandler): ((req: Request) => Promise<Response>) =>
    async (req) => {
      let jwt: VerifiedToken;
      // Only the verification is guarded. Running the handler inside this try would
      // let an APIError thrown by a tool be reported to the client as a bad token.
      try {
        jwt = await verifyAccessTokenRequest(req, {
          verifyOptions: { issuer: config.issuer, audience: config.audience },
          jwksUrl: config.jwksUrl,
        });
      } catch (error) {
        // verifyAccessTokenRequest rejects with an APIError already carrying the
        // RFC 6750 / RFC 9728 `WWW-Authenticate` challenge that points MCP clients
        // at our protected-resource metadata. Anything else is ours to surface.
        if (!isAPIError(error)) throw error;
        return new Response(error.message, {
          status: error.statusCode,
          headers: error.headers,
        });
      }

      if (typeof jwt.sub !== "string") return invalidToken();
      return await handler(req, parseUserId(jwt.sub));
    };
};
