// ==========================================================
// Consultas de los INDICADORES DE CALIDAD DE COMPRAS (FOR-GC-011).
//
// Dos indicadores que no salen de SIESA: los lleva a mano el Líder de Compras
// en su formato de calidad, y por eso tienen tabla propia (ver
// importar-indicador-compras.ts).
//
//   1. % de órdenes de compra recibidas completas — meta > 85 %
//      Se calcula SIEMPRE como completas/totales, nunca se lee un porcentaje
//      guardado: así el número y sus dos operandos no pueden contradecirse.
//      Ojo con el % del periodo: es la suma de completas sobre la suma de
//      totales, no el promedio de los porcentajes mensuales. Un mes con 40
//      órdenes no pesa lo mismo que uno con 540.
//
//   2. Calificación de proveedores sobre 5,0 en seis criterios.
//      Aquí sí es un promedio simple entre proveedores: cada proveedor cuenta
//      una vez, porque lo que se está midiendo es al proveedor, no al volumen.
// ==========================================================
import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { CRITERIOS, PUNTAJE_MAXIMO } from "./importar-indicador-compras";

export { CRITERIOS, PUNTAJE_MAXIMO };

export const MES_LARGO = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
export const MES_CORTO = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Meta del indicador de órdenes completas, en %. */
export const META_ORDENES = 85;

/**
 * Umbral de "proveedor en verde" para la calificación, en %. El formato no
 * fija una meta explícita; 95 % (4,75 de 5,0) es el corte que separa a los que
 * pierden más de un cuarto de punto. Si Calidad define otro, se cambia aquí.
 */
export const META_PROVEEDOR = 95;

const n = (v: unknown): number => (v == null ? 0 : Number(v));

// ---------- 1) Órdenes recibidas completas ----------

export interface MesIndicador {
  mes: number;
  completas: number;
  totales: number;
  /** completas/totales × 100. null si el mes no está diligenciado. */
  pct: number | null;
  cumple: boolean | null;
}

export interface ResumenIndicador {
  meses: MesIndicador[];
  /** Meses efectivamente diligenciados. */
  conDato: number[];
  completas: number;
  totales: number;
  /** % del periodo: Σ completas / Σ totales (ponderado, no promedio simple). */
  pct: number | null;
  mesesEnMeta: number;
  /** Mes con el peor cumplimiento del periodo. */
  peor: MesIndicador | null;
}

export async function aniosConIndicador(): Promise<number[]> {
  const filas = await prisma.indicadorCompraMes.groupBy({ by: ["anio"], orderBy: { anio: "asc" } });
  return filas.map((f) => f.anio);
}

export async function resumenIndicador(anio: number, meses?: number[]): Promise<ResumenIndicador> {
  const filas = await prisma.indicadorCompraMes.findMany({
    where: { anio, ...(meses && meses.length ? { mes: { in: meses } } : {}) },
    orderBy: { mes: "asc" },
  });
  const mapa = new Map(filas.map((f) => [f.mes, f]));

  const todos: MesIndicador[] = Array.from({ length: 12 }, (_, i) => {
    const f = mapa.get(i + 1);
    if (!f || f.ordenesTotales <= 0) {
      return { mes: i + 1, completas: 0, totales: 0, pct: null, cumple: null };
    }
    const pct = (f.ordenesCompletas / f.ordenesTotales) * 100;
    return {
      mes: i + 1, completas: f.ordenesCompletas, totales: f.ordenesTotales,
      pct, cumple: pct > META_ORDENES,
    };
  });

  const conDato = todos.filter((m) => m.pct != null);
  const completas = conDato.reduce((s, m) => s + m.completas, 0);
  const totales = conDato.reduce((s, m) => s + m.totales, 0);
  const peor = conDato.length
    ? conDato.reduce((min, m) => (m.pct! < min.pct! ? m : min))
    : null;

  return {
    meses: todos,
    conDato: conDato.map((m) => m.mes),
    completas, totales,
    pct: totales > 0 ? (completas / totales) * 100 : null,
    mesesEnMeta: conDato.filter((m) => m.cumple).length,
    peor,
  };
}

// ---------- 1-bis) Proxy automático desde el estado de las órdenes ----------
//
// Mismo indicador, pero calculado desde SIESA en vez del formato: una orden
// cuenta como COMPLETA cuando TODOS sus renglones están en "Cumplido". Es un
// PROXY, no el dato oficial, y no cuadra con el formato manual por tres razones
// que la pantalla deja dichas:
//
//   · Es el estado ACTUAL de la orden, no el que tenía al recibirse. Una orden
//     vieja que ya se cerró aparece completa hoy, así que los meses pasados se
//     "arreglan" solos y suben hacia 100 %.
//   · El denominador son TODAS las órdenes del mes, incluidas las que aún no
//     han llegado ("Aprobado", "En elaboración"): bajan el % de los meses
//     recientes sin que sea un incumplimiento real. Por eso va el desglose.
//   · El mes es el de la FECHA DE ORDEN, no el de recepción.
//
// El estado de la orden se resume con el "peor" de sus renglones: basta un
// renglón sin cumplir para que la orden no esté completa.

export interface ResumenProxyEstado {
  meses: MesIndicador[];
  conDato: number[];
  completas: number;
  totales: number;
  pct: number | null;
  mesesEnMeta: number;
  peor: MesIndicador | null;
  /** Órdenes clasificadas por su estado agregado, para no esconder nada. */
  porEstado: { cumplido: number; parcial: number; aprobado: number; elaboracion: number };
}

export async function aniosConProxyEstado(): Promise<number[]> {
  const filas = await prisma.compraOrden.groupBy({ by: ["anio"], orderBy: { anio: "asc" } });
  return filas.map((f) => f.anio);
}

export async function resumenProxyEstado(anio: number, meses?: number[]): Promise<ResumenProxyEstado> {
  const filtroMes = meses && meses.length ? Prisma.sql`AND "mes" IN (${Prisma.join(meses)})` : Prisma.empty;

  const [filasMes, brk] = await Promise.all([
    // Órdenes por mes: completa = todos los renglones en "Cumplido". El mes de
    // la orden es único (todos sus renglones comparten fechaOrden), MIN lo fija.
    prisma.$queryRaw<{ mes: number; totales: number; completas: number }[]>`
      WITH por_orden AS (
        SELECT "nroOrden", MIN("mes") AS mes, bool_and("estado" = 'Cumplido') AS completa
        FROM "CompraOrden" WHERE "anio" = ${anio} ${filtroMes}
        GROUP BY "nroOrden"
      )
      SELECT mes, COUNT(*)::int AS totales, COUNT(*) FILTER (WHERE completa)::int AS completas
      FROM por_orden GROUP BY mes ORDER BY mes`,
    // Desglose por estado agregado de la orden en todo el período.
    prisma.$queryRaw<{ cumplido: number; parcial: number; aprobado: number; elaboracion: number }[]>`
      WITH por_orden AS (
        SELECT "nroOrden",
               bool_and("estado" = 'Cumplido') AS completa,
               bool_or("estado" IN ('Cumplido', 'Parcial')) AS recibido,
               bool_and("estado" = 'En elaboración') AS borrador
        FROM "CompraOrden" WHERE "anio" = ${anio} ${filtroMes}
        GROUP BY "nroOrden"
      )
      SELECT
        COUNT(*) FILTER (WHERE completa)::int AS cumplido,
        COUNT(*) FILTER (WHERE NOT completa AND recibido)::int AS parcial,
        COUNT(*) FILTER (WHERE NOT completa AND NOT recibido AND NOT borrador)::int AS aprobado,
        COUNT(*) FILTER (WHERE borrador)::int AS elaboracion
      FROM por_orden`,
  ]);

  const mapa = new Map(filasMes.map((f) => [Number(f.mes), f]));
  const todos: MesIndicador[] = Array.from({ length: 12 }, (_, i) => {
    const f = mapa.get(i + 1);
    const totales = n(f?.totales);
    if (!f || totales <= 0) return { mes: i + 1, completas: 0, totales: 0, pct: null, cumple: null };
    const completas = n(f.completas);
    const pct = (completas / totales) * 100;
    return { mes: i + 1, completas, totales, pct, cumple: pct > META_ORDENES };
  });

  const conDato = todos.filter((m) => m.pct != null);
  const completas = conDato.reduce((s, m) => s + m.completas, 0);
  const totales = conDato.reduce((s, m) => s + m.totales, 0);
  const peor = conDato.length
    ? conDato.reduce((min, m) => (m.pct! < min.pct! ? m : min))
    : null;
  const b = brk[0] ?? { cumplido: 0, parcial: 0, aprobado: 0, elaboracion: 0 };

  return {
    meses: todos,
    conDato: conDato.map((m) => m.mes),
    completas, totales,
    pct: totales > 0 ? (completas / totales) * 100 : null,
    mesesEnMeta: conDato.filter((m) => m.cumple).length,
    peor,
    porEstado: {
      cumplido: n(b.cumplido), parcial: n(b.parcial), aprobado: n(b.aprobado), elaboracion: n(b.elaboracion),
    },
  };
}

// ---------- 2) Evaluación de proveedores ----------

export interface FilaProveedorEval {
  proveedor: string;
  /** Meses evaluados dentro del filtro. */
  evaluaciones: number;
  total: number;
  pct: number;
  criterios: Record<string, number>;
  /** true si el proveedor está en la hoja de PROVEEDORES ACTIVOS. */
  enCatalogo: boolean;
}

export interface MesEvaluacion { mes: number; promedio: number; proveedores: number }

export interface ResumenEvaluacion {
  filas: FilaProveedorEval[];
  porMes: MesEvaluacion[];
  mesesConDato: number[];
  /** Promedio simple del % entre proveedores del filtro. */
  promedio: number | null;
  evaluados: number;
  enMeta: number;
  /** Promedio de cada criterio sobre su puntaje máximo observado. */
  porCriterio: { campo: string; label: string; peso: number; promedio: number; maximo: number }[];
  activos: number;
  /** Evaluados que no están en el catálogo de activos. */
  fueraDeCatalogo: string[];
}

export async function mesesConEvaluacion(anio: number): Promise<number[]> {
  const filas = await prisma.evaluacionProveedor.groupBy({
    by: ["mes"], where: { anio }, orderBy: { mes: "asc" },
  });
  return filas.map((f) => f.mes);
}

export async function resumenEvaluacion(anio: number, meses?: number[]): Promise<ResumenEvaluacion> {
  const acota = meses && meses.length ? { mes: { in: meses } } : {};
  const [evals, activos] = await Promise.all([
    prisma.evaluacionProveedor.findMany({ where: { anio, ...acota }, orderBy: [{ proveedor: "asc" }] }),
    prisma.proveedorActivo.findMany({ select: { razonSocial: true } }),
  ]);

  const catalogo = new Set(activos.map((a) => a.razonSocial));

  // Un proveedor evaluado en varios meses se promedia entre sus meses: la
  // tabla habla del proveedor en el periodo, no de una evaluación suelta.
  const porProveedor = new Map<string, { total: number; pct: number; crit: Record<string, number>; n: number }>();
  for (const e of evals) {
    const acc = porProveedor.get(e.proveedor) ?? { total: 0, pct: 0, crit: {}, n: 0 };
    acc.total += n(e.total);
    acc.pct += n(e.pct);
    acc.n += 1;
    for (const c of CRITERIOS) {
      acc.crit[c.campo] = (acc.crit[c.campo] ?? 0) + n((e as unknown as Record<string, unknown>)[c.campo]);
    }
    porProveedor.set(e.proveedor, acc);
  }

  const filas: FilaProveedorEval[] = [...porProveedor.entries()].map(([proveedor, a]) => ({
    proveedor,
    evaluaciones: a.n,
    total: a.total / a.n,
    pct: a.pct / a.n,
    criterios: Object.fromEntries(CRITERIOS.map((c) => [c.campo, (a.crit[c.campo] ?? 0) / a.n])),
    enCatalogo: catalogo.has(proveedor),
  })).sort((x, y) => y.pct - x.pct || x.proveedor.localeCompare(y.proveedor, "es"));

  // Promedio por mes: cada mes vale por sí mismo, sin importar el filtro.
  const mesMap = new Map<number, { suma: number; n: number }>();
  for (const e of evals) {
    const acc = mesMap.get(e.mes) ?? { suma: 0, n: 0 };
    acc.suma += n(e.pct); acc.n += 1;
    mesMap.set(e.mes, acc);
  }
  const porMes = [...mesMap.entries()]
    .map(([mes, a]) => ({ mes, promedio: a.suma / a.n, proveedores: a.n }))
    .sort((a, b) => a.mes - b.mes);

  // Promedio de cada criterio, con el máximo realmente observado como techo:
  // el formato no publica el tope por criterio y deducirlo de los datos es
  // más honesto que inventarse una escala.
  const porCriterio = CRITERIOS.map((c) => {
    const vals = evals.map((e) => n((e as unknown as Record<string, unknown>)[c.campo]));
    return {
      campo: c.campo, label: c.label, peso: c.peso,
      promedio: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0,
      maximo: vals.length ? Math.max(...vals) : 0,
    };
  });

  return {
    filas, porMes,
    mesesConDato: porMes.map((m) => m.mes),
    promedio: filas.length ? filas.reduce((s, f) => s + f.pct, 0) / filas.length : null,
    evaluados: filas.length,
    enMeta: filas.filter((f) => f.pct >= META_PROVEEDOR).length,
    porCriterio,
    activos: activos.length,
    fueraDeCatalogo: filas.filter((f) => !f.enCatalogo).map((f) => f.proveedor),
  };
}
