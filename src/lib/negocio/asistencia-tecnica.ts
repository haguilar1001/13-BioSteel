// ==========================================================
// Asistencia Técnica — indicador de calidad sobre las evaluaciones de
// seguimiento a los asesores quirúrgicos dentro del procedimiento.
//
// METODOLOGÍA (viene del informe de Coordinación Logística):
//   · Se evalúan 7 ítems en escala 1–5.
//   · Los ítems 1–4 (Conocimiento, Desempeño, Capacidad de solución y
//     Habilidad) los califica el evaluador.
//   · Los ítems 5–7 (Novedades, Eventos e Incidentes adversos) son sí/no:
//     un "NO" vale 5 puntos.
//   · El promedio de cada ítem = suma de calificaciones ÷ Nº de evaluaciones.
//   · La calificación final = promedio de los 7 ítems. Meta institucional ≥ 4,5.
//
// Los agregados se calculan en memoria a propósito: son ~40 evaluaciones al
// mes y así la fórmula de los 7 ítems vive en un solo lugar y no repartida
// entre varias consultas SQL.
// ==========================================================
import "server-only";
import { prisma } from "@/lib/db";

export const META = 4.5;

/** Puntaje de un ítem sí/no cuando NO hubo novedad, evento ni incidente. */
export const PUNTAJE_SIN_NOVEDAD = 5;
/**
 * Puntaje cuando SÍ hubo novedad, evento o incidente adverso: el mínimo de la
 * escala. Criterio confirmado por Héctor el 2026-08-19 (el informe base solo
 * documentaba el "NO"). Hasta hoy no se ha registrado ningún caso.
 */
export const PUNTAJE_CON_NOVEDAD = 1;

export const ITEMS = [
  { clave: "conocimiento", label: "Conocimiento" },
  { clave: "desempeno", label: "Desempeño" },
  { clave: "capacidad", label: "Cap. de solución" },
  { clave: "habilidad", label: "Habilidad" },
  { clave: "novedades", label: "Novedades" },
  { clave: "eventos", label: "Eventos adversos" },
  { clave: "incidentes", label: "Incidentes adversos" },
] as const;

/** Los cuatro que califica el evaluador; los otros tres son sí/no. */
export const ITEMS_CALIFICADOS = ITEMS.slice(0, 4);

export const MES_CORTO = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export const MES_LARGO = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export interface Evaluacion {
  id: number; fecha: Date; anio: number; mes: number;
  paciente: string; procedimiento: string; ips: string;
  especialista: string; asesor: string;
  conocimiento: number; desempeno: number; capacidad: number; habilidad: number;
  novedades: boolean; eventos: boolean; incidentes: boolean;
}

/** Los 7 puntajes de una evaluación, en el orden de ITEMS. */
export function puntajes(e: Evaluacion): number[] {
  const sn = (hubo: boolean) => (hubo ? PUNTAJE_CON_NOVEDAD : PUNTAJE_SIN_NOVEDAD);
  return [e.conocimiento, e.desempeno, e.capacidad, e.habilidad,
    sn(e.novedades), sn(e.eventos), sn(e.incidentes)];
}

export interface Agregado {
  n: number;
  /** Promedio de cada uno de los 7 ítems. */
  items: number[];
  /** Promedio de los 7 ítems: la calificación final. */
  final: number;
  cumpleMeta: boolean;
}

/** Promedia un grupo de evaluaciones según la metodología. */
export function agregar(evs: Evaluacion[]): Agregado {
  const n = evs.length;
  if (!n) return { n: 0, items: ITEMS.map(() => 0), final: 0, cumpleMeta: false };
  const sumas = ITEMS.map(() => 0);
  for (const e of evs) {
    const p = puntajes(e);
    for (let i = 0; i < sumas.length; i++) sumas[i]! += p[i]!;
  }
  const items = sumas.map((s) => s / n);
  const final = items.reduce((a, v) => a + v, 0) / items.length;
  return { n, items, final, cumpleMeta: final >= META };
}

const aEval = (r: {
  id: number; fecha: Date; anio: number; mes: number;
  paciente: string; procedimiento: string; ips: string;
  especialista: string; asesor: string;
  conocimiento: unknown; desempeno: unknown; capacidad: unknown; habilidad: unknown;
  novedades: boolean; eventos: boolean; incidentes: boolean;
}): Evaluacion => ({
  ...r,
  conocimiento: Number(r.conocimiento), desempeno: Number(r.desempeno),
  capacidad: Number(r.capacidad), habilidad: Number(r.habilidad),
});

/** Años con evaluaciones cargadas. */
export async function aniosConEvaluaciones(): Promise<number[]> {
  const filas = await prisma.evaluacionAsesor.groupBy({ by: ["anio"], orderBy: { anio: "asc" } });
  return filas.map((f) => f.anio);
}

/** Meses de un año con evaluaciones. */
export async function mesesConEvaluaciones(anio: number): Promise<number[]> {
  const filas = await prisma.evaluacionAsesor.groupBy({
    by: ["mes"], where: { anio }, orderBy: { mes: "asc" },
  });
  return filas.map((f) => f.mes);
}

/** Evaluaciones del periodo. `mes` sin valor = todo el año. */
export async function evaluaciones(anio: number, mes?: number, asesor?: string): Promise<Evaluacion[]> {
  const filas = await prisma.evaluacionAsesor.findMany({
    where: { anio, ...(mes ? { mes } : {}), ...(asesor ? { asesor } : {}) },
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
  });
  return filas.map(aEval);
}

export interface AgregadoMes extends Agregado { anio: number; mes: number }

/** Serie mes a mes del año, para ver la tendencia contra la meta. */
export function porMes(evs: Evaluacion[]): AgregadoMes[] {
  const grupos = new Map<number, Evaluacion[]>();
  for (const e of evs) {
    const g = grupos.get(e.mes) ?? [];
    g.push(e); grupos.set(e.mes, g);
  }
  return [...grupos.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([mes, g]) => ({ anio: g[0]!.anio, mes, ...agregar(g) }));
}

export interface AgregadoAsesor extends Agregado { asesor: string }

/** Calificación por asesor, del mejor al que menos. */
export function porAsesor(evs: Evaluacion[]): AgregadoAsesor[] {
  const grupos = new Map<string, Evaluacion[]>();
  for (const e of evs) {
    const g = grupos.get(e.asesor) ?? [];
    g.push(e); grupos.set(e.asesor, g);
  }
  return [...grupos.entries()]
    .map(([asesor, g]) => ({ asesor, ...agregar(g) }))
    .sort((a, b) => b.final - a.final);
}

/** Agrupación genérica por un campo de texto (IPS, especialista, procedimiento). */
export function porCampo(evs: Evaluacion[], campo: "ips" | "especialista" | "procedimiento"): (Agregado & { label: string })[] {
  const grupos = new Map<string, Evaluacion[]>();
  for (const e of evs) {
    const k = e[campo] || "(sin dato)";
    const g = grupos.get(k) ?? [];
    g.push(e); grupos.set(k, g);
  }
  return [...grupos.entries()]
    .map(([label, g]) => ({ label, ...agregar(g) }))
    .sort((a, b) => b.n - a.n);
}

/** Evaluaciones con alguna novedad, evento o incidente adverso. */
export function conAdversos(evs: Evaluacion[]): Evaluacion[] {
  return evs.filter((e) => e.novedades || e.eventos || e.incidentes);
}

export interface Pqrs { anio: number; mes: number; casos: number; observacion: string }

/** PQRS del periodo. Se lleva aparte: no sale de las evaluaciones. */
export async function pqrs(anio: number, mes?: number[]): Promise<Pqrs[]> {
  return prisma.pqrsMes.findMany({
    where: { anio, ...(mes?.length ? { mes: { in: mes } } : {}) },
    orderBy: { mes: "asc" },
    select: { anio: true, mes: true, casos: true, observacion: true },
  });
}
