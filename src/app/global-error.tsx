"use client";

import { useReportError } from "@/components/layout/report-error";

// Replaces the root layout when it fails, so it brings its own <html>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useReportError(error);
  return (
    <html lang="es-MX">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div role="alert" style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 20 }}>Algo salió mal</h1>
          <p style={{ color: "#64748b" }}>El error quedó registrado.{error.digest ? ` Referencia: ${error.digest}.` : ""}</p>
          <button onClick={reset} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #cbd5e1", cursor: "pointer" }}>
            Intentar de nuevo
          </button>
        </div>
      </body>
    </html>
  );
}
