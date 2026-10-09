import type { Metadata } from "next";
import { Suspense } from "react";
import { Radar } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Reveal } from "@/components/ui-kit";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Reveal className="w-full max-w-sm">
        <Card>
          <CardHeader className="items-center text-center">
            <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Radar className="size-6" aria-hidden />
            </div>
            <CardTitle as="h1" className="text-xl">
              Monitoreo Municipal
            </CardTitle>
            <CardDescription>Entra con tu correo; te enviaremos un enlace de acceso.</CardDescription>
          </CardHeader>
          <CardContent>
            {/* useSearchParams reads the request, so it streams behind a boundary. */}
            <Suspense fallback={<Skeleton className="h-40 w-full" />}>
              <LoginForm />
            </Suspense>
          </CardContent>
        </Card>
      </Reveal>
    </main>
  );
}
