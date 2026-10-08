// ==========================================================
// Importador de NÓMINA (Gestión Humana) — costo de personal por empleado y
// año, para /nomina y /nomina/empleados.
//
// El libro trae una hoja por año llamada "SALARIOS <año>" (p. ej. "SALARIOS
// 2025", "SALARIOS 2026"); el año sale del NOMBRE DE LA HOJA, no de una
// columna. Cada fila se guarda por (año, cédula): volver a cargar el mismo
// año actualiza a los empleados que ya estaban y agrega los nuevos, pero no
// borra a quien ya no aparezca en el archivo — igual que hacía el script de
// consola prisma/set-nomina.ts, que este módulo reemplaza sin cambiarle el
// comportamiento (para dar de baja a alguien hay que hacerlo aparte).
// ==========================================================
import "server-only";
import * as XLSX from "xlsx";

// Columnas del Excel por posición (encabezado en la fila 1):
// 0 AÑO · 1 N° · 2 CEDULA · 3 NOMBRES · 4 PROCESO · 5 CARGO · 6 EMPRESA ·
// 7 CIUDAD · 8 BASE SALARIAL · 9 AUX TRANSPORTE · 10 NO PRESTACIONAL ·
// 11 TOTAL DEVENGADO · 12 SALUD · 13 PENSION · 14 ARL · 15 SENA · 16 ICBF ·
// 17 CAJA · 18 SEGURIDAD SOCIAL · 19 CESANTIAS · 20 INT CESANTIAS · 21 PRIMA ·
// 22 VACACIONES · 23 PRESTACIONES SOCIALES · 24 TOTAL · 25 TIPO DE CONTRATO ·
// 26 FECHA INGRESO · 27 FECHA RETIRO ("No aplica" = sigue activo)
const C = {
  cedula: 2, nombre: 3, proceso: 4, cargo: 5, empresa: 6, ciudad: 7,
  base: 8, aux: 9, noPrest: 10, totalDev: 11, segSocial: 18,
  prestaciones: 23, total: 24, contrato: 25, ingreso: 26, retiro: 27,
} as const;

const txt = (v: unknown): string => (v == null ? "" : String(v).trim());

/** Número tolerante: acepta number, "1.234.567,89" o vacío → 0. */
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return 0;
    return Number(s.replace(/\./g, "").replace(",", ".")) || 0;
  }
  return 0;
}

/**
 * Fecha del Excel → Date (día calendario, medianoche UTC) o null.
 * Llega como serial de Excel, texto ISO / dd-mm-aaaa, o "No aplica". Se usa la
 * parte entera del serial: la hora residual (":00:16") no cuenta.
 */
export function fechaExcel(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 1) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000);
  }
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
  return null; // "No aplica", vacío…
}

export interface FilaNomina {
  anio: number; cedula: string; nombre: string; proceso: string; cargo: string;
  empresa: string; ciudad: string;
  baseSalarial: number; auxTransporte: number; noPrestacional: number;
  totalDevengado: number; seguridadSocial: number; prestaciones: number;
  total: number; tipoContrato: string;
  fechaIngreso: Date | null; fechaRetiro: Date | null;
}

export interface HojaNomina {
  hoja: string; anio: number; empleados: number; omitidas: number; costoMensual: number;
}

export interface NominaParsed {
  datos: FilaNomina[];
  hojas: HojaNomina[];
  /** Hojas sin un año (aaaa) reconocible en el nombre; se omiten enteras. */
  hojasOmitidas: string[];
}

export function parseNomina(buffer: Buffer): NominaParsed {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const datos: FilaNomina[] = [];
  const hojas: HojaNomina[] = [];
  const hojasOmitidas: string[] = [];

  for (const hoja of wb.SheetNames) {
    const m = hoja.match(/(\d{4})/); // "SALARIOS 2025" → 2025
    if (!m) { hojasOmitidas.push(hoja); continue; }
    const anio = Number(m[1]);

    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[hoja]!, { header: 1, raw: true, defval: null });
    let empleados = 0, omitidas = 0, costoMensual = 0;
    const vistos = new Set<string>(); // cédulas ya leídas esta hoja (evita choques de upsert)

    for (let i = 1; i < rows.length; i++) { // fila 0 = encabezado
      const r = rows[i]; if (!r) continue;
      const cedula = txt(r[C.cedula]);
      const nombre = txt(r[C.nombre]);

      // Filas placeholder/plantilla: sin cédula o el marcador "PEDRO PEREZ".
      if (!cedula || /^pedro perez$/i.test(nombre)) { omitidas++; continue; }
      // Solo BioSteel: el Excel trae también empleados de otras empresas.
      if (txt(r[C.empresa]).toUpperCase() !== "BIOSTEEL") { omitidas++; continue; }
      if (vistos.has(cedula)) { omitidas++; continue; }
      vistos.add(cedula);

      const total = num(r[C.total]);
      datos.push({
        anio, cedula, nombre,
        proceso: txt(r[C.proceso]), cargo: txt(r[C.cargo]),
        empresa: txt(r[C.empresa]).toUpperCase(), ciudad: txt(r[C.ciudad]).toUpperCase(),
        baseSalarial: num(r[C.base]), auxTransporte: num(r[C.aux]),
        noPrestacional: num(r[C.noPrest]), totalDevengado: num(r[C.totalDev]),
        seguridadSocial: num(r[C.segSocial]), prestaciones: num(r[C.prestaciones]),
        total, tipoContrato: txt(r[C.contrato]) || "N/D",
        fechaIngreso: fechaExcel(r[C.ingreso]), fechaRetiro: fechaExcel(r[C.retiro]),
      });
      empleados++;
      costoMensual += total;
    }

    hojas.push({ hoja, anio, empleados, omitidas, costoMensual });
  }

  if (!datos.length) {
    throw new Error(
      'No se encontró ningún empleado válido: revisa que las hojas se llamen "SALARIOS <año>" (p. ej. "SALARIOS 2026") ' +
      'y que la columna EMPRESA diga BIOSTEEL.',
    );
  }

  return { datos, hojas, hojasOmitidas };
}

/**
 * Guarda por (año, cédula): upsert, nunca borra. Un empleado que ya no
 * aparezca en el archivo se queda con su último dato cargado — igual que
 * hacía el script de consola, que este módulo reemplaza.
 */
export async function persistirNomina(p: NominaParsed): Promise<number> {
  const { prisma } = await import("@/lib/db");
  const { Prisma } = await import("@prisma/client");
  const dec = (v: number) => new Prisma.Decimal(Math.round(v * 100) / 100);

  let n = 0;
  for (const f of p.datos) {
    const data = {
      nombre: f.nombre, proceso: f.proceso, cargo: f.cargo,
      empresa: f.empresa, ciudad: f.ciudad,
      baseSalarial: dec(f.baseSalarial), auxTransporte: dec(f.auxTransporte),
      noPrestacional: dec(f.noPrestacional), totalDevengado: dec(f.totalDevengado),
      seguridadSocial: dec(f.seguridadSocial), prestaciones: dec(f.prestaciones),
      total: dec(f.total), tipoContrato: f.tipoContrato,
      fechaIngreso: f.fechaIngreso, fechaRetiro: f.fechaRetiro,
    };
    await prisma.nomina.upsert({
      where: { anio_cedula: { anio: f.anio, cedula: f.cedula } },
      update: data,
      create: { anio: f.anio, cedula: f.cedula, ...data },
    });
    n++;
  }
  return n;
}
