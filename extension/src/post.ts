import { cfg } from "./config";
import { toSlackMrkdwn } from "./format";

export type TargetType = "slack" | "discord" | "teams";

export interface PostTarget {
  type: TargetType;
  url: string;
  enabled: boolean;
}

export interface TargetResult {
  type: TargetType;
  ok: boolean;
  status?: number;
  // Safe message: never contains the webhook URL (it embeds a secret).
  error?: string;
}

export interface PostResult {
  results: TargetResult[];
  // Number of targets that received at least one message.
  posted: number;
  // True when any Discord target had to truncate (full text goes to clipboard).
  truncated: boolean;
}

const DISCORD_LIMIT = 1990; // Discord caps content at 2000 chars; leave margin.
const DISCORD_MAX_MESSAGES = 3;

// Split text into ≤1990-char messages on newline boundaries; a single line
// longer than the limit is hard-sliced, at a word boundary where possible.
export function splitForDiscord(text: string, limit = DISCORD_LIMIT): string[] {
  const messages: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (line.length > limit) {
      if (current) {
        messages.push(current);
        current = "";
      }
      let rest = line;
      while (rest.length > limit) {
        let cut = rest.lastIndexOf(" ", limit);
        if (cut < limit / 2) {
          cut = limit; // no reasonable word boundary — hard slice
        }
        messages.push(rest.slice(0, cut));
        rest = rest.slice(cut).trimStart();
      }
      current = rest;
      continue;
    }
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= limit) {
      current = candidate;
    } else {
      messages.push(current);
      current = line;
    }
  }
  if (current) {
    messages.push(current);
  }
  return messages;
}

// The configured targets: the new `standupDraft.posting.targets` list wins; the
// legacy `standupDraft.webhook.type/url` pair is the fallback when it's empty.
export function effectiveTargets(c = cfg()): PostTarget[] {
  const raw = c.postingTargets;
  const list = (Array.isArray(raw) ? raw : []).filter(
    (t): t is PostTarget =>
      !!t &&
      typeof t === "object" &&
      (t.type === "slack" || t.type === "discord" || t.type === "teams") &&
      typeof t.url === "string" &&
      t.url.length > 0,
  );
  const enabled = list.filter((t) => t.enabled !== false);
  if (enabled.length > 0) {
    return enabled;
  }
  if (c.webhookType !== "none" && c.webhookUrl) {
    return [{ type: c.webhookType, url: c.webhookUrl, enabled: true }];
  }
  return [];
}

// Teams Workflows webhooks take a message with an Adaptive Card attachment
// (the old Office 365 connector MessageCard format is retired).
function teamsCard(text: string): unknown {
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [{ type: "TextBlock", text, wrap: true }],
        },
      },
    ],
  };
}

async function postJson(url: string, payload: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
}

// Posts to every enabled target, isolating failures: one bad target never
// stops the others. `text` is what the user sees (active tab); `markdown` is
// the Markdown tab, used for Slack targets regardless of the active tab.
export async function postToWebhook(
  text: string,
  markdown?: string,
  onlyTypes?: TargetType[],
): Promise<PostResult> {
  const targets = effectiveTargets().filter((t) => !onlyTypes || onlyTypes.includes(t.type));
  if (targets.length === 0) {
    throw new Error(
      "No posting target configured. Set standupDraft.posting.targets (or the legacy standupDraft.webhook.type/url) in settings.",
    );
  }

  const results: TargetResult[] = [];
  let truncated = false;
  for (const target of targets) {
    try {
      if (target.type === "slack") {
        // Slack wants mrkdwn — always converted from the Markdown tab when we
        // have it, regardless of which tab is active.
        await postJson(target.url, { text: toSlackMrkdwn(markdown ?? text) });
        results.push({ type: target.type, ok: true, status: 200 });
      } else if (target.type === "teams") {
        await postJson(target.url, teamsCard(text));
        results.push({ type: target.type, ok: true, status: 200 });
      } else {
        // Discord: split overflow into ordered messages (max 3 + marker).
        const parts = splitForDiscord(text);
        const over = parts.length > DISCORD_MAX_MESSAGES;
        const toSend = over ? parts.slice(0, DISCORD_MAX_MESSAGES) : parts;
        if (over) {
          truncated = true;
          const marker = "\n…(truncated — full text copied to clipboard)";
          const last = toSend[toSend.length - 1];
          toSend[toSend.length - 1] = last.slice(0, DISCORD_LIMIT - marker.length) + marker;
        }
        for (const p of toSend) {
          await postJson(target.url, { content: p });
        }
        results.push({ type: target.type, ok: true, status: 200 });
      }
    } catch (e: any) {
      // Never include the URL or response body — both can carry secrets.
      results.push({ type: target.type, ok: false, error: e?.message ?? String(e) });
    }
  }
  return { results, posted: results.filter((r) => r.ok).length, truncated };
}
