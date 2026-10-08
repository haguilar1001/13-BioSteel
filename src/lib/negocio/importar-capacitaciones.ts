// ==========================================================
// Importador del CONSOLIDADO DE CAPACITACIONES (Gestión Humana).
//
// El libro trae una hoja por capacitación con el cuestionario crudo y una
// hoja GENERAL que las resume: mes, capacitación, colaborador, evaluación
// pre, evaluación post y % final. La app lee GENERAL, que es el consolidado
// que Gestión Humana revisa y firma; las hojas de detalle son el soporte.
//
// La hoja CRONOGRAMA (FOR-GH-031) trae el DETALLE de cada capacitación: día,
// objetivo, a quién va dirigida, quién la dicta, modalidad, estado, evaluados y
// promedios — incluidas las programadas que aún no tienen evaluaciones. Es
// opcional: si el libro no la trae, solo se carga el consolidado.
//
// El semestre no trae año en ninguna columna (la hoja habla de "Enero",
// "Febrero"…), así que se toma del nombre del archivo ("… I SEMESTRE 2026")
// y, si no aparece, del año en curso.
//
// El % final llega como fracción (0,938) o como porcentaje (93,8) según cómo
// se haya guardado el Excel; se normaliza a 0–100 sin recalcularlo, para que
// la app muestre exactamente lo que dice el consolidado.
// ==========================================================
import "server-only";
import * as XLSX from "xlsx";

const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

export interface FilaCapacitacion {
  anio: number; mes: number;
  capacitacion: string; colaborador: string;
  pre: number; post: number; final: number;
  observaciones: string;
}

/** Una fila de la hoja CRONOGRAMA. Los promedios van en 0–100; null = sin evaluar. */
export interface FilaCronograma {
  anio: number; mes: number; dia: number | null;
  capacitacion: string; objetivo: string; dirigidoA: string; dirigidoPor: string;
  modalidad: string; estado: string; evaluados: number;
  promedioPre: number | null; promedioPost: number | null; promedioFinal: number | null;
  observaciones: string;
}

export interface CapacitacionesParsed {
  hoja: string;
  /** Detalle por capacitación (hoja CRONOGRAMA); vacío si el libro no la trae. */
  cronograma: FilaCronograma[];
  /** Filas leídas del archivo, incluidas las que se descartan. */
  filas: number;
  datos: FilaCapacitacion[];
  /** Periodos "aaaa-mm" presentes, ordenados. */
  periodos: string[];
  /** Filas sin mes reconocible o sin colaborador. */
  omitidas: number;
  /** Capacitaciones distintas del archivo. */
  capacitaciones: number;
}

const txt = (v: unknown): string => (v == null ? "" : String(v).trim());

/** Número tolerante a "87,5", "87.5%" y a los espacios del export. */
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = txt(v).replace(/\s/g, "");
  if (!s) return 0;
  const limpio = s.replace(/[^0-9.,-]/g, "");
  // "1.234,5" (es-CO) vs "1234.5": manda la última coma si la hay.
  const n = Number(limpio.includes(",") ? limpio.replace(/\./g, "").replace(",", ".") : limpio);
  return Number.isFinite(n) ? n : 0;
}

/**
 * El % final se guarda unas veces como 0,938 y otras como 93,8. Se decide por
 * el valor: nadie saca 0,9 % en una evaluación, y nadie saca 938 %.
 */
function aPorcentaje(v: unknown): number {
  const n = num(v);
  return n > 0 && n <= 1.0001 ? n * 100 : n;
}

/** Nombre propio prolijo: "MARIA ANGELICA" → "Maria Angelica". */
function titulo(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-.])([\p{L}])/gu, (_, sep, c) => sep + c.toUpperCase()).trim();
}

/** Año del nombre del archivo ("… I SEMESTRE 2026.xlsx"). */
export function anioDeNombre(nombre: string, porDefecto: number): number {
  const m = nombre.match(/(20\d{2})/);
  return m ? Number(m[1]) : porDefecto;
}

/** Promedio opcional: celda vacía → null (no es lo mismo que 0 puntos). */
function promedioOpc(v: unknown): number | null {
  return txt(v) === "" ? null : aPorcentaje(v);
}

/** Lee la hoja CRONOGRAMA; si no existe, devuelve []. */
function parseCronograma(wb: XLSX.WorkBook, anio: number): FilaCronograma[] {
  const hoja = wb.SheetNames.find((n) => n.trim().toUpperCase() === "CRONOGRAMA");
  if (!hoja) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[hoja]!, { header: 1, raw: true, blankrows: false });
  // El encabezado no está en la primera fila (hay título y notas encima).
  const hIdx = rows.findIndex((r) => {
    const h = (r ?? []).map((x) => txt(x).toUpperCase());
    return h.includes("MES") && h.some((x) => x.startsWith("CAPACITACI"));
  });
  if (hIdx < 0) return [];
  const H = (rows[hIdx] ?? []).map((h) => txt(h).toUpperCase());
  const col = (...alias: string[]) => H.findIndex((h) => alias.some((a) => h.startsWith(a)));
  const iMes = col("MES"), iDia = col("DIA", "DÍA"), iCap = col("CAPACITACI"), iObj = col("OBJETIVO");
  const iPara = col("DIRIGIDO A"), iPor = col("DIRIGIDO POR"), iMod = col("MODALIDAD"), iEst = col("ESTADO");
  const iEv = col("EVALUADOS"), iPre = col("PROMEDIO PRE"), iPost = col("PROMEDIO POST"), iFin = col("PROMEDIO FINAL");
  const iObs = col("OBSERVACI");

  const out: FilaCronograma[] = [];
  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    const mes = MESES.indexOf(txt(r[iMes]).toUpperCase()) + 1;
    const capacitacion = txt(r[iCap]);
    if (!mes || !capacitacion) continue; // filas en blanco o de relleno
    const dia = iDia >= 0 ? Math.round(num(r[iDia])) : 0;
    out.push({
      anio, mes, dia: dia >= 1 && dia <= 31 ? dia : null,
      capacitacion: titulo(capacitacion),
      objetivo: iObj >= 0 ? txt(r[iObj]) : "",
      dirigidoA: iPara >= 0 ? txt(r[iPara]) : "",
      dirigidoPor: iPor >= 0 ? txt(r[iPor]) : "",
      modalidad: iMod >= 0 ? txt(r[iMod]) : "",
      estado: iEst >= 0 ? txt(r[iEst]) : "",
      evaluados: iEv >= 0 ? Math.round(num(r[iEv])) : 0,
      promedioPre: iPre >= 0 ? promedioOpc(r[iPre]) : null,
      promedioPost: iPost >= 0 ? promedioOpc(r[iPost]) : null,
      promedioFinal: iFin >= 0 ? promedioOpc(r[iFin]) : null,
      observaciones: iObs >= 0 ? txt(r[iObs]) : "",
    });
  }
  return out;
}

export function parseCapacitaciones(buffer: Buffer, nombre: string, anioPorDefecto = new Date().getUTCFullYear()): CapacitacionesParsed {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const hoja = wb.SheetNames.find((n) => n.trim().toUpperCase() === "GENERAL");
  if (!hoja) {
    throw new Error('El archivo no tiene la hoja "GENERAL", que es la que trae el consolidado (mes, capacitación, colaborador, pre, post y % final).');
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[hoja]!, { header: 1, raw: true, blankrows: false });
  const H = (rows[0] ?? []).map((h) => txt(h).toUpperCase());
  const col = (...alias: string[]) => H.findIndex((h) => alias.some((a) => h.includes(a)));

  const iMes = col("MES");
  const iCap = col("CAPACITACI");
  const iCol = col("COLABORADOR");
  const iPre = col("PRE-EVALUACI", "PRE EVALUACI");
  const iPost = col("POST-EVALUACI", "POST EVALUACI");
  const iFinal = col("PORCENTAJE FINAL", "% FINAL");
  const iObs = col("OBSERVACI");
  if (iMes < 0 || iCap < 0 || iCol < 0) {
    throw new Error('La hoja "GENERAL" no tiene las columnas MES, CAPACITACIÓN y COLABORADOR.');
  }

  const anio = anioDeNombre(nombre, anioPorDefecto);
  const datos: FilaCapacitacion[] = [];
  const periodos = new Set<string>();
  const capacitaciones = new Set<string>();
  let leidas = 0, omitidas = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;
    const colaborador = txt(r[iCol]);
    const capacitacion = txt(r[iCap]);
    if (!colaborador && !capacitacion) continue; // fila en blanco, no cuenta
    leidas++;
    const mes = MESES.indexOf(txt(r[iMes]).toUpperCase()) + 1;
    if (!mes || !colaborador || !capacitacion) { omitidas++; continue; }

    const pre = aPorcentaje(r[iPre]);
    const post = aPorcentaje(r[iPost]);
    const final = iFinal >= 0 ? aPorcentaje(r[iFinal]) : (pre + post) / 2;

    datos.push({
      anio, mes,
      capacitacion: titulo(capacitacion),
      colaborador: titulo(colaborador),
      pre, post, final,
      observaciones: iObs >= 0 ? txt(r[iObs]) : "",
    });
    periodos.add(`${anio}-${String(mes).padStart(2, "0")}`);
    capacitaciones.add(titulo(capacitacion));
  }

  if (!datos.length) throw new Error('La hoja "GENERAL" no trae ninguna fila con mes, capacitación y colaborador.');

  return {
    hoja, filas: leidas, datos, omitidas,
    cronograma: parseCronograma(wb, anio),
    periodos: [...periodos].sort(),
    capacitaciones: capacitaciones.size,
  };
}

/**
 * Reemplaza los periodos que trae el archivo. El consolidado se vuelve a
 * exportar cada vez que se cierra una capacitación, así que el mismo mes
 * llega varias veces y hay que sobrescribirlo entero, no acumular.
 */
export async function persistirCapacitaciones(p: CapacitacionesParsed): Promise<number> {
  const { prisma } = await import("@/lib/db");
  for (const periodo of p.periodos) {
    const [anio, mes] = periodo.split("-").map(Number) as [number, number];
    await prisma.capacitacion.deleteMany({ where: { anio, mes } });
  }
  // skipDuplicates: el consolidado repite al mismo colaborador en la misma
  // capacitación cuando presentó la evaluación dos veces; manda la primera.
  const res = await prisma.capacitacion.createMany({ data: p.datos, skipDuplicates: true });
  await persistirCronograma(p);
  return res.count;
}

/**
 * Reemplaza el cronograma del año: la hoja trae el año completo (ejecutadas Y
 * programadas), así que se sobrescribe entero, no se acumula. Sin hoja
 * CRONOGRAMA en el archivo no se toca lo ya cargado.
 */
export async function persistirCronograma(p: CapacitacionesParsed): Promise<number> {
  if (!p.cronograma.length) return 0;
  const { prisma } = await import("@/lib/db");
  const anios = [...new Set(p.cronograma.map((c) => c.anio))];
  await prisma.capacitacionCronograma.deleteMany({ where: { anio: { in: anios } } });
  const res = await prisma.capacitacionCronograma.createMany({ data: p.cronograma, skipDuplicates: true });
  return res.count;
}
