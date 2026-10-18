/**
 * Purpose: manage the organization's payment policy, supplier catalog, explicit payment
 *   authorizations and approval permissions.
 * Runs in: server (React Server Component; data streamed inside <Suspense>).
 * Triggered by: GET /platform/policies and refresh() after a policies server action.
 * Receives → Returns: request → rendered HTML inside the platform shell (forms only for people
 *   allowed to use them; a prompt to pick an organization when the session has none).
 * Talks to: ensureWorkspaceFromSession, PlatformSection, features/policies (server, permissions,
 *   money, components/policy-forms), shadcn Card, Table, Badge.
 */
import type { Metadata } from "next";
import { Suspense } from "react";
import { PlatformSection } from "@/components/platform/section";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AuthorizationForm,
  LoadDemoDataButton,
  PermissionForm,
  PolicyVersionForm,
  RevokeAuthorizationButton,
  SupplierForm,
} from "@/features/policies/components/policy-forms";
import { formatUsd, toUsdInput } from "@/features/policies/money";
import { checkCanGrantPermissions, checkCanManagePolicies } from "@/features/policies/permissions";
import { getPoliciesOverview, loadPolicyActor } from "@/features/policies/server";
import { devToolsEnabled } from "@/shared/config/dev-tools";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";

export const metadata: Metadata = { title: "Políticas" };

const FREQUENCY_LABEL = { weekly: "semanal", monthly: "mensual", quarterly: "trimestral", yearly: "anual" } as const;
const STATUS_VARIANT = { active: "default", revoked: "destructive", consumed: "secondary" } as const;
const STATUS_LABEL = { active: "activa", revoked: "revocada", consumed: "usada" } as const;

export default function PoliciesPage() {
  return (
    <PlatformSection
      title="Políticas"
      description="Límites, presupuesto y autorizaciones explícitas que el motor aplica a cada factura. Estar en el catálogo o tener historial no autoriza pagos: solo una autorización explícita lo hace."
    >
      <div className="flex flex-col gap-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando políticas…</p>}>
          <PoliciesData />
        </Suspense>
      </div>
    </PlatformSection>
  );
}

// La sesión y la BD son datos de ejecución: con cacheComponents deben leerse dentro de <Suspense>.
async function PoliciesData() {
  let workspace;
  try {
    workspace = await ensureWorkspaceFromSession();
  } catch (error) {
    if (!(error instanceof OrganizationRequiredError)) throw error;
    return (
      <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
        Las políticas pertenecen a una organización. Elige o crea una con el selector de arriba.
      </p>
    );
  }
  const actor = await loadPolicyActor(workspace);
  const overview = await getPoliciesOverview(workspace.organization.id);
  const canManage = checkCanManagePolicies(actor) === null;
  const canGrant = checkCanGrantPermissions(actor) === null;
  const today = new Date().toISOString().slice(0, 10);
  const policy = overview.currentPolicy;

  return (
    <>
      {canGrant && devToolsEnabled() && policy === null && overview.suppliers.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Organización vacía</CardTitle>
            <CardDescription>
              Carga proveedores, una política y una autorización ficticias para la demo. También te otorga permisos
              de aprobación (límite $10,000.00) y de gestión de políticas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoadDemoDataButton />
          </CardContent>
        </Card>
      )}

      {actor.permission === null && (
        <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
          No tienes permisos de pago en esta organización. Un administrador puede otorgártelos abajo.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Política vigente</CardTitle>
          <CardDescription>
            {policy === null
              ? "Sin política: el motor escala todas las facturas hasta que exista una."
              : `Versión ${policy.version}, vigente desde ${policy.effectiveFrom.toISOString().slice(0, 10)}. Cambiarla crea una versión nueva.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {policy !== null && (
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted-foreground">Aprobación automática hasta</dt>
                <dd className="text-lg font-medium">{formatUsd(policy.autoApprovalLimitMinor)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Presupuesto mensual</dt>
                <dd className="text-lg font-medium">{formatUsd(policy.monthlyBudgetMinor)}</dd>
              </div>
            </dl>
          )}
          {canManage && (
            <PolicyVersionForm
              autoLimit={policy === null ? "" : toUsdInput(policy.autoApprovalLimitMinor)}
              budget={policy === null ? "" : toUsdInput(policy.monthlyBudgetMinor)}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Proveedores</CardTitle>
          <CardDescription>Catálogo de la organización. Un proveedor no está autorizado por estar aquí.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {overview.suppliers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin proveedores.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Cuenta conocida</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.suppliers.map((supplier) => (
                  <TableRow key={supplier.id}>
                    <TableCell>{supplier.name}</TableCell>
                    <TableCell className="font-mono text-sm">{supplier.beneficiaryAccountRef ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {canManage && <SupplierForm />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Autorizaciones de pago</CardTitle>
          <CardDescription>
            Cada una cubre un proveedor, una cuenta, un monto máximo y una vigencia, y como máximo una factura por
            periodo. Solo puedes autorizar hasta tu propio límite de aprobación.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {overview.authorizations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin autorizaciones: ninguna factura se aprueba automáticamente.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Cuenta</TableHead>
                  <TableHead>Máximo</TableHead>
                  <TableHead>Alcance</TableHead>
                  <TableHead>Vigencia</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.authorizations.map((auth) => (
                  <TableRow key={auth.id}>
                    <TableCell>{auth.supplierName}</TableCell>
                    <TableCell className="font-mono text-sm">{auth.beneficiaryAccountRef}</TableCell>
                    <TableCell>{formatUsd(auth.maxAmountMinor)}</TableCell>
                    <TableCell>
                      {auth.scope === "one_time" ? "pago único" : `recurrente ${auth.frequency ? FREQUENCY_LABEL[auth.frequency] : ""}`}
                    </TableCell>
                    <TableCell className="text-sm">
                      {auth.validFrom} → {auth.validUntil}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[auth.status]}>{STATUS_LABEL[auth.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage && auth.status === "active" && <RevokeAuthorizationButton authorizationId={auth.id} />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {canManage && (
            <AuthorizationForm suppliers={overview.suppliers.map((s) => ({ id: s.id, name: s.name }))} today={today} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Permisos de aprobación</CardTitle>
          <CardDescription>
            Quién puede aprobar facturas escaladas, hasta qué monto, y quién gestiona políticas. Sin permisos explícitos
            nadie aprueba. Solo un administrador los cambia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Persona</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Permisos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.members.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell>
                    <div>{member.displayName ?? member.email}</div>
                    {member.displayName !== null && <div className="text-xs text-muted-foreground">{member.email}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={member.role === "admin" ? "default" : "outline"}>{member.role}</Badge>
                  </TableCell>
                  <TableCell>
                    {canGrant ? (
                      <PermissionForm
                        userId={member.userId}
                        canApprove={member.permission?.canApprove ?? false}
                        approvalLimit={
                          member.permission?.approvalLimitMinor == null ? "" : toUsdInput(member.permission.approvalLimitMinor)
                        }
                        canManagePolicies={member.permission?.canManagePolicies ?? false}
                      />
                    ) : (
                      <span className="text-sm">
                        {member.permission?.canApprove && member.permission.approvalLimitMinor !== null
                          ? `Aprueba hasta ${formatUsd(member.permission.approvalLimitMinor)}`
                          : "No aprueba"}
                        {member.permission?.canManagePolicies ? " · gestiona políticas" : ""}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
