// ==========================================================
// Nómina (fuente: maestro por empleado y año — ver set-nomina.ts).
//   Nomina = un registro por empleado × año.
//   `total` = costo mensual cargado (salario + aportes patronales + provisiones).
//
// TIEMPO ACTIVO (columnas FECHA INGRESO / FECHA RETIRO del Excel):
//   · El costo del año de cada persona = total mensual × meses que estuvo
//     activa ese año. Un retirado en marzo cuenta ~2,9 meses; quien ingresa en
//     septiembre cuenta 4 meses. Así el Resumen incluye a los retirados por el
//     tiempo que costaron, y no se infla con quien ya no está.
//   · La fecha de retiro puede ser FUTURA (fin de contrato a término fijo): no
//     recorta el año hasta que llega, y la persona sigue "activa" hasta ese día.
//   · En la lista de Empleados se muestra solo el personal ACTIVO hoy.
// ==========================================================
import "server-only";
import { prisma } from "@/lib/db";

/** Años con nómina cargada, ascendente. */
export async function aniosConNomina(): Promise<number[]> {
  const grupos = await prisma.nomina.groupBy({ by: ["anio"], _count: true });
  return grupos.map((g) => g.anio).sort((a, b) => a - b);
}

const DIA_MS = 86_400_000;

/** Hoy como día calendario (medianoche UTC) en hora de Colombia. */
export function hoyColombia(): Date {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [y, m, d] = p.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/** ¿Sigue activo en `hoy`? Sin retiro, o con un retiro que todavía no llega. */
export function estaActivo(retiro: Date | null, hoy: Date): boolean {
  return retiro == null || retiro.getTime() >= hoy.getTime();
}

/**
 * Meses (fraccionados por días de cada mes) que una persona estuvo activa en
 * `anio`. Sin ingreso se asume activa desde el 1.º de enero; sin retiro, hasta
 * el 31 de diciembre. Ambos extremos cuentan (inclusive).
 */
export function mesesActivos(anio: number, ingreso: Date | null, retiro: Date | null): number {
  let total = 0;
  for (let m = 0; m < 12; m++) {
    const ini = Date.UTC(anio, m, 1);
    const fin = Date.UTC(anio, m + 1, 0);
    const desde = Math.max(ini, ingreso ? ingreso.getTime() : ini);
    const hasta = Math.min(fin, retiro ? retiro.getTime() : fin);
    if (hasta < desde) continue;
    const diasMes = (fin - ini) / DIA_MS + 1;
    total += ((hasta - desde) / DIA_MS + 1) / diasMes;
  }
  return total;
}

interface FilaAnio {
  cedula: string;
  nombre: string;
  proceso: string;
  cargo: string;
  empresa: string;
  ciudad: string;
  baseSalarial: number;
  auxTransporte: number;
  seguridadSocial: number;
  prestaciones: number;
  total: number;
  tipoContrato: string;
  fechaIngreso: Date | null;
  fechaRetiro: Date | null;
  /** Meses activos en el año (0–12). */
  meses: number;
  /** ¿Sigue activo hoy? */
  activo: boolean;
}

/** Nómina del año con el tiempo activo de cada persona. Quien no estuvo activo ningún día del año se descarta. */
async function filasAnio(anio: number): Promise<FilaAnio[]> {
  const filas = await prisma.nomina.findMany({ where: { anio } });
  const hoy = hoyColombia();
  return filas
    .map((f) => ({
      cedula: f.cedula,
      nombre: f.nombre,
      proceso: f.proceso,
      cargo: f.cargo,
      empresa: f.empresa,
      ciudad: f.ciudad,
      baseSalarial: f.baseSalarial.toNumber(),
      auxTransporte: f.auxTransporte.toNumber(),
      seguridadSocial: f.seguridadSocial.toNumber(),
      prestaciones: f.prestaciones.toNumber(),
      total: f.total.toNumber(),
      tipoContrato: f.tipoContrato,
      fechaIngreso: f.fechaIngreso,
      fechaRetiro: f.fechaRetiro,
      meses: mesesActivos(anio, f.fechaIngreso, f.fechaRetiro),
      activo: estaActivo(f.fechaRetiro, hoy),
    }))
    .filter((f) => f.meses > 0);
}

export interface ResumenNomina {
  /** Personas que estuvieron activas en el año (incluye retirados). */
  headcount: number;
  /** De ellas, las que siguen activas hoy. */
  activos: number;
  retirados: number;
  costoAnual: number; // Σ total × meses activos
  costoMensual: number; // promedio mensual del año = costoAnual / 12
  baseSalarial: number; // promedio mensual, ponderado por tiempo activo
  auxTransporte: number;
  seguridadSocial: number;
  prestaciones: number;
  salarioPromedio: number; // base salarial promedio por persona
}

type Campo = "baseSalarial" | "auxTransporte" | "seguridadSocial" | "prestaciones" | "total";
const sumaPond = (fs: FilaAnio[], campo: Campo) => fs.reduce((s, f) => s + f[campo] * f.meses, 0);

/** KPIs del año, con el costo ponderado por el tiempo activo de cada persona. */
export async function resumenAnual(anio: number): Promise<ResumenNomina> {
  const fs = await filasAnio(anio);
  const headcount = fs.length;
  const activos = fs.filter((f) => f.activo).length;
  const costoAnual = sumaPond(fs, "total");
  return {
    headcount,
    activos,
    retirados: headcount - activos,
    costoAnual,
    costoMensual: costoAnual / 12,
    baseSalarial: sumaPond(fs, "baseSalarial") / 12,
    auxTransporte: sumaPond(fs, "auxTransporte") / 12,
    seguridadSocial: sumaPond(fs, "seguridadSocial") / 12,
    prestaciones: sumaPond(fs, "prestaciones") / 12,
    salarioPromedio: headcount > 0 ? fs.reduce((s, f) => s + f.baseSalarial, 0) / headcount : 0,
  };
}

export interface FilaGrupo {
  label: string;
  costoMensual: number;
  headcount: number;
}

/** Agrupa el costo mensual promedio y el headcount por una dimensión, desc. */
async function porDimension(anio: number, by: "empresa" | "proceso" | "ciudad" | "tipoContrato"): Promise<FilaGrupo[]> {
  const fs = await filasAnio(anio);
  const m = new Map<string, FilaGrupo>();
  for (const f of fs) {
    const label = f[by] || "N/D";
    const g = m.get(label) ?? { label, costoMensual: 0, headcount: 0 };
    g.costoMensual += (f.total * f.meses) / 12;
    g.headcount += 1;
    m.set(label, g);
  }
  return [...m.values()].sort((a, b) => b.costoMensual - a.costoMensual);
}

export const porEmpresa = (anio: number) => porDimension(anio, "empresa");
export const porProceso = (anio: number) => porDimension(anio, "proceso");
export const porCiudad = (anio: number) => porDimension(anio, "ciudad");
export const porTipoContrato = (anio: number) => porDimension(anio, "tipoContrato");

export interface ComposicionCosto {
  baseSalarial: number;
  auxTransporte: number;
  seguridadSocial: number;
  prestaciones: number;
}

/** Composición del costo mensual promedio: salario + auxilio + aportes patronales + provisiones. */
export async function composicionCosto(anio: number): Promise<ComposicionCosto> {
  const r = await resumenAnual(anio);
  return {
    baseSalarial: r.baseSalarial,
    auxTransporte: r.auxTransporte,
    seguridadSocial: r.seguridadSocial,
    prestaciones: r.prestaciones,
  };
}

export interface FilaComparativa { label: string; a: number; b: number }

/**
 * Compara el costo mensual por dimensión entre dos años (a = anioA, b = anioB).
 * Une las etiquetas presentes en cualquiera de los dos años.
 */
async function comparativo(anioA: number, anioB: number, by: "empresa" | "proceso"): Promise<FilaComparativa[]> {
  const [ga, gb] = await Promise.all([porDimension(anioA, by), porDimension(anioB, by)]);
  const map = new Map<string, { a: number; b: number }>();
  for (const g of ga) map.set(g.label, { a: g.costoMensual, b: 0 });
  for (const g of gb) map.set(g.label, { a: map.get(g.label)?.a ?? 0, b: g.costoMensual });
  return [...map.entries()]
    .map(([label, v]) => ({ label, a: v.a, b: v.b }))
    .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b));
}

export const comparativoEmpresa = (anioA: number, anioB: number) => comparativo(anioA, anioB, "empresa");
export const comparativoProceso = (anioA: number, anioB: number) => comparativo(anioA, anioB, "proceso");

export interface EmpleadoNomina {
  cedula: string;
  nombre: string;
  proceso: string;
  cargo: string;
  empresa: string;
  ciudad: string;
  baseSalarial: number;
  seguridadSocial: number;
  prestaciones: number;
  total: number;
  tipoContrato: string;
  fechaIngreso: Date | null;
  fechaRetiro: Date | null;
  activo: boolean;
}

export type EstadoEmpleado = "activos" | "retirados" | "todos";

/**
 * Listado detallado de empleados del año, con filtro opcional por texto y por
 * estado. Por defecto solo el personal ACTIVO hoy (sin retiro, o con retiro futuro).
 */
export async function empleados(anio: number, q?: string, estado: EstadoEmpleado = "activos"): Promise<EmpleadoNomina[]> {
  const term = q?.trim().toLowerCase();
  const fs = await filasAnio(anio);
  return fs
    .filter((f) => (estado === "todos" ? true : estado === "activos" ? f.activo : !f.activo))
    .filter((f) => !term || [f.nombre, f.cargo, f.proceso, f.empresa, f.ciudad].some((x) => x.toLowerCase().includes(term)) || f.cedula.includes(term))
    .sort((a, b) => b.total - a.total)
    .map((f) => ({
      cedula: f.cedula, nombre: f.nombre, proceso: f.proceso, cargo: f.cargo, empresa: f.empresa, ciudad: f.ciudad,
      baseSalarial: f.baseSalarial, seguridadSocial: f.seguridadSocial, prestaciones: f.prestaciones, total: f.total,
      tipoContrato: f.tipoContrato, fechaIngreso: f.fechaIngreso, fechaRetiro: f.fechaRetiro, activo: f.activo,
    }));
}
