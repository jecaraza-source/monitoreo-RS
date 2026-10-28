"use client";

import { useState, useTransition } from "react";
import { KeyRound, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UNOFFICIAL_NETWORKS, type UnofficialNetwork } from "@/lib/connectors/networks";
import type { SourceType } from "@/lib/connectors/types";
import { clearSourceSecret, saveSource } from "@/lib/sources/actions";
import type { ConnectorInfo, SourceView } from "@/lib/sources/data";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

export function SourceForm({
  connectors,
  editing,
  canConnectUnofficial,
  onDone,
}: {
  connectors: ConnectorInfo[];
  /** Only admins connect or reconfigure unofficial sources. */
  canConnectUnofficial: boolean;
  /** Source being edited; null to connect a new one. */
  editing: SourceView | null;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<SourceType>(editing?.type ?? "rss");
  const info = connectors.find((c) => c.type === type)!;
  const cfg = editing?.config ?? {};
  const [name, setName] = useState(editing?.name ?? "");
  const [url, setUrl] = useState(str(cfg.url));
  const [outletName, setOutletName] = useState(str(cfg.outletName));
  const [pageId, setPageId] = useState(str(cfg.pageId));
  const [query, setQuery] = useState(str(cfg.query));
  const [channelId, setChannelId] = useState(str(cfg.channelId));
  const [account, setAccount] = useState(str(cfg.account));
  const [subreddit, setSubreddit] = useState(str(cfg.subreddit));
  const [task, setTask] = useState(str(cfg.task));
  const [network, setNetwork] = useState<UnofficialNetwork | "">((str(cfg.network) as UnofficialNetwork) || "");
  const [includeComments, setIncludeComments] = useState(bool(cfg.includeComments, true));
  const [requireMatch, setRequireMatch] = useState(bool(cfg.requireMatch, info.defaultRequireMatch));
  const [secret, setSecret] = useState("");

  function changeType(next: SourceType) {
    setType(next);
    setRequireMatch(connectors.find((c) => c.type === next)!.defaultRequireMatch);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const config =
      type === "rss"
        ? { url, outletName: outletName || undefined, requireMatch }
        : type === "rss_bridge"
          ? { url, network: network || undefined, requireMatch }
          : type === "apify"
            ? { task, network: network || undefined, requireMatch }
        : type === "meta"
          ? { pageId, includeComments, requireMatch }
          : type === "bluesky"
            ? { query: query || undefined, account: account || undefined, requireMatch }
            : type === "reddit"
              ? { query: query || undefined, subreddit: subreddit || undefined, requireMatch }
              : { query: query || undefined, channelId: channelId || undefined, includeComments, requireMatch };
    startTransition(async () => {
      const result = await saveSource({ id: editing?.id ?? null, name, type, config, secret: secret || undefined });
      if (!result.ok) return void toast.error(result.message);
      toast.success(result.message);
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
        <div className="flex flex-col gap-2">
          <Label id="source-type-label">Tipo</Label>
          <Select value={type} onValueChange={(v) => changeType(v as SourceType)} disabled={Boolean(editing)}>
            <SelectTrigger aria-labelledby="source-type-label" className="w-full">
              <SelectValue>{(v: SourceType) => connectors.find((c) => c.type === v)?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {connectors.map((c) => (
                <SelectItem key={c.type} value={c.type} disabled={!c.enabled || (!c.official && !canConnectUnofficial)}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="source-name">Nombre</Label>
          <Input id="source-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Diario del Valle" required />
        </div>
      </div>

      {!info.official && (
        <div role="note" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
          <p>
            <strong>Fuente no oficial.</strong> Lee contenido público mediante un servicio de terceros, fuera de la API
            oficial de la red: puede ir contra sus términos de uso y dejar de funcionar sin aviso. Lo que capture se
            marca como «no oficial» en la bandeja y en los reportes, y los autores no se guardan. Sólo administración
            puede conectarla o cambiarla.
          </p>
        </div>
      )}

      {(type === "rss_bridge" || type === "apify") && (
        <div className="grid gap-4 md:grid-cols-[1fr_14rem]">
          {type === "rss_bridge" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="source-url">URL del feed en tu RSSHub o RSS-Bridge</Label>
              <Input
                id="source-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://rsshub.tu-dominio.mx/telegram/channel/canal"
                required
              />
              <p className="text-xs text-muted-foreground">
                Usa una instancia propia; las públicas bloquean muchas rutas y limitan las consultas.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="source-task">Tarea de Apify</Label>
              <Input id="source-task" value={task} onChange={(e) => setTask(e.target.value)} placeholder="usuario~instagram-medios" required />
              <p className="text-xs text-muted-foreground">
                Programa la tarea en Apify; aquí se lee el resultado de su última corrida exitosa.
              </p>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label id="source-network-label">Red</Label>
            <Select value={network} onValueChange={(v) => setNetwork(v as UnofficialNetwork)}>
              <SelectTrigger aria-labelledby="source-network-label" className="w-full">
                <SelectValue placeholder="Elige la red">{(v: UnofficialNetwork) => UNOFFICIAL_NETWORKS[v]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(UNOFFICIAL_NETWORKS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {type === "rss" && (
        <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
          <div className="flex flex-col gap-2">
            <Label htmlFor="source-url">URL del feed RSS o Atom</Label>
            <Input id="source-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://medio.mx/rss" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="source-outlet">Nombre del medio (opcional)</Label>
            <Input id="source-outlet" value={outletName} onChange={(e) => setOutletName(e.target.value)} placeholder="Del feed" />
          </div>
        </div>
      )}

      {type === "meta" && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="source-page">ID o usuario de la página</Label>
            <Input id="source-page" value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="AyuntamientoSanAndres" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="source-secret" className="flex items-center gap-1.5">
              <KeyRound className="size-3.5" aria-hidden /> Token de página
            </Label>
            <Input
              id="source-secret"
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={editing?.hasSecret ? "Guardado · escribe uno nuevo para reemplazarlo" : "EAAG…"}
              required={!editing?.hasSecret}
            />
            <p className="text-xs text-muted-foreground">
              Se guarda cifrado en el servidor y no vuelve a mostrarse. Usa un token de página de larga duración
              con permiso <code>pages_read_engagement</code>.
            </p>
            {editing?.hasSecret && (
              <button
                type="button"
                className="self-start text-xs text-destructive underline-offset-4 hover:underline"
                onClick={() =>
                  startTransition(async () => {
                    const r = await clearSourceSecret(editing.id);
                    if (r.ok) {
                      toast.success(r.message);
                      onDone();
                    } else toast.error(r.message);
                  })
                }
              >
                Quitar token guardado
              </button>
            )}
          </div>
        </div>
      )}

      {type === "youtube" && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="source-query">Búsqueda</Label>
            <Input id="source-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder='"San Andrés del Valle" ayuntamiento' />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="source-channel">ID de canal (opcional)</Label>
            <Input id="source-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} placeholder="UC…" />
          </div>
        </div>
      )}

      {type === "bluesky" && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="source-query">Búsqueda</Label>
            <Input id="source-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder='"Alvarado" ayuntamiento' />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="source-account">Cuenta (opcional)</Label>
            <Input id="source-account" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="medio.bsky.social" />
            <p className="text-xs text-muted-foreground">
              Sólo la cuenta configurada aparece con nombre; las demás que encuentre la búsqueda se guardan con seudónimo.
            </p>
          </div>
        </div>
      )}

      {type === "reddit" && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="source-query">Búsqueda</Label>
            <Input id="source-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Alvarado Veracruz" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="source-subreddit">Subreddit (opcional)</Label>
            <Input id="source-subreddit" value={subreddit} onChange={(e) => setSubreddit(e.target.value)} placeholder="veracruz" />
            <p className="text-xs text-muted-foreground">Sólo publicaciones; los autores de Reddit no se guardan.</p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 text-sm">
        {(type === "meta" || type === "youtube") && (
          <label className="flex items-center gap-2">
            <Checkbox checked={includeComments} onCheckedChange={(v) => setIncludeComments(Boolean(v))} />
            Incluir comentarios (los autores de comentarios no se guardan)
          </label>
        )}
        <label className="flex items-center gap-2">
          <Checkbox checked={requireMatch} onCheckedChange={(v) => setRequireMatch(Boolean(v))} />
          Guardar sólo lo que coincida con alguna consulta activa
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || !info.enabled || (!info.official && !canConnectUnofficial)}>
          {pending ? "Guardando…" : editing ? "Guardar cambios" : "Conectar fuente"}
        </Button>
      </div>
    </form>
  );
}
