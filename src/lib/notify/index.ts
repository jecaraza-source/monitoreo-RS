// lib/notify: sends an alert through every configured channel. In-app
// delivery is the alert_events row itself (Realtime pushes it to the bell);
// WhatsApp goes only to officials who accepted it (lib/whatsapp/alerts.ts).
import { emailNotifier } from "./email.ts";
import type { AlertMessage, DeliveryResult, Fetch, Notifier, NotifyEnv } from "./types.ts";

export type { AlertMessage, DeliveryResult } from "./types.ts";

export const NOTIFIERS: Notifier[] = [emailNotifier];

export type Recipients = { email: string[] };

export async function notify(
  message: AlertMessage,
  recipients: Recipients,
  deps: { env?: NotifyEnv; fetch?: Fetch; notifiers?: Notifier[] } = {},
): Promise<Record<string, DeliveryResult>> {
  const env = deps.env ?? process.env;
  const doFetch = deps.fetch ?? fetch;
  const notifiers = deps.notifiers ?? NOTIFIERS;
  const results = await Promise.all(
    notifiers.map(async (n) => [n.channel, await n.send(message, recipients[n.channel] ?? [], { env, fetch: doFetch })] as const),
  );
  return { in_app: { status: "sent" }, ...Object.fromEntries(results) };
}
