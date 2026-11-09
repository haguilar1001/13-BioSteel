// Exporta a Excel los indicadores de Compras (FOR-GC-011) con el período
// vigente: el formato oficial de órdenes completas, el proxy automático desde
// el estado de las órdenes y la evaluación de proveedores — una hoja cada uno.
import type { NextRequest } from "next/server";
import { requireUsuario } from "@/server/auth-context";
import { puede } from "@/lib/rbac/authorize";
import { libroMultiDescarga, type HojaExport } from "@/lib/xlsx-export";
import {
  resumenIndicador, resumenProxyEstado, resumenEvaluacion,
  CRITERIOS, META_ORDENES, META_PROVEEDOR, PUNTAJE_MAXIMO, MES_LARGO,
} from "@/lib/negocio/indicador-compras";

const r1 = (v: number | null) => (v == null ? "" : Number(v.toFixed(1)));
const r2 = (v: number) => Number(v.toFixed(2));
const estadoMeta = (pct: number | null, meta: number) =>
  pct == null ? "Sin dato" : pct >= meta ? "En meta" : "Fuera de meta";

export async function GET(req: NextRequest) {
  const usuario = await requireUsuario();
  if (!(await puede(usuario, "cxp.view"))) return new Response("No autorizado", { status: 403 });

  const sp = req.nextUrl.searchParams;
  const anio = Number(sp.get("anio")) || new Date().getUTCFullYear();
  const meses = (sp.get("meses") ?? "").split(",").map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
  const acota = meses.length ? meses : undefined;

  const [ind, px, ev] = await Promise.all([
    resumenIndicador(anio, acota),
    resumenProxyEstado(anio, acota),
    resumenEvaluacion(anio, acota),
  ]);

  const hojaMes = (titulo: string, meses: typeof ind.meses, totComp: number, totTot: number, totPct: number | null): HojaExport => ({
    nombre: titulo,
    encabezado: ["Mes", "Completas", "Total", "Incompletas", "% cumplimiento", "Estado"],
    filas: [
      ...meses.filter((m) => m.pct != null).map((m) => [
        MES_LARGO[m.mes]!, m.completas, m.totales, m.totales - m.completas, r1(m.pct), estadoMeta(m.pct, META_ORDENES),
      ]),
      ["Total del período", totComp, totTot, totTot - totComp, r1(totPct), estadoMeta(totPct, META_ORDENES)],
    ],
    anchos: [18, 12, 10, 12, 16, 16],
  });

  const hojas: HojaExport[] = [
    hojaMes("Órdenes completas (formato)", ind.meses, ind.completas, ind.totales, ind.pct),
    hojaMes("Proxy estado (SIESA)", px.meses, px.completas, px.totales, px.pct),
    {
      nombre: "Evaluación proveedores",
      encabezado: ["Proveedor", "Meses", ...CRITERIOS.map((c) => c.label), "Puntaje", "% calificación", "Estado"],
      filas: ev.filas.map((f) => [
        f.proveedor, f.evaluaciones, ...CRITERIOS.map((c) => r2(f.criterios[c.campo] ?? 0)),
        r2(f.total), r1(f.pct), f.pct >= META_PROVEEDOR ? "Satisfactorio" : "Por revisar",
      ]),
      anchos: [34, 8, ...CRITERIOS.map(() => 12), 10, 14, 14],
    },
  ];

  const suf = acota ? `-${acota.join("_")}` : "";
  return libroMultiDescarga({ hojas, archivo: `indicadores-compras-${anio}${suf}.xlsx` });
}
