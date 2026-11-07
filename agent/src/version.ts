// Version lookup that works from src (ts-node), dist, or an installed package.
import * as path from "path";

export function agentVersion(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pj = require(path.join(dir, "package.json")) as {
        name?: string;
        version?: string;
      };
      if (pj.name === "@phenzic/shiplogue-agent") {
        return pj.version ?? "0.0.0-dev";
      }
    } catch {
      /* keep walking up */
    }
    dir = path.dirname(dir);
  }
  return "0.0.0-dev";
}
