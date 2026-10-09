// Exporta a Excel los pendientes por despacho con los filtros vigentes,
// incluida la columna de días vencidos que calcula la vista.
import type { NextRequest } from "next/server";
import { requireUsuario } from "@/server/auth-context";
import { puede } from "@/lib/rbac/authorize";
import { detallePendientes, etiquetaInstalacion } from "@/lib/negocio/compras";
import { libroDescarga } from "@/lib/xlsx-export";
import { resolverFiltro, type ParamsCompras } from "../../_filtro";

const TOPE = 20_000;
const fecha = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export async function GET(req: NextRequest) {
  const usuario = await requireUsuario();
  if (!(await puede(usuario, "compras.view"))) return new Response("No autorizado", { status: 403 });

  const sp = Object.fromEntries(req.nextUrl.searchParams) as ParamsCompras;
  const c = await resolverFiltro(sp);
  if (!c) return new Response("Sin compras cargadas", { status: 404 });

  const filas = await detallePendientes(c.filtro, new Date(), TOPE);
  const cuerpo = filas.map((r) => [
    r.nroOrden, r.proveedor, r.itemResumen, r.bodegaCodigo, r.bodegaDesc,
    r.cantOrden, r.cantEntrada, r.cantPendiente, r.valorPendiente,
    fecha(r.fechaOrden), fecha(r.fechaEntrega), r.diasVencido ?? "", r.linea,
    r.instalacion == null ? "Sin catalogar" : etiquetaInstalacion(r.instalacion),
  ]);

  return libroDescarga({
    hoja: "Pendientes por despacho",
    encabezado: ["Nro orden", "Proveedor", "Ítem", "Bodega", "Desc. bodega",
      "Cant. orden", "Cant. entrada", "Cant. pendiente", "Valor neto pendiente",
      "Fecha orden", "Fecha entrega", "Días vencido", "Línea", "Instalación"],
    filas: cuerpo,
    anchos: [16, 34, 40, 10, 28, 12, 12, 14, 18, 12, 12, 12, 24, 18],
    archivo: `pendientes-por-despacho-${c.query.replace(/[=&]/g, "-")}.xlsx`,
  });
}
