// Human review queue: why an item is there and in what order. Pure module.

export const REVIEW_REASONS = ["emergency", "high_risk", "risk_term", "low_confidence", "doubtful"] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

export const REASON_LABELS: Record<ReviewReason, { label: string; hint: string }> = {
  emergency: { label: "Posible emergencia", hint: "El modelo la marcó con gravedad de emergencia." },
  high_risk: { label: "Riesgo alto", hint: "Gravedad alta, o prioridad alta sin gravedad evaluada." },
  risk_term: { label: "Término de riesgo", hint: "El texto contiene un término de riesgo alto del catálogo." },
  low_confidence: { label: "Baja confianza", hint: "La confianza del modelo está debajo del umbral configurado." },
  doubtful: {
    label: "Señales contradictorias",
    hint: "Por ejemplo, sentimiento positivo con intención de queja, o gravedad alta sin necesidad de atención.",
  },
};

const WEIGHT: Record<string, number> = { emergency: 5, high_risk: 4, risk_term: 3, doubtful: 2, low_confidence: 1 };

/** Most serious reason first, then oldest first. */
export function reviewOrder(a: { reasons: string[]; created_at: string }, b: { reasons: string[]; created_at: string }): number {
  const top = (r: string[]) => Math.max(0, ...r.map((x) => WEIGHT[x] ?? 0));
  return top(b.reasons) - top(a.reasons) || a.created_at.localeCompare(b.created_at);
}

export const DECISION_LABELS: Record<string, string> = {
  confirmed: "Confirmada",
  corrected: "Corregida",
  dismissed: "Descartada",
};
