// Exporta a Excel el indicador de Asistencia Técnica con el período y los
// asesores vigentes: calificación por asesor, promedio por ítem, tendencia
// mensual y el detalle de evaluaciones.
import type { NextRequest } from "next/server";
import { requireUsuario } from "@/server/auth-context";
import { puede } from "@/lib/rbac/authorize";
import { libroMultiDescarga, type HojaExport } from "@/lib/xlsx-export";
import {
  evaluaciones, agregar, porMes, porAsesor,
  ITEMS, META, MES_LARGO,
} from "@/lib/negocio/asistencia-tecnica";

const r2 = (v: number) => Number(v.toFixed(2));
const fecha = (d: Date) => d.toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  const usuario = await requireUsuario();
  if (!(await puede(usuario, "cxp.view"))) return new Response("No autorizado", { status: 403 });

  const sp = req.nextUrl.searchParams;
  const anio = Number(sp.get("anio")) || new Date().getUTCFullYear();
  const mes = (sp.get("mes") ?? "").split(",").map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
  const asesor = (sp.get("asesor") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const delAnio = await evaluaciones(anio);
  const periodo = delAnio.filter((e) =>
    (!mes.length || mes.includes(e.mes)) && (!asesor.length || asesor.includes(e.asesor)));
  const total = agregar(periodo);
  const serie = porMes(delAnio.filter((e) => !asesor.length || asesor.includes(e.asesor)));
  const asesores = porAsesor(periodo);

  const hojas: HojaExport[] = [
    {
      nombre: "Por asesor",
      encabezado: ["Asesor", "Evaluaciones", "Calificación", "Estado"],
      filas: asesores.map((a) => [a.asesor, a.n, r2(a.final), a.cumpleMeta ? "Cumple" : "Bajo meta"]),
      anchos: [34, 12, 12, 12],
    },
    {
      nombre: "Promedio por ítem",
      encabezado: ["#", "Ítem", "Promedio", `Meta (${r2(META)})`],
      filas: ITEMS.map((it, i) => [i + 1, it.label, r2(total.items[i] ?? 0), total.items[i]! >= META ? "Cumple" : "Bajo"]),
      anchos: [5, 40, 12, 14],
    },
    {
      nombre: "Tendencia mensual",
      encabezado: ["Mes", "Calificación final", ...ITEMS.map((it) => it.label)],
      filas: serie.map((s) => [MES_LARGO[s.mes]!, r2(s.final), ...s.items.map((v) => r2(v))]),
      anchos: [16, 16, ...ITEMS.map(() => 14)],
    },
    {
      nombre: "Detalle evaluaciones",
      encabezado: ["Fecha", "Paciente", "Procedimiento", "IPS", "Especialista", "Asesor",
        "Conocimiento", "Desempeño", "Capacidad", "Habilidad", "Promedio", "Adversos"],
      filas: periodo.map((e) => {
        const prom = (e.conocimiento + e.desempeno + e.capacidad + e.habilidad) / 4;
        const adv = [e.novedades && "novedad", e.eventos && "evento", e.incidentes && "incidente"].filter(Boolean).join(", ");
        return [
          fecha(e.fecha), e.paciente, e.procedimiento, e.ips, e.especialista, e.asesor,
          r2(e.conocimiento), r2(e.desempeno), r2(e.capacidad), r2(e.habilidad), r2(prom), adv || "ninguno",
        ];
      }),
      anchos: [12, 24, 28, 20, 22, 24, 12, 12, 12, 12, 10, 22],
    },
  ];

  const suf = [mes.length ? mes.join("_") : "", asesor.length ? "asesores" : ""].filter(Boolean).join("-");
  return libroMultiDescarga({ hojas, archivo: `asistencia-tecnica-${anio}${suf ? `-${suf}` : ""}.xlsx` });
}
