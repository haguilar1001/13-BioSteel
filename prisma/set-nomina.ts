// ==========================================================
// Importa la nómina (maestro por empleado y año) a la tabla Nomina.
//
// Fuente: "Nomina.xlsx", con una hoja por año llamada "SALARIOS <año>"
// (p. ej. "SALARIOS 2025", "SALARIOS 2026"). El Excel vive en el equipo
// local; este script se corre localmente contra la BD (DATABASE_URL apunta
// a Railway), igual que set-ventas/set-pyg/set-obligaciones.
//
// Uso:   npm run db:nomina
//        RUTA_NOMINA="D:/otra/carpeta/Nomina.xlsx" npm run db:nomina
// ==========================================================
import "./_env";
import { PrismaClient, Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import fs from "node:fs";

const prisma = new PrismaClient();

const RUTA = process.env.RUTA_NOMINA ?? "D:/Escritorio/Nomina.xlsx";

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

/** Número tolerante: acepta number, "1.234.567,89" o vacío → 0. */
function num(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return 0;
    // Formato es-CO: puntos de miles, coma decimal.
    return Number(s.replace(/\./g, "").replace(",", ".")) || 0;
  }
  return 0;
}

/**
 * Fecha del Excel → Date (día calendario, medianoche UTC) o null.
 * Llega como serial de Excel, como texto ISO/dd-mm-aaaa o como "No aplica".
 * Se lee la parte entera del serial: la hora residual (":00:16") no cuenta.
 */
function fecha(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  if (typeof v === "number") {
    if (!isFinite(v) || v < 1) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000);
  }
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
  return null; // "No aplica", vacío, etc.
}

function txt(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

const fmt = (v: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(Math.round(v));

async function main() {
  if (!fs.existsSync(RUTA)) {
    console.error(`❌ No se encontró el archivo: ${RUTA}`);
    console.error(`   Ajusta la ruta con RUTA_NOMINA="..." npm run db:nomina`);
    process.exit(1);
  }

  console.log(`📗 Leyendo nómina desde: ${RUTA}`);
  const wb = XLSX.readFile(RUTA);
  const dec = (v: number) => new Prisma.Decimal(Math.round(v * 100) / 100);

  // Limpieza: la nómina solo debe tener empleados de BioSteel.
  const borrados = await prisma.nomina.deleteMany({ where: { NOT: { empresa: "BIOSTEEL" } } });
  if (borrados.count > 0) console.log(`   🧹 Eliminados ${borrados.count} registros de otras empresas.`);

  let totalFilas = 0;

  for (const hoja of wb.SheetNames) {
    const m = hoja.match(/(\d{4})/); // "SALARIOS 2025" → 2025
    if (!m) { console.log(`   ⏭  Hoja "${hoja}" sin año en el nombre; se omite.`); continue; }
    const anio = Number(m[1]);

    const ws = wb.Sheets[hoja]!;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });

    let n = 0, saltadas = 0, sumaTotal = 0, conRetiro = 0;
    const vistos = new Set<string>(); // cédulas ya cargadas este año (evita choques de upsert)

    for (let i = 1; i < rows.length; i++) { // fila 0 = encabezado
      const r = rows[i]!;
      const cedula = txt(r[C.cedula]);
      const nombre = txt(r[C.nombre]);

      // Filas placeholder/plantilla: sin cédula o el marcador "PEDRO PEREZ".
      if (!cedula || /^pedro perez$/i.test(nombre)) { saltadas++; continue; }
      // Solo BioSteel: el Excel traía empleados de otras empresas por error.
      if (txt(r[C.empresa]).toUpperCase() !== "BIOSTEEL") { saltadas++; continue; }
      if (vistos.has(cedula)) { saltadas++; continue; }
      vistos.add(cedula);

      const total = num(r[C.total]);
      const data = {
        nombre,
        proceso: txt(r[C.proceso]),
        cargo: txt(r[C.cargo]),
        empresa: txt(r[C.empresa]).toUpperCase(),
        ciudad: txt(r[C.ciudad]).toUpperCase(),
        baseSalarial: dec(num(r[C.base])),
        auxTransporte: dec(num(r[C.aux])),
        noPrestacional: dec(num(r[C.noPrest])),
        totalDevengado: dec(num(r[C.totalDev])),
        seguridadSocial: dec(num(r[C.segSocial])),
        prestaciones: dec(num(r[C.prestaciones])),
        total: dec(total),
        tipoContrato: txt(r[C.contrato]) || "N/D",
        fechaIngreso: fecha(r[C.ingreso]),
        fechaRetiro: fecha(r[C.retiro]),
      };

      await prisma.nomina.upsert({
        where: { anio_cedula: { anio, cedula } },
        update: data,
        create: { anio, cedula, ...data },
      });
      n++;
      if (data.fechaRetiro) conRetiro++;
      sumaTotal += total;
    }

    totalFilas += n;
    console.log(`   ✅ ${hoja}: ${n} empleados · costo mensual ${fmt(sumaTotal)} · costo anual ~${fmt(sumaTotal * 12)} (${conRetiro} con fecha de retiro, ${saltadas} filas omitidas)`);
  }

  console.log(`✅ Nómina importada (${totalFilas} registros).`);
}

main()
  .catch((e) => { console.error("❌ Error importando nómina:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
