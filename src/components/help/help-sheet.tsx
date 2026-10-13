"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export type HelpSection = { topic: string; label: string; lines: string[] };

/** Contextual help of a page: the topics of the member's role guides. */
export function HelpSheet({ title, sections }: { title: string; sections: HelpSection[] }) {
  const [open, setOpen] = useState(false);
  if (!sections.length) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <CircleHelp aria-hidden /> Ayuda
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>Según tu rol. La guía completa está en Ayuda.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-6 text-sm">
            {sections.map((s) => (
              <section key={s.topic} aria-labelledby={`help-${s.topic}`} className="flex flex-col gap-1.5">
                <h3 id={`help-${s.topic}`} className="font-medium">
                  {s.label}
                </h3>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  {s.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>
            ))}
            <Link href="/ayuda" className="text-primary underline">
              Ver la guía completa de mi rol
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
