"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plug } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  GmailConnectLinkSchema,
  GmailConnectionPublicSchema,
  type GmailConnectionPublic,
} from "@/shared/schemas/gmail-connection";
import { MailboxStatus } from "./mailbox-status";

function isListening(status: GmailConnectionPublic["status"]) {
  return status === "active" || status === "pending";
}

async function readError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? "No se pudo completar la acción";
}

export function GmailIntegrations() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [connections, setConnections] = useState<GmailConnectionPublic[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<GmailConnectionPublic | null>(null);
  const [revoking, setRevoking] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/gmail/connections");
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const payload = (await response.json()) as { connections?: unknown };
    const parsed = GmailConnectionPublicSchema.array().parse(payload.connections ?? []);
    setConnections(parsed);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await refresh();
        if (!cancelled) {
          setLoadError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "No se pudieron cargar los buzones");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    const result = searchParams.get("gmail");
    if (!result) {
      return;
    }
    if (result === "active") {
      toast.success("Gmail conectado. Recibiremos facturas de ese buzón; esto no autoriza pagos.");
    } else if (result === "pending") {
      toast.message("Google aún no confirmó el buzón. Vuelve a conectar si no aparece como activo.");
    } else {
      toast.error("No se pudo completar la conexión de Gmail.");
    }
    router.replace("/platform/integrations");
  }, [router, searchParams]);

  const live = connections.filter((connection) => isListening(connection.status));
  const connected = live.length > 0;

  async function connectMailbox() {
    setConnecting(true);
    setActionError(null);
    try {
      const response = await fetch("/api/gmail/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: null }),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const link = GmailConnectLinkSchema.parse(await response.json());
      window.location.assign(link.redirectUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo iniciar OAuth de Gmail";
      setConnecting(false);
      setActionError(message);
      toast.error(message, { duration: 8000 });
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) {
      return;
    }
    setRevoking(true);
    try {
      const response = await fetch(`/api/gmail/connections/${revokeTarget.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      await refresh();
      toast.success("Buzón desconectado. Pacta dejará de leer ese correo.");
      setRevokeTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo desconectar el buzón");
    } finally {
      setRevoking(false);
    }
  }

  function onToggle(next: boolean) {
    if (next) {
      if (!connected) {
        void connectMailbox();
      }
      return;
    }
    if (live.length === 1) {
      setRevokeTarget(live[0]!);
      return;
    }
    if (live.length > 1) {
      toast.message("Desconecta cada buzón por separado.");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {loadError ? (
        <Alert variant="destructive">
          <AlertTitle>No hay buzones disponibles</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      {actionError ? (
        <Alert variant="destructive">
          <AlertTitle>No se pudo conectar Gmail</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card size="sm" className="ring-foreground/8">
          <CardHeader className="gap-3">
            <div className="flex items-start justify-between gap-3">
              <Image
                src="/integrations/gmail.png"
                alt=""
                width={36}
                height={36}
                className="size-9 object-contain"
              />
              {connected ? <MailboxStatus status={live[0]?.status ?? "active"} /> : null}
            </div>
            <div>
              <CardTitle>Gmail</CardTitle>
              <CardDescription className="mt-1">
                Recibe facturas PDF e imágenes de uno o varios buzones de la organización.
              </CardDescription>
            </div>
          </CardHeader>
          <CardFooter className="justify-between gap-3">
            {connected ? (
              <Button
                variant="outline"
                size="sm"
                disabled={connecting || live.length !== 1}
                onClick={() => {
                  if (live[0]) {
                    setRevokeTarget(live[0]);
                  }
                }}
              >
                Desconectar
              </Button>
            ) : (
              <Button size="sm" disabled={connecting || loading} onClick={() => void connectMailbox()}>
                {connecting ? <Spinner /> : <Plug />}
                Conectar
              </Button>
            )}
            <Switch
              checked={connected}
              disabled={connecting || loading}
              aria-label={connected ? "Gmail conectado" : "Gmail desconectado"}
              onCheckedChange={onToggle}
            />
          </CardFooter>
        </Card>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">Buzones de Gmail</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Puedes conectar varios. Ninguno concede autoridad de pago.
            </p>
          </div>
          {connected ? (
            <Button variant="outline" size="sm" disabled={connecting} onClick={() => void connectMailbox()}>
              {connecting ? <Spinner /> : null}
              Añadir buzón
            </Button>
          ) : null}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando buzones…</p>
        ) : connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Esta organización aún no tiene un buzón de Gmail.
          </p>
        ) : (
          <Card size="sm">
            <CardContent className="px-0">
              <ul className="divide-y">
                {connections.map((connection) => (
                  <li
                    key={connection.id}
                    className="flex flex-wrap items-center gap-3 px-(--card-spacing) py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {connection.emailAddress ?? connection.alias ?? "Buzón sin confirmar"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {connection.connectedAt
                          ? `Conectado ${new Date(connection.connectedAt).toLocaleString("es")}`
                          : "Esperando autorización de Google"}
                      </p>
                    </div>
                    <MailboxStatus status={connection.status} />
                    {isListening(connection.status) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRevokeTarget(connection)}
                      >
                        Desconectar
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !revoking) {
            setRevokeTarget(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desconectar Gmail</DialogTitle>
            <DialogDescription>
              Pacta dejará de leer{" "}
              {revokeTarget?.emailAddress ?? "este buzón"}. Las facturas ya
              evaluadas no cambian y no se autoriza ningún pago.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={revoking}
              onClick={() => setRevokeTarget(null)}
            >
              Cancelar
            </Button>
            <Button variant="destructive" disabled={revoking} onClick={() => void confirmRevoke()}>
              {revoking ? <Spinner /> : null}
              Desconectar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
