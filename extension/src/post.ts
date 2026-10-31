import { cfg } from "./config";

export interface PostResult {
  posted: number;
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

// Posts text to a Discord or Slack incoming webhook. No bot or OAuth required.
// Discord overflow becomes multiple ordered messages (max 3); when truncation
// happens the caller is told via the result so it can copy the full text to
// the clipboard (posting itself stays side-effect free beyond the webhook).
export async function postToWebhook(text: string): Promise<PostResult> {
  const c = cfg();
  if (c.webhookType === "none" || !c.webhookUrl) {
    throw new Error("No webhook configured. Set shiplogue.webhook.type and shiplogue.webhook.url in settings.");
  }

  const post = async (payload: unknown) => {
    const res = await fetch(c.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Webhook POST failed: ${res.status} ${res.statusText}`);
    }
  };

  if (c.webhookType === "slack") {
    await post({ text });
    return { posted: 1, truncated: false };
  }

  const parts = splitForDiscord(text);
  const truncated = parts.length > DISCORD_MAX_MESSAGES;
  const toSend = truncated ? parts.slice(0, DISCORD_MAX_MESSAGES) : parts;
  if (truncated) {
    const marker = "\n…(truncated — full text copied to clipboard)";
    const last = toSend[toSend.length - 1];
    toSend[toSend.length - 1] = last.slice(0, DISCORD_LIMIT - marker.length) + marker;
  }
  for (const p of toSend) {
    await post({ content: p });
  }
  return { posted: toSend.length, truncated };
}
