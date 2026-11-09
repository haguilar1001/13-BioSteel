// Exporta a Excel los Indicadores Financieros del período vigente: la tabla de
// indicadores (real vs meta, cumplimiento y fórmula) y la venta por línea.
import type { NextRequest } from "next/server";
import { requireUsuario } from "@/server/auth-context";
import { puede, alcanceDe } from "@/lib/rbac/authorize";
import { libroMultiDescarga, type HojaExport } from "@/lib/xlsx-export";
import { formatCOP, formatPorcentaje, formatNumero } from "@/lib/format";
import { calcularIndicadores, type IndicadorCalc } from "@/lib/negocio/indicadores";
import { flujoMensual } from "@/lib/negocio/flujo";
import { ventaPorLinea } from "@/lib/negocio/ventas";
import { mesesConPyg } from "@/lib/negocio/pyg";

const ANIO = 2026;

function fmtValor(v: number, unidad: IndicadorCalc["unidad"]): string {
  switch (unidad) {
    case "cop": return formatCOP(v);
    case "dias": return `${formatNumero(Math.round(v))} días`;
    case "pct": return formatPorcentaje(v);
    case "veces": return `${v.toFixed(1).replace(".", ",")} veces`;
  }
}

export async function GET(req: NextRequest) {
  const usuario = await requireUsuario();
  if (!(await puede(usuario, "cxp.view"))) return new Response("No autorizado", { status: 403 });
  const alcanceCartera = await alcanceDe(usuario, "cartera.view");
  const alcInd = alcanceCartera === "ninguno" ? "todos" : alcanceCartera;

  // Período: los meses de la URL, o el último mes con cierre (igual que la vista).
  const [meses, pygMeses] = await Promise.all([flujoMensual(ANIO), mesesConPyg(ANIO)]);
  const conDatos = meses.filter((m) => m.ingresos > 0 || m.egresos > 0).map((m) => m.mes);
  const pedidos = (req.nextUrl.searchParams.get("meses") ?? "").split(",").map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && conDatos.includes(n));
  let seleccion = [...new Set(pedidos)].sort((a, b) => a - b);
  if (!seleccion.length) {
    const ultimo = conDatos.length ? conDatos[conDatos.length - 1]! : null;
    const ultimoPyg = [...pygMeses].reverse().find((m) => conDatos.includes(m)) ?? null;
    const def = ultimoPyg ?? ultimo;
    seleccion = def ? [def] : [];
  }

  const [indicadores, lineas] = await Promise.all([
    calcularIndicadores(usuario, alcInd, seleccion),
    ventaPorLinea(ANIO, seleccion),
  ]);
  const totalLineas = lineas.reduce((s, l) => s + l.valor, 0);

  const hojas: HojaExport[] = [
    {
      nombre: "Indicadores",
      encabezado: ["#", "Indicador", "Frecuencia", "Valor", "Meta", "Cumplimiento %", "Estado", "Fórmula", "Nota"],
      filas: indicadores.map((i) => [
        i.num, i.nombre, i.frecuencia,
        i.real != null ? fmtValor(i.real, i.unidad) : "—",
        i.metaTexto,
        i.cumplimiento != null ? Number(i.cumplimiento.toFixed(1)) : "",
        i.cumple == null ? "Sin dato" : i.cumple ? "En meta" : "Fuera de meta",
        i.formula, i.nota ?? "",
      ]),
      anchos: [5, 34, 14, 18, 20, 14, 14, 40, 40],
    },
    {
      nombre: "Venta por línea",
      encabezado: ["Línea", "Venta neta", "%"],
      filas: lineas.map((l) => [
        l.linea, l.valor, Number((totalLineas > 0 ? (l.valor / totalLineas) * 100 : 0).toFixed(1)),
      ]),
      anchos: [40, 18, 8],
    },
  ];

  const suf = seleccion.length ? `-${seleccion.join("_")}` : "";
  return libroMultiDescarga({ hojas, archivo: `indicadores-financieros-${ANIO}${suf}.xlsx` });
}
