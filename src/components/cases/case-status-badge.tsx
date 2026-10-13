import { StatusBadge } from "@/components/health/status-badge";
import { CASE_STATUS_LABELS, CASE_STATUS_TONE, type CaseStatus } from "@/lib/cases/model";

export function CaseStatusBadge({ status, className }: { status: CaseStatus; className?: string }) {
  return (
    <StatusBadge tone={CASE_STATUS_TONE[status]} className={className}>
      {CASE_STATUS_LABELS[status]}
    </StatusBadge>
  );
}
