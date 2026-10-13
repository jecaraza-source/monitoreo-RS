"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Downloads rows the reader already has on screen (no extra query, same permissions). */
export function DownloadCsv({ csv, fileName, label = "CSV" }: { csv: string; fileName: string; label?: string }) {
  function download() {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Button variant="outline" size="sm" onClick={download}>
      <Download aria-hidden /> {label}
    </Button>
  );
}
