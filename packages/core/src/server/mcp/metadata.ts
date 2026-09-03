const PUBLIC_HEADERS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
} as const;

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: PUBLIC_HEADERS });

export type AuthRequestHandler = (req: Request) => Promise<Response>;

export type DiscoveryDocument = "oauth-authorization-server" | "openid-configuration";

// The OAuth Provider plugin already publishes RFC 8414 / OIDC discovery, but under
// the auth basePath — MCP clients look for it at the origin root. Re-serving the
// plugin's own response is what keeps the two in step: the previous hand-written
// copy of this document silently fell behind when the plugin gained DPoP,
// private_key_jwt and OIDC claims support, leaving clients to negotiate against
// capabilities the server no longer described.
export const createAuthServerMetadataHandler =
  (baseURL: string, handler: AuthRequestHandler) =>
  async (document: DiscoveryDocument): Promise<Response> => {
    const upstream = await handler(
      new Request(`${baseURL}/api/auth/.well-known/${document}`, {
        headers: { accept: "application/json" },
      }),
    );
    return new Response(upstream.body, { status: upstream.status, headers: PUBLIC_HEADERS });
  };

// RFC 9728 protected-resource metadata describes the resource server, not the
// authorization server, so the plugin does not publish it — this document is ours.
export const createProtectedResourceMetadataHandler =
  (resource: string, authorizationServer: string): (() => Response) =>
  () =>
    json({ resource, authorization_servers: [authorizationServer] });
