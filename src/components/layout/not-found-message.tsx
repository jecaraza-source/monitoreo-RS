import Link from "next/link";
import { SearchX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/** Not found (or not visible to this role): the same message either way, so it reveals nothing. */
export function NotFoundMessage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <SearchX className="size-8 text-muted-foreground" aria-hidden />
      <h1 className="text-lg font-semibold">No encontramos esta página</h1>
      <p className="text-sm text-muted-foreground">
        No existe o no tienes acceso a ella. Si llegaste desde un enlace, pide a quien te lo envió que lo revise.
      </p>
      <Link href="/" className={buttonVariants()}>
        Ir al inicio
      </Link>
    </div>
  );
}
