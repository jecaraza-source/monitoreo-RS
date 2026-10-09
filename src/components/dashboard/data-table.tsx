/**
 * Collapsible table twin of a chart: every value reachable without hovering,
 * and readable by screen readers.
 */
export function DataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  if (rows.length === 0) return null;
  return (
    <details className="group mt-3 text-sm">
      <summary className="cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">Ver datos</summary>
      <div className="mt-2 max-h-64 overflow-auto rounded-lg border">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-muted">
            <tr>
              {columns.map((c, i) => (
                <th key={c} scope="col" className={i > 0 ? "px-3 py-1.5 text-right font-medium" : "px-3 py-1.5 font-medium"}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-t">
                {row.map((cell, i) => (
                  <td key={i} className={i > 0 ? "px-3 py-1.5 text-right tabular-nums" : "px-3 py-1.5"}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
