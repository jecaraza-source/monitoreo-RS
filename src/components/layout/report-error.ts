"use client";

import { useEffect } from "react";

/** Sends an error caught by a boundary to /api/errors once. */
export function useReportError(error: Error & { digest?: string }) {
  useEffect(() => {
    void fetch("/api/errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: error.message || "Error en el navegador", digest: error.digest, path: window.location.pathname }),
      keepalive: true,
    }).catch(() => {});
  }, [error]);
}
