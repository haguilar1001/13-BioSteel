// ==========================================================
// Helper para exportar un listado a Excel (.xlsx) como descarga.
// Lo usan las rutas /flujo/export, /cartera/export y /cxp/export.
// Para los tableros de indicadores, que llevan varias tablas en un mismo
// libro, está `libroMultiDescarga` (una hoja por tabla).
// ==========================================================
import "server-only";
import * as XLSX from "xlsx";

/** Nombre de hoja válido en Excel: ≤ 31 caracteres y sin : \ / ? * [ ]. */
function nombreHoja(s: string): string {
  return s.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Hoja";
}

function responseXlsx(wb: XLSX.WorkBook, archivo: string): Response {
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${archivo}"`,
      "Cache-Control": "no-store",
    },
  });
}

export function libroDescarga(opts: {
  hoja: string;
  encabezado: string[];
  filas: (string | number)[][];
  archivo: string;
  anchos?: number[];
}): Response {
  const ws = XLSX.utils.aoa_to_sheet([opts.encabezado, ...opts.filas]);
  if (opts.anchos) ws["!cols"] = opts.anchos.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, nombreHoja(opts.hoja));
  return responseXlsx(wb, opts.archivo);
}

export interface HojaExport {
  nombre: string;
  encabezado: string[];
  filas: (string | number)[][];
  anchos?: number[];
}

/**
 * Libro con varias hojas, una por tabla del tablero. Las hojas vacías se
 * omiten salvo que sea la única (Excel exige al menos una). Los nombres se
 * sanean y se hacen únicos (…, " (2)") para no chocar.
 */
export function libroMultiDescarga(opts: { hojas: HojaExport[]; archivo: string }): Response {
  const wb = XLSX.utils.book_new();
  const usados = new Set<string>();
  const conDatos = opts.hojas.filter((h) => h.filas.length > 0);
  const hojas = conDatos.length ? conDatos : opts.hojas.slice(0, 1);

  for (const h of hojas) {
    const ws = XLSX.utils.aoa_to_sheet([h.encabezado, ...h.filas]);
    if (h.anchos) ws["!cols"] = h.anchos.map((wch) => ({ wch }));
    let nombre = nombreHoja(h.nombre);
    for (let i = 2; usados.has(nombre.toLowerCase()); i++) {
      nombre = nombreHoja(`${h.nombre.slice(0, 27)} (${i})`);
    }
    usados.add(nombre.toLowerCase());
    XLSX.utils.book_append_sheet(wb, ws, nombre);
  }
  return responseXlsx(wb, opts.archivo);
}
