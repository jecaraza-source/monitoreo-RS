"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { removeLogo, uploadLogo } from "@/lib/branding/actions";
import { LOGO_MAX_BYTES } from "@/lib/branding/image";

/** Upload or remove the client's logo; the server checks the real format and size again. */
export function LogoForm({ logoUrl }: { logoUrl: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const shown = preview ?? logoUrl;

  function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > LOGO_MAX_BYTES) return void toast.error("La imagen pesa más de 1 MB.");
    if (!["image/png", "image/jpeg"].includes(file.type)) return void toast.error("Usa una imagen PNG o JPG.");
    const local = URL.createObjectURL(file);
    setPreview(local);
    const data = new FormData();
    data.set("logo", file);
    startTransition(async () => {
      const result = await uploadLogo(data);
      URL.revokeObjectURL(local);
      setPreview(null);
      if (input.current) input.current.value = "";
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await removeLogo();
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2 text-base">
          <ImageUp className="size-4 text-primary" aria-hidden /> Logotipo del cliente
        </CardTitle>
        <CardDescription>
          Aparece en la portada y al pie de cada página de los reportes en PDF. PNG o JPG de hasta 1 MB; mejor horizontal y con fondo
          transparente o blanco.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex h-28 items-center justify-center rounded-lg border border-dashed bg-white p-3" aria-busy={pending}>
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview or short-lived signed Storage URL
            <img src={shown} alt="Logotipo del cliente" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-sm text-slate-500">Sin logotipo: los reportes usan sólo los colores.</span>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          id="logo-file"
          aria-label="Elegir logotipo"
          onChange={(e) => pick(e.target.files?.[0])}
          disabled={pending}
        />
        <div className="flex flex-wrap justify-end gap-2">
          {logoUrl && (
            <Button size="sm" variant="ghost" onClick={remove} disabled={pending}>
              <Trash2 aria-hidden /> Quitar
            </Button>
          )}
          <Button size="sm" onClick={() => input.current?.click()} disabled={pending}>
            <ImageUp aria-hidden /> {pending ? "Subiendo…" : logoUrl ? "Cambiar logotipo" : "Subir logotipo"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
