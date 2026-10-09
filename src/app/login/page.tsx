import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { SigmaPulsoLogo } from "@/components/brand/sigma-shield";
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
            <SigmaPulsoLogo variant="full" className="mx-auto mb-3" />
            <CardTitle as="h1" className="sr-only">
              Sigma Pulso: entrar
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
