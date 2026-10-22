import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

export type Registrar = (server: McpServer) => void;

const SERVER_INFO = { name: "Hejmly", version: "2.3.0" } as const;

export const runMcpRequest = async (register: Registrar, req: Request): Promise<Response> => {
  const server = new McpServer(SERVER_INFO);
  register(server);
  const transport = new WebStandardStreamableHTTPServerTransport();
  await server.connect(transport);
  return transport.handleRequest(req);
};
