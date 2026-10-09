// Notification channels behind one interface, so adding one (SMS, Teams…)
// does not touch the alert evaluator. Framework-free for unit tests.

export type AlertMessage = {
  title: string;
  summary: string;
  severity: "low" | "medium" | "high" | "critical";
  ruleName: string;
  orgName: string;
  /** Absolute link to the alert in the app. */
  url: string;
};

export type DeliveryStatus = "sent" | "not_configured" | "failed" | "skipped";
export type DeliveryResult = { status: DeliveryStatus; detail?: string };

export type NotifyEnv = Record<string, string | undefined>;
export type Fetch = typeof fetch;

export interface Notifier {
  channel: "email" | "whatsapp";
  send(message: AlertMessage, recipients: string[], deps: { env: NotifyEnv; fetch: Fetch }): Promise<DeliveryResult>;
}
