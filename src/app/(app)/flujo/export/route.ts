// Exporta a Excel el listado de movimientos de flujo (ingresos/egresos)
// respetando los filtros de la URL (mes, grupo, búsqueda).
import type { NextRequest } from "next/server";
import { requireUsuario } from "@/server/auth-context";
import { puede } from "@/lib/rbac/authorize";
import { exportarMovimientos } from "@/lib/negocio/flujo";
import { libroDescarga } from "@/lib/xlsx-export";
import { formatFecha } from "@/lib/format";
import type { TipoMovimiento } from "@prisma/client";

export async function GET(req: NextRequest) {
  const usuario = await requireUsuario();
  if (!(await puede(usuario, "cxp.view"))) return new Response("No autorizado", { status: 403 });

  const sp = req.nextUrl.searchParams;
  const tipo: TipoMovimiento = sp.get("tipo") === "egreso" ? "egreso" : "ingreso";
  const anio = Number(sp.get("anio")) || new Date().getFullYear();
  const mesRaw = sp.get("mes");
  const mes = mesRaw
    ? mesRaw.split(",").map((s) => s.trim()).filter((s) => /^\d+$/.test(s)).map(Number)
    : undefined;
  const grupoRaw = sp.get("grupo");
  const categoriaId = grupoRaw
    ? grupoRaw.split(",").map((s) => s.trim()).filter((s) => /^\d+$/.test(s)).map(Number)
    : undefined;
  const q = sp.get("q") ?? undefined;

  const filas = await exportarMovimientos(tipo, { anio, mes, categoriaId, q });
  const cuerpo: (string | number)[][] = filas.map((m) => [
    formatFecha(m.fecha), m.categoria ?? "", m.terceroNombre, m.nit ?? "", m.detalle ?? "", m.observacion ?? "", m.valor,
  ]);
  cuerpo.push(["", "", "", "", "", "TOTAL", filas.reduce((s, m) => s + m.valor, 0)]);

  return libroDescarga({
    hoja: tipo === "ingreso" ? "Ingresos" : "Egresos",
    encabezado: ["Fecha", "Categoría", "Tercero", "NIT", "Detalle", "Observación", "Valor"],
    filas: cuerpo,
    anchos: [12, 22, 34, 14, 40, 30, 16],
    archivo: `flujo-${tipo === "ingreso" ? "ingresos" : "egresos"}-${anio}${mes?.length === 1 ? `-${String(mes[0]).padStart(2, "0")}` : ""}.xlsx`,
  });
}
