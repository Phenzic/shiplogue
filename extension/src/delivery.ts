import type { CloudClient } from "./cloud";
import { isPaidPlan } from "./formatProfile";

// Delivery = posting a stand-up to Slack/Discord/Teams. Posting is a Pro
// feature executed by Shiplogue **Cloud** (manual Send or scheduled posting
// from the dashboard); the extension never talks to a webhook directly.
//
// This module caches whether the connected workspace can send, so the panel can
// show/hide the Send button synchronously. It refreshes on activation and after
// connect/disconnect.
export interface DeliveryState {
  available: boolean;
  // Button label, e.g. "Send via Shiplogue Cloud".
  label: string;
}

let state: DeliveryState = { available: false, label: "" };

export function getDeliveryState(): DeliveryState {
  return state;
}

export function hasDeliveryTarget(): boolean {
  return state.available;
}

// Explicit setter (used by tests and by callers that already know the plan).
export function setDeliveryState(next: DeliveryState): void {
  state = next;
}

export async function refreshDelivery(client: CloudClient | undefined): Promise<DeliveryState> {
  state = { available: false, label: "" };
  if (!client) return state;
  try {
    if (!(await client.hasKey())) return state;
    const me = await client.me();
    if (!isPaidPlan(me.workspace.plan)) return state;
    state = { available: true, label: "Send via Shiplogue Cloud" };
  } catch {
    /* offline or invalid key: keep Send hidden, never block the panel */
  }
  return state;
}
