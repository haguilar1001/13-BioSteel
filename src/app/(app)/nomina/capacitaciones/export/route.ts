// Exporta a Excel el indicador de Capacitaciones con el período vigente:
// resumen mensual, los dos indicadores (ejecución y eficacia), los rankings
// por capacitación y por colaborador, y el detalle de participantes.
import type { NextRequest } from "next/server";
import { requireUsuario } from "@/server/auth-context";
import { puede } from "@/lib/rbac/authorize";
import { libroMultiDescarga, type HojaExport } from "@/lib/xlsx-export";
import {
  registros, porMes, porCapacitacion, porColaborador,
  ejecucion, detalleCapacitaciones, META_EFICACIA, MES_LARGO,
} from "@/lib/negocio/capacitaciones";

const r1 = (v: number | null | undefined) => (v == null ? "" : Number(v.toFixed(1)));

export async function GET(req: NextRequest) {
  const usuario = await requireUsuario();
  if (!(await puede(usuario, "capacitaciones.view"))) return new Response("No autorizado", { status: 403 });

  const sp = req.nextUrl.searchParams;
  const anio = Number(sp.get("anio")) || new Date().getUTCFullYear();
  const todos = await registros(anio);
  const mesesConDatos = [...new Set(todos.map((r) => r.mes))];
  const mesParam = Number(sp.get("mes"));
  const mes = mesesConDatos.includes(mesParam) ? mesParam : undefined;

  const rs = mes ? todos.filter((r) => r.mes === mes) : todos;
  const meses = porMes(todos);
  const caps = porCapacitacion(rs);
  const colabs = porColaborador(rs);
  const filasEjecucion = await ejecucion(anio, todos);
  const detalleCaps = await detalleCapacitaciones(anio, rs, mes);

  const hojas: HojaExport[] = [
    {
      nombre: "Resumen mensual",
      encabezado: ["Mes", "Pre %", "Post %", "% final", "Eficacia %"],
      filas: meses.map((m) => [MES_LARGO[m.mes]!, r1(m.pre), r1(m.post), r1(m.promedio), r1(m.eficacia)]),
      anchos: [16, 10, 10, 10, 12],
    },
    {
      nombre: "A · Ejecución",
      encabezado: ["Mes", "Ejecutadas", "Planeadas", "Resultado %", "Estado"],
      filas: filasEjecucion.map((f) => [
        MES_LARGO[f.mes]!, f.ejecutadas, f.planeadas ?? "sin plan", r1(f.resultado),
        f.resultado == null ? "—" : f.cumple ? "Cumple" : "No cumple",
      ]),
      anchos: [16, 12, 12, 14, 12],
    },
    {
      nombre: "B · Eficacia",
      encabezado: ["Mes", "Pre %", "Post %", "Mejora (pts)", "Eficacia %", "Estado"],
      filas: meses.map((m) => [
        MES_LARGO[m.mes]!, r1(m.pre), r1(m.post), r1(m.post - m.pre), r1(m.eficacia),
        m.eficacia > META_EFICACIA ? "Cumple" : "No cumple",
      ]),
      anchos: [16, 10, 10, 14, 12, 12],
    },
    {
      nombre: "Por capacitación",
      encabezado: ["Capacitación", "Mes", "Participantes", "Promedio %"],
      filas: caps.map((c) => [c.capacitacion, MES_LARGO[c.mes]!, c.participantes, r1(c.promedio)]),
      anchos: [44, 14, 14, 12],
    },
    {
      nombre: "Por colaborador",
      encabezado: ["Colaborador", "Capacitaciones", "Promedio %"],
      filas: colabs.map((c) => [c.colaborador, c.capacitaciones, r1(c.promedio)]),
      anchos: [34, 16, 12],
    },
    {
      nombre: "Detalle participantes",
      encabezado: ["Mes", "Capacitación", "Estado", "Colaborador", "Pre %", "Post %", "Mejora (pts)", "% final"],
      filas: detalleCaps.flatMap((d) =>
        d.participantes.map((p) => [
          MES_LARGO[d.mes]!, d.capacitacion, d.estado || "—", p.colaborador,
          r1(p.pre), r1(p.post), r1(p.post - p.pre), r1(p.final),
        ])),
      anchos: [14, 40, 16, 32, 10, 10, 14, 10],
    },
  ];

  const suf = mes ? `-${mes}` : "";
  return libroMultiDescarga({ hojas, archivo: `capacitaciones-${anio}${suf}.xlsx` });
}
