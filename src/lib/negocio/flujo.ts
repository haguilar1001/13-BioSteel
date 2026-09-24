// ==========================================================
// Lógica del módulo Flujo de Caja: movimientos (ingresos/egresos),
// presupuesto mensual y comparativo presupuesto vs. real por grupo.
// ==========================================================
import "server-only";
import type { Prisma, TipoMovimiento } from "@prisma/client";
import { prisma } from "@/lib/db";

export const MESES_LABEL = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export interface MesFlujo {
  mes: number;
  ingresos: number;
  egresos: number;
  presupuesto: number;
  neto: number; // ingresos − egresos
}

/** Resumen mensual: ingresos, egresos y presupuesto por mes del año. */
export async function flujoMensual(anio: number): Promise<MesFlujo[]> {
  const [movs, pres] = await Promise.all([
    prisma.movimientoFlujo.groupBy({ by: ["mes", "tipo"], where: { anio }, _sum: { valor: true } }),
    prisma.presupuestoMensual.groupBy({ by: ["mes"], where: { anio }, _sum: { valor: true } }),
  ]);

  const meses = new Map<number, MesFlujo>();
  const get = (m: number) => {
    let e = meses.get(m);
    if (!e) { e = { mes: m, ingresos: 0, egresos: 0, presupuesto: 0, neto: 0 }; meses.set(m, e); }
    return e;
  };
  for (const g of movs) {
    const e = get(g.mes);
    const v = g._sum.valor?.toNumber() ?? 0;
    if (g.tipo === "ingreso") e.ingresos += v; else e.egresos += v;
  }
  for (const g of pres) get(g.mes).presupuesto += g._sum.valor?.toNumber() ?? 0;
  for (const e of meses.values()) e.neto = e.ingresos - e.egresos;

  return [...meses.values()].sort((a, b) => a.mes - b.mes);
}

export interface TotalesFlujo {
  ingresos: number;
  egresos: number;
  presupuesto: number;
  neto: number;
  ejecucion: number; // egresos / presupuesto * 100
}

export async function totalesFlujo(anio: number): Promise<TotalesFlujo> {
  const meses = await flujoMensual(anio);
  const t = meses.reduce(
    (a, m) => ({ ingresos: a.ingresos + m.ingresos, egresos: a.egresos + m.egresos, presupuesto: a.presupuesto + m.presupuesto }),
    { ingresos: 0, egresos: 0, presupuesto: 0 },
  );
  return { ...t, neto: t.ingresos - t.egresos, ejecucion: t.presupuesto > 0 ? (t.egresos / t.presupuesto) * 100 : 0 };
}

// ---------- Movimientos (listado) ----------
export interface FilaMovimiento {
  id: number;
  fecha: Date;
  mes: number;
  categoria: string | null;
  categoriaId: number | null;
  terceroNombre: string;
  nit: string | null;
  detalle: string | null;
  observacion: string | null;
  valor: number;
}

export interface FiltrosMov {
  anio: number;
  mes?: number[];
  categoriaId?: number[];
  q?: string;
}

function whereMov(tipo: TipoMovimiento, f: FiltrosMov): Prisma.MovimientoFlujoWhereInput {
  const q = f.q?.trim();
  return {
    tipo,
    anio: f.anio,
    ...(f.mes?.length ? { mes: { in: f.mes } } : {}),
    ...(f.categoriaId?.length ? { categoriaId: { in: f.categoriaId } } : {}),
    ...(q
      ? {
          OR: [
            { terceroNombre: { contains: q, mode: "insensitive" } },
            { nit: { contains: q, mode: "insensitive" } },
            { observacion: { contains: q, mode: "insensitive" } },
            { detalle: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export type CampoOrden = "fecha" | "tercero" | "grupo" | "detalle" | "observacion" | "valor";
export type DirOrden = "asc" | "desc";
export interface OrdenMov { campo: CampoOrden; dir: DirOrden }

// El orden se aplica en la consulta (no en el cliente) para que sea correcto
// sobre TODO el conjunto, ya que solo se traen 300 filas.
function orderByMov(orden?: OrdenMov): Prisma.MovimientoFlujoOrderByWithRelationInput[] {
  const dir = orden?.dir ?? "desc";
  switch (orden?.campo) {
    case "tercero": return [{ terceroNombre: dir }, { fecha: "desc" }];
    case "grupo": return [{ categoria: { nombre: dir } }, { fecha: "desc" }];
    case "detalle": return [{ detalle: dir }, { fecha: "desc" }];
    case "observacion": return [{ observacion: dir }, { fecha: "desc" }];
    case "valor": return [{ valor: dir }, { id: "desc" }];
    default: return [{ fecha: dir }, { id: "desc" }];
  }
}

export async function listarMovimientos(
  tipo: TipoMovimiento,
  f: FiltrosMov,
  orden?: OrdenMov,
): Promise<{ filas: FilaMovimiento[]; total: number; suma: number }> {
  const where = whereMov(tipo, f);
  const [total, agg, movs] = await Promise.all([
    prisma.movimientoFlujo.count({ where }),
    prisma.movimientoFlujo.aggregate({ where, _sum: { valor: true } }),
    prisma.movimientoFlujo.findMany({
      where,
      select: {
        id: true, fecha: true, mes: true, terceroNombre: true, nit: true,
        detalle: true, observacion: true, valor: true, categoriaId: true,
        categoria: { select: { nombre: true } },
      },
      orderBy: orderByMov(orden),
      take: 300,
    }),
  ]);

  const filas = movs.map((m) => ({
    id: m.id, fecha: m.fecha, mes: m.mes, categoria: m.categoria?.nombre ?? null, categoriaId: m.categoriaId,
    terceroNombre: m.terceroNombre, nit: m.nit, detalle: m.detalle, observacion: m.observacion,
    valor: m.valor.toNumber(),
  }));
  return { filas, total, suma: agg._sum.valor?.toNumber() ?? 0 };
}

/** Todos los movimientos del filtro (sin límite) para exportar a Excel. */
export async function exportarMovimientos(tipo: TipoMovimiento, f: FiltrosMov): Promise<FilaMovimiento[]> {
  const movs = await prisma.movimientoFlujo.findMany({
    where: whereMov(tipo, f),
    select: {
      id: true, fecha: true, mes: true, terceroNombre: true, nit: true,
      detalle: true, observacion: true, valor: true, categoriaId: true,
      categoria: { select: { nombre: true } },
    },
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
  });
  return movs.map((m) => ({
    id: m.id, fecha: m.fecha, mes: m.mes, categoria: m.categoria?.nombre ?? null, categoriaId: m.categoriaId,
    terceroNombre: m.terceroNombre, nit: m.nit, detalle: m.detalle, observacion: m.observacion,
    valor: m.valor.toNumber(),
  }));
}

// ---------- Agregado por tercero (mayor a menor) ----------
export interface FilaTercero {
  terceroNombre: string;
  nit: string | null;
  total: number;
  movimientos: number;
}

/** Total por tercero (cliente/proveedor) para el tipo y mes dados, desc. */
export async function movimientosPorTercero(
  tipo: TipoMovimiento,
  f: FiltrosMov,
): Promise<FilaTercero[]> {
  const where = whereMov(tipo, f);
  const grupos = await prisma.movimientoFlujo.groupBy({
    by: ["terceroNombre"],
    where,
    _sum: { valor: true },
    _count: { _all: true },
  });

  // El NIT no entra en el groupBy (puede variar por fila); se resuelve el más
  // frecuente por nombre en una segunda pasada ligera.
  const nits = await prisma.movimientoFlujo.groupBy({
    by: ["terceroNombre", "nit"],
    where,
    _count: { _all: true },
  });
  const nitPorNombre = new Map<string, string>();
  const mejorConteo = new Map<string, number>();
  for (const g of nits) {
    if (!g.nit) continue;
    const c = g._count._all;
    if (c > (mejorConteo.get(g.terceroNombre) ?? 0)) {
      mejorConteo.set(g.terceroNombre, c);
      nitPorNombre.set(g.terceroNombre, g.nit);
    }
  }

  return grupos
    .map((g) => ({
      terceroNombre: g.terceroNombre,
      nit: nitPorNombre.get(g.terceroNombre) ?? null,
      total: g._sum.valor?.toNumber() ?? 0,
      movimientos: g._count._all,
    }))
    .sort((a, b) => b.total - a.total);
}

// ---------- Presupuesto vs Real ----------
export interface FilaPresupuesto {
  categoria: string;
  presupuesto: number;
  real: number;
  desviacion: number; // real − presupuesto
  ejecucion: number;  // real / presupuesto * 100
}

export async function presupuestoVsReal(anio: number, mes?: number[]): Promise<FilaPresupuesto[]> {
  const wPres: Prisma.PresupuestoMensualWhereInput = { anio, ...(mes?.length ? { mes: { in: mes } } : {}) };
  const wReal: Prisma.MovimientoFlujoWhereInput = { anio, tipo: "egreso", ...(mes?.length ? { mes: { in: mes } } : {}) };

  const [cats, pres, real] = await Promise.all([
    prisma.categoriaFlujo.findMany({ select: { id: true, nombre: true, orden: true } }),
    prisma.presupuestoMensual.groupBy({ by: ["categoriaId"], where: wPres, _sum: { valor: true } }),
    prisma.movimientoFlujo.groupBy({ by: ["categoriaId"], where: wReal, _sum: { valor: true } }),
  ]);

  const nombre = new Map(cats.map((c) => [c.id, c.nombre]));
  const orden = new Map(cats.map((c) => [c.id, c.orden]));
  const mapa = new Map<number, { presupuesto: number; real: number }>();
  for (const p of pres) {
    const e = mapa.get(p.categoriaId) ?? { presupuesto: 0, real: 0 };
    e.presupuesto += p._sum.valor?.toNumber() ?? 0;
    mapa.set(p.categoriaId, e);
  }
  for (const r of real) {
    if (r.categoriaId == null) continue;
    const e = mapa.get(r.categoriaId) ?? { presupuesto: 0, real: 0 };
    e.real += r._sum.valor?.toNumber() ?? 0;
    mapa.set(r.categoriaId, e);
  }

  return [...mapa.entries()]
    .map(([id, e]) => ({
      categoria: nombre.get(id) ?? "(sin grupo)",
      presupuesto: e.presupuesto,
      real: e.real,
      desviacion: e.real - e.presupuesto,
      ejecucion: e.presupuesto > 0 ? (e.real / e.presupuesto) * 100 : 0,
      _orden: orden.get(id) ?? 999,
    }))
    .sort((a, b) => a._orden - b._orden)
    .map(({ _orden, ...f }) => f);
}

/** Meses (1–12) con movimientos del tipo dado, ascendente. */
export async function aniosConMovimiento(tipo: TipoMovimiento): Promise<number[]> {
  const grupos = await prisma.movimientoFlujo.groupBy({ by: ["anio"], where: { tipo }, _count: { _all: true } });
  return grupos.map((g) => g.anio).sort((a, b) => a - b);
}

export async function mesesConMovimiento(anio: number, tipo: TipoMovimiento): Promise<number[]> {
  const grupos = await prisma.movimientoFlujo.groupBy({ by: ["mes"], where: { anio, tipo }, _count: { _all: true } });
  return grupos.map((g) => g.mes).sort((a, b) => a - b);
}

/** Nombres de terceros internos / partes relacionadas (p.ej. la propia BioSteel). */
export async function nombresInternos(): Promise<string[]> {
  const t = await prisma.tercero.findMany({ where: { esInterno: true }, select: { nombre: true } });
  return t.map((x) => x.nombre);
}

/** Categorías (grupos) para filtros. */
export function listarCategorias() {
  return prisma.categoriaFlujo.findMany({ select: { id: true, nombre: true }, orderBy: { orden: "asc" } });
}

/** Categorías de un tipo (para el selector de reclasificación). */
export function categoriasPorTipo(tipo: TipoMovimiento) {
  return prisma.categoriaFlujo.findMany({
    where: { tipo, activo: true },
    select: { id: true, nombre: true },
    orderBy: { orden: "asc" },
  });
}
