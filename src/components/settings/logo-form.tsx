"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmLogoUpload, prepareLogoUpload, removeLogo } from "@/lib/branding/actions";
import { BRANDING_BUCKET, LOGO_MAX_BYTES, LOGO_MAX_LABEL } from "@/lib/branding/image";
import { createClient } from "@/lib/supabase/client";

/** Straight to Storage with a single-use signed URL, then the server checks what arrived. */
async function upload(file: File): Promise<{ ok: boolean; message: string }> {
  const ticket = await prepareLogoUpload({ size: file.size, type: file.type });
  if (!ticket.ok || !ticket.path || !ticket.token) return ticket;
  const { error } = await createClient().storage.from(BRANDING_BUCKET).uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
  if (error) return { ok: false, message: "No se pudo subir la imagen." };
  return confirmLogoUpload(ticket.path);
}

/** Upload or remove the client's logo; the server checks the real format and size again. */
export function LogoForm({ logoUrl }: { logoUrl: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const shown = preview ?? logoUrl;

  function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > LOGO_MAX_BYTES) return void toast.error(`La imagen pesa más de ${LOGO_MAX_LABEL}.`);
    if (!["image/png", "image/jpeg"].includes(file.type)) return void toast.error("Usa una imagen PNG o JPG.");
    const local = URL.createObjectURL(file);
    setPreview(local);
    startTransition(async () => {
      const result = await upload(file);
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
          Aparece en la portada y al pie de cada página de los reportes en PDF. PNG o JPG de hasta {LOGO_MAX_LABEL}; mejor horizontal y con fondo
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
