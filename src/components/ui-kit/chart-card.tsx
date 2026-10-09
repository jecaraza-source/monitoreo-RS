import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";

export type ChartCardProps = {
  title: string;
  description?: string;
  /** Top-right slot: period selector, export button… */
  action?: React.ReactNode;
  /** Shows a skeleton of the same height instead of the chart. */
  loading?: boolean;
  /** Chart area height in px; keeps layout stable between skeleton and chart. */
  height?: number;
  index?: number;
  className?: string;
  children?: React.ReactNode;
  /** Below the chart area (e.g. a collapsible data table). */
  footer?: React.ReactNode;
};

export function ChartCard({
  title,
  description,
  action,
  loading = false,
  height = 260,
  index = 0,
  className,
  children,
  footer,
}: ChartCardProps) {
  return (
    <Reveal delay={index * 0.06} className={cn("h-full", className)}>
      <Card className="h-full">
        <CardHeader>
          <CardTitle as="h3">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
          {action && <CardAction>{action}</CardAction>}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div role="status" aria-label="Cargando gráfica" className="flex flex-col justify-end gap-2" style={{ height }}>
              <Skeleton className="h-full w-full" />
              <div className="flex justify-between gap-2">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-3 w-8" />
                ))}
              </div>
            </div>
          ) : (
            <div style={{ height }}>{children}</div>
          )}
          {footer}
        </CardContent>
      </Card>
    </Reveal>
  );
}
