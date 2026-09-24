// ==========================================================
// Lógica: Cirugías con asistencia técnica (volumen y cobertura de asesores).
// Replica las métricas del informe Power BI "Asistencia Técnica":
// Cirugías, Prom Día, Prom Mes, Promedio por médico, Asesores vs Sin Soporte,
// y desgloses por mes, asesor, IPS, ciudad, grupo y médico.
// ==========================================================
import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export interface FiltroCx { anio: number; mes?: number[]; dia?: number; ciudad?: string[]; grupo?: string[]; asesor?: string[] }

export const MES_CORTO = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export const MES_LARGO = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function where(f: FiltroCx): Prisma.CirugiaWhereInput {
  return {
    anio: f.anio,
    ...(f.mes?.length ? { mes: { in: f.mes } } : {}),
    // El día solo tiene sentido dentro de un único mes elegido.
    ...(f.mes?.length === 1 && f.dia ? { dia: f.dia } : {}),
    ...(f.ciudad?.length ? { ciudad: { in: f.ciudad } } : {}),
    ...(f.grupo?.length ? { grupo: { in: f.grupo } } : {}),
    ...(f.asesor?.length ? { asesor: { in: f.asesor } } : {}),
  };
}

export async function aniosConCirugias(): Promise<number[]> {
  const g = await prisma.cirugia.groupBy({ by: ["anio"], orderBy: { anio: "asc" } });
  return g.map((x) => x.anio);
}
export async function mesesConCirugias(anio: number): Promise<number[]> {
  const g = await prisma.cirugia.groupBy({ by: ["mes"], where: { anio }, orderBy: { mes: "asc" } });
  return g.map((x) => x.mes);
}
export async function diasConCirugias(anio: number, mes: number): Promise<number[]> {
  const g = await prisma.cirugia.groupBy({ by: ["dia"], where: { anio, mes }, orderBy: { dia: "asc" } });
  return g.map((x) => x.dia);
}

export interface ResumenCx {
  total: number; conAsesor: number; sinSoporte: number; coberturaPct: number;
  promDia: number; promMes: number; promMedico: number;
  dias: number; meses: number; medicos: number;
}
export async function resumenCx(f: FiltroCx): Promise<ResumenCx> {
  const w = where(f);
  const [total, sinSoporte, gDias, gMeses, gMed] = await Promise.all([
    prisma.cirugia.count({ where: w }),
    prisma.cirugia.count({ where: { ...w, sinSoporte: true } }),
    prisma.cirugia.groupBy({ by: ["anio", "mes", "dia"], where: w }),
    prisma.cirugia.groupBy({ by: ["anio", "mes"], where: w }),
    prisma.cirugia.groupBy({ by: ["medico"], where: { ...w, medico: { not: null } } }),
  ]);
  const dias = gDias.length, meses = gMeses.length, medicos = gMed.length;
  const conAsesor = total - sinSoporte;
  return {
    total, conAsesor, sinSoporte, coberturaPct: total ? conAsesor / total : 0,
    promDia: dias ? total / dias : 0, promMes: meses ? total / meses : 0,
    promMedico: medicos ? total / medicos : 0, dias, meses, medicos,
  };
}

export interface FilaMes { mes: number; total: number; conAsesor: number; sinSoporte: number }
export async function cirugiasPorMes(f: FiltroCx): Promise<FilaMes[]> {
  const w = where({ ...f, mes: undefined, dia: undefined });
  const [tot, sin] = await Promise.all([
    prisma.cirugia.groupBy({ by: ["mes"], where: w, _count: { _all: true } }),
    prisma.cirugia.groupBy({ by: ["mes"], where: { ...w, sinSoporte: true }, _count: { _all: true } }),
  ]);
  const sinMap = new Map(sin.map((x) => [x.mes, x._count._all]));
  return Array.from({ length: 12 }, (_, i) => i + 1).map((mes) => {
    const total = tot.find((x) => x.mes === mes)?._count._all ?? 0;
    const sinSoporte = sinMap.get(mes) ?? 0;
    return { mes, total, conAsesor: total - sinSoporte, sinSoporte };
  }).filter((r) => r.total > 0);
}

export interface FilaConteo { nombre: string; total: number }
export async function cirugiasPorAsesor(f: FiltroCx): Promise<FilaConteo[]> {
  const g = await prisma.cirugia.groupBy({ by: ["asesor"], where: { ...where(f), sinSoporte: false }, _count: { _all: true } });
  return g.map((x) => ({ nombre: x.asesor, total: x._count._all })).sort((a, b) => b.total - a.total);
}
/** Promedio de cirugías por día de cada asesor (total ÷ días que operó). */
export async function promedioDiaAsesor(f: FiltroCx): Promise<FilaConteo[]> {
  const g = await prisma.cirugia.groupBy({
    by: ["asesor", "anio", "mes", "dia"],
    where: { ...where(f), sinSoporte: false },
    _count: { _all: true },
  });
  const acc = new Map<string, { total: number; dias: number }>();
  for (const row of g) {
    const m = acc.get(row.asesor) ?? { total: 0, dias: 0 };
    m.total += row._count._all;
    m.dias += 1;
    acc.set(row.asesor, m);
  }
  return [...acc.entries()]
    .map(([nombre, m]) => ({ nombre, total: m.dias ? m.total / m.dias : 0 }))
    .sort((a, b) => b.total - a.total);
}

export async function cirugiasPorMedico(f: FiltroCx): Promise<FilaConteo[]> {
  const g = await prisma.cirugia.groupBy({ by: ["medico"], where: { ...where(f), medico: { not: null } }, _count: { _all: true } });
  return g.map((x) => ({ nombre: x.medico ?? "—", total: x._count._all })).sort((a, b) => b.total - a.total);
}

export interface FilaIpsCx { ips: string; ciudad: string | null; grupo: string | null; total: number; sinSoporte: number }
export async function cirugiasPorIps(f: FiltroCx): Promise<FilaIpsCx[]> {
  const w = where(f);
  const [tot, sin] = await Promise.all([
    prisma.cirugia.groupBy({ by: ["ips", "ciudad", "grupo"], where: w, _count: { _all: true } }),
    prisma.cirugia.groupBy({ by: ["ips"], where: { ...w, sinSoporte: true }, _count: { _all: true } }),
  ]);
  const sinMap = new Map(sin.map((x) => [x.ips, x._count._all]));
  return tot.map((x) => ({ ips: x.ips, ciudad: x.ciudad, grupo: x.grupo, total: x._count._all, sinSoporte: sinMap.get(x.ips) ?? 0 }))
    .sort((a, b) => b.total - a.total);
}
export async function cirugiasPorGrupo(f: FiltroCx): Promise<FilaConteo[]> {
  const g = await prisma.cirugia.groupBy({ by: ["grupo"], where: where(f), _count: { _all: true } });
  return g.map((x) => ({ nombre: x.grupo ?? "(sin grupo)", total: x._count._all })).sort((a, b) => b.total - a.total);
}
export async function cirugiasPorCiudad(f: FiltroCx): Promise<FilaConteo[]> {
  const g = await prisma.cirugia.groupBy({ by: ["ciudad"], where: where(f), _count: { _all: true } });
  return g.map((x) => ({ nombre: x.ciudad ?? "(sin ciudad)", total: x._count._all })).sort((a, b) => b.total - a.total);
}

export interface CatalogosCx { ciudades: string[]; grupos: string[]; asesores: string[] }
export async function catalogosCx(anio: number): Promise<CatalogosCx> {
  const [c, g, a] = await Promise.all([
    prisma.cirugia.groupBy({ by: ["ciudad"], where: { anio, ciudad: { not: null } }, orderBy: { ciudad: "asc" } }),
    prisma.cirugia.groupBy({ by: ["grupo"], where: { anio, grupo: { not: null } }, orderBy: { grupo: "asc" } }),
    prisma.cirugia.groupBy({ by: ["asesor"], where: { anio, sinSoporte: false }, orderBy: { asesor: "asc" } }),
  ]);
  return {
    ciudades: c.map((x) => x.ciudad!).filter(Boolean),
    grupos: g.map((x) => x.grupo!).filter(Boolean),
    asesores: a.map((x) => x.asesor).filter(Boolean),
  };
}
