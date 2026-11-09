// Exporta a Excel el indicador de Almacén (% de cumplimiento de
// especificaciones técnicas): detalle mensual del año, y por tipo de recepción
// y por resultado del período vigente.
import type { NextRequest } from "next/server";
import { requireUsuario } from "@/server/auth-context";
import { puede } from "@/lib/rbac/authorize";
import { libroMultiDescarga, type HojaExport } from "@/lib/xlsx-export";
import { resumenAceptacion, META, MES_LARGO } from "@/lib/negocio/indicador-almacen";

const r1 = (v: number | null) => (v == null ? "" : Number(v.toFixed(1)));
const estadoMeta = (pct: number | null) => (pct == null ? "Sin dato" : pct >= META ? "En meta" : "Fuera de meta");

export async function GET(req: NextRequest) {
  const usuario = await requireUsuario();
  if (!(await puede(usuario, "recepcion.view"))) return new Response("No autorizado", { status: 403 });

  const sp = req.nextUrl.searchParams;
  const anio = Number(sp.get("anio")) || new Date().getUTCFullYear();
  const meses = (sp.get("meses") ?? "").split(",").map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
  const acota = meses.length ? meses : undefined;

  const base = await resumenAceptacion(anio);
  const r = acota ? await resumenAceptacion(anio, acota) : base;

  const hojas: HojaExport[] = [
    {
      nombre: "Detalle mensual",
      encabezado: ["Mes", "Aceptadas", "Evaluadas", "No conformes", "% cumplimiento", "Estado"],
      filas: [
        ...base.meses.filter((m) => m.pct != null).map((m) => [
          MES_LARGO[m.mes]!, m.aceptadas, m.evaluadas, m.evaluadas - m.aceptadas, r1(m.pct), estadoMeta(m.pct),
        ]),
        ["Total del año", base.aceptadas, base.evaluadas, base.evaluadas - base.aceptadas, r1(base.pct), estadoMeta(base.pct)],
      ],
      anchos: [18, 12, 12, 14, 16, 16],
    },
    {
      nombre: "Por tipo de recepción",
      encabezado: ["Tipo", "Aceptadas", "Evaluadas", "% cumplimiento", "Estado"],
      filas: r.porTipo.map((t) => [t.label, t.aceptadas, t.evaluadas, r1(t.pct), estadoMeta(t.pct)]),
      anchos: [28, 12, 12, 16, 16],
    },
    {
      nombre: "Por resultado",
      encabezado: ["Resultado", "Recepciones", "% del período"],
      filas: r.porResultado.map((x) => [
        x.resultado, x.n, r.evaluadas > 0 ? Number(((x.n / r.evaluadas) * 100).toFixed(1)) : "",
      ]),
      anchos: [28, 14, 16],
    },
  ];

  const suf = acota ? `-${acota.join("_")}` : "";
  return libroMultiDescarga({ hojas, archivo: `indicadores-almacen-${anio}${suf}.xlsx` });
}
