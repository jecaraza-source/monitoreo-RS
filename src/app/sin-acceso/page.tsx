import type { Metadata } from "next";
import { ShieldOff } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui-kit";

export const metadata: Metadata = { title: "Sin acceso" };

// Signed in but without a membership (e.g. removed from the org).
export default function NoAccessPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <EmptyState
        className="max-w-md"
        icon={<ShieldOff />}
        title="Tu cuenta no tiene acceso"
        description="Tu correo no está asignado a ningún municipio. Pide a un administrador que te invite."
        action={
          <form action={signOut}>
            <Button type="submit" variant="outline">
              Cerrar sesión
            </Button>
          </form>
        }
      />
    </main>
  );
}
