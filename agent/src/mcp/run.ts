// `shiplogue mcp` entry point. stdout belongs to MCP; diagnostics go to stderr
// only and never include prompt text or secrets.
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server";

export function runMcp(): void {
  serveStdio(() => createServer(), {
    onerror: (error) => {
      process.stderr.write(`[shiplogue mcp] ${error.message}\n`);
    },
  });
}

if (require.main === module) {
  runMcp();
}
