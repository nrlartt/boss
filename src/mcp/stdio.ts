import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBossMcpServer } from "./tools.ts";

const server = createBossMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
