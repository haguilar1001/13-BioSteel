// ==========================================================
// Indicador de Almacén — % de cumplimiento de especificaciones técnicas.
//
//   % cumplimiento = N.° evaluaciones aceptadas / N.° evaluaciones realizadas
//
// Sale directo de Recepción Técnica (FOR-ALM-005 / FOR-ALM-008): cada
// recepción registrada ES una evaluación, y su resultado es exactamente uno
// de cuatro valores fijados por el formulario (ver recepcion.ts):
//   "Aceptado" · "Aceptado con observaciones" · "Cuarentena" · "Rechazado"
//
// "Aceptado con observaciones" cuenta como ACEPTADA: el PRO-DT-005 §7.4 lo
// trata igual que "Aceptado" (mismo lote conforme, se libera y se almacena
// aprobado) — lo único que cambia es que la observación queda escrita en el
// ítem, no en la disposición del lote. "Cuarentena" y "Rechazado" no cumplen.
//
// No se carga por Excel: se calcula en vivo sobre lo que ya está registrado
// en la app, así que no hay "meses sin diligenciar" — un mes sin recepciones
// es un mes sin evaluaciones, y así se muestra.
// ==========================================================
import "server-only";
import { prisma } from "@/lib/db";
import type { TipoRecepcion } from "@prisma/client";
import { tipoRecepcionLabel } from "./recepcion";

/** Resultados que el procedimiento trata como lote conforme. */
const ACEPTABLES = new Set(["Aceptado", "Aceptado con observaciones"]);

export const MES_CORTO = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export const MES_LARGO = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** Meta institucional de cumplimiento (ajustable si Calidad define otra). */
export const META = 95;

export interface FilaMesAceptacion { mes: number; aceptadas: number; evaluadas: number; pct: number | null }
export interface FilaTipoAceptacion { tipo: TipoRecepcion; label: string; aceptadas: number; evaluadas: number; pct: number | null }
export interface FilaResultado { resultado: string; n: number }

export interface ResumenAceptacion {
  aceptadas: number;
  evaluadas: number;
  pct: number | null;
  /** 12 posiciones (enero..diciembre); evaluadas = 0 en los meses sin recepciones. */
  meses: FilaMesAceptacion[];
  /** Meses con al menos una evaluación, para no pintar una línea en cero antes de que empiece el año. */
  conDato: number[];
  porTipo: FilaTipoAceptacion[];
  porResultado: FilaResultado[];
}

/** Años con al menos una recepción registrada (para el selector). */
export async function aniosConRecepciones(): Promise<number[]> {
  const filas = await prisma.$queryRaw<{ anio: number }[]>`
    SELECT DISTINCT EXTRACT(YEAR FROM "fechaInspeccion")::int AS anio
    FROM "RecepcionTecnica" ORDER BY 1`;
  return filas.map((f) => f.anio);
}

/** % de cumplimiento del año (opcionalmente acotado a un subconjunto de meses). */
export async function resumenAceptacion(anio: number, meses?: number[]): Promise<ResumenAceptacion> {
  const desde = new Date(Date.UTC(anio, 0, 1));
  const hasta = new Date(Date.UTC(anio + 1, 0, 1));
  const filas = await prisma.recepcionTecnica.findMany({
    where: { fechaInspeccion: { gte: desde, lt: hasta } },
    select: { fechaInspeccion: true, resultado: true, tipo: true },
  });

  const acota = meses && meses.length ? new Set(meses) : null;
  const evaluadas = filas.filter((f) => f.resultado && (!acota || acota.has(f.fechaInspeccion.getUTCMonth() + 1)));

  const porMes = new Map<number, { aceptadas: number; evaluadas: number }>();
  for (let m = 1; m <= 12; m++) porMes.set(m, { aceptadas: 0, evaluadas: 0 });
  const porTipoMap = new Map<TipoRecepcion, { aceptadas: number; evaluadas: number }>();
  const porResultadoMap = new Map<string, number>();

  for (const f of evaluadas) {
    const mes = f.fechaInspeccion.getUTCMonth() + 1;
    const acepta = ACEPTABLES.has(f.resultado);

    const em = porMes.get(mes)!;
    em.evaluadas++; if (acepta) em.aceptadas++;

    const et = porTipoMap.get(f.tipo) ?? { aceptadas: 0, evaluadas: 0 };
    et.evaluadas++; if (acepta) et.aceptadas++;
    porTipoMap.set(f.tipo, et);

    porResultadoMap.set(f.resultado, (porResultadoMap.get(f.resultado) ?? 0) + 1);
  }

  const aceptadas = evaluadas.filter((f) => ACEPTABLES.has(f.resultado)).length;
  const total = evaluadas.length;

  return {
    aceptadas, evaluadas: total,
    pct: total > 0 ? (aceptadas / total) * 100 : null,
    meses: Array.from({ length: 12 }, (_, i) => {
      const mes = i + 1;
      const e = porMes.get(mes)!;
      return { mes, aceptadas: e.aceptadas, evaluadas: e.evaluadas, pct: e.evaluadas > 0 ? (e.aceptadas / e.evaluadas) * 100 : null };
    }),
    conDato: [...porMes.entries()].filter(([, e]) => e.evaluadas > 0).map(([m]) => m),
    porTipo: (["importacion", "nacional"] as TipoRecepcion[]).map((tipo) => {
      const e = porTipoMap.get(tipo) ?? { aceptadas: 0, evaluadas: 0 };
      return { tipo, label: tipoRecepcionLabel(tipo), aceptadas: e.aceptadas, evaluadas: e.evaluadas, pct: e.evaluadas > 0 ? (e.aceptadas / e.evaluadas) * 100 : null };
    }),
    porResultado: [...porResultadoMap.entries()].map(([resultado, n]) => ({ resultado, n })).sort((a, b) => b.n - a.n),
  };
}
