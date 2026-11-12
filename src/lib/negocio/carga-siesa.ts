// ==========================================================
// Persistencia de la carga de S1ESA (módulo PENDIENTES) para el formulario.
// Estrategia por dataset (según cómo la auxiliar descarga de S1ESA):
//   · pendientes  → REEMPLAZO TOTAL (foto del día).
//   · gastos      → REEMPLAZA solo los MESES que trae el archivo (mes actual).
//   · facturacion → AGREGA solo documentos NUEVOS (no toca el histórico).
//   · anuladas    → AGREGA solo documentos NUEVOS.
//   · ventas      → AGREGA las fechas nuevas del archivo "2026" (reemplazo por
//                   fecha) y RECALCULA la venta neta sobre todo VentaDoc.
// El parseo vive en importar-siesa-pendientes.ts (compartido con el CLI).
// El CLI db:pendientes hace reemplazo total (carga inicial / reseteo).
// Se usa desde el registro unificado src/lib/negocio/cargas.ts (carga in-app).
// ==========================================================
import "server-only";
import { prisma } from "@/lib/db";
import { DATASETS, parseDataset, type DatasetKey } from "./importar-siesa-pendientes";
import { leerRenglones, cantidadesSospechosas, type FilaVenta } from "./importar-ventas";
import { CargaRequiereConfirmacion, esConfirmacionPendiente } from "./carga-confirmacion";
import { escribirAgregados, docABitVenta } from "./escribir-ventas";

export { DATASETS, type DatasetKey };

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface ResultadoDataset {
  titulo: string;
  archivo: string;
  hoja: string;
  filas: number;      // filas leídas del archivo
  cargadas: number;   // filas realmente escritas (nuevas o reemplazadas)
  omitidas: number;
  estrategia: string; // texto para el usuario
}
export interface ResultadoCarga { ok: boolean; datasets: Partial<Record<DatasetKey, ResultadoDataset>>; errores: string[]; }

const BATCH = 5000;

async function insertar(createMany: (data: unknown[]) => Promise<unknown>, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += BATCH) await createMany(rows.slice(i, i + BATCH));
}

interface Persistencia { cargadas: number; estrategia: string; }

async function persistir(clave: DatasetKey, rows: Record<string, unknown>[]): Promise<Persistencia> {
  if (clave === "pendientes") {
    await prisma.pedidoPendiente.deleteMany({});
    await insertar((d) => prisma.pedidoPendiente.createMany({ data: d as never }), rows);
    return { cargadas: rows.length, estrategia: "reemplazo total (foto del día)" };
  }

  if (clave === "gastos") {
    // Reemplaza solo los (año, mes) presentes en el archivo.
    const pares = new Map<string, { anio: number; mes: number }>();
    for (const r of rows) pares.set(`${r.anio}-${r.mes}`, { anio: r.anio as number, mes: r.mes as number });
    const meses = [...pares.values()];
    if (meses.length) await prisma.gastoDoc.deleteMany({ where: { OR: meses } });
    await insertar((d) => prisma.gastoDoc.createMany({ data: d as never }), rows);
    const etiqueta = meses.length <= 3 ? meses.map((m) => `${m.mes}/${m.anio}`).join(", ") : `${meses.length} meses`;
    return { cargadas: rows.length, estrategia: `reemplaza mes(es): ${etiqueta}` };
  }

  // facturacion / anuladas → agregar solo documentos nuevos (por Nro documento).
  if (clave === "facturacion") {
    const existentes = new Set((await prisma.facturacionDoc.findMany({ select: { nroDocumento: true } })).map((x) => x.nroDocumento));
    const nuevos = rows.filter((r) => !existentes.has(r.nroDocumento as string));
    await insertar((d) => prisma.facturacionDoc.createMany({ data: d as never }), nuevos);
    return { cargadas: nuevos.length, estrategia: `${nuevos.length} documento(s) nuevo(s)` };
  }
  const existentes = new Set((await prisma.facturaAnulada.findMany({ select: { nroDocumento: true } })).map((x) => x.nroDocumento));
  const nuevos = rows.filter((r) => !existentes.has(r.nroDocumento as string));
  await insertar((d) => prisma.facturaAnulada.createMany({ data: d as never }), nuevos);
  return { cargadas: nuevos.length, estrategia: `${nuevos.length} documento(s) nuevo(s)` };
}

// ventas → reemplaza los renglones de las FECHAS presentes en el archivo y
// recalcula la venta neta (VentaLinea/Cliente/Marca/Dia) desde TODO VentaDoc.
async function persistirVentas(filas: FilaVenta[]): Promise<Persistencia> {
  const fechas = [...new Map(filas.map((f) => [f.ms, new Date(f.ms)])).values()];
  if (fechas.length) await prisma.ventaDoc.deleteMany({ where: { fecha: { in: fechas } } });
  const docs = filas.map((f) => ({
    nro: f.nro, tipo: f.tipo, aprobada: f.aprobada, fecha: new Date(f.ms), anio: f.anio, mes: f.mes, dia: new Date(f.ms).getUTCDate(),
    ips: f.ips, suc: f.suc, bod: f.bod, notas: f.notas, conv: f.conv, proc: f.proc, linea: f.linea,
    subtotal: r2(f.subtotal), fbd: f.fbd ?? null, costo: r2(f.costo), cliente: f.cliente, nit: f.nit, marca: f.marca,
    referencia: f.referencia, cantidad: r2(f.cantidad), lista: f.lista,
  }));
  await insertar((d) => prisma.ventaDoc.createMany({ data: d as never }), docs);
  const todos = await prisma.ventaDoc.findMany();
  const res = await escribirAgregados(prisma, todos.map(docABitVenta));
  const avisoBodegas = res.bodegasSinInstalacion.length
    ? ` · ⚠️ ${res.bodegasSinInstalacion.length} bodega(s) sin instalación (falta en Tablas Auxiliares): ${res.bodegasSinInstalacion.join(", ")}`
    : "";
  return { cargadas: filas.length, estrategia: `${fechas.length} fecha(s) nueva(s)/actualizada(s); venta neta recalculada sobre ${todos.length} renglones${avisoBodegas}` };
}

export interface ArchivoEntrada { clave: DatasetKey; nombre: string; buffer: Buffer; }

/**
 * Procesa los archivos recibidos según su estrategia. `registrar` = escribir la
 * bitácora en CargaSiesa (true por defecto). La carga in-app pasa false y
 * registra aparte con el usuario que la subió.
 */
export async function procesarCarga(archivos: ArchivoEntrada[], origenIp?: string, registrar = true, confirmado = false): Promise<ResultadoCarga> {
  const res: ResultadoCarga = { ok: true, datasets: {}, errores: [] };
  const titulo = (k: DatasetKey) => DATASETS.find((d) => d.clave === k)!.titulo;

  for (const a of archivos) {
    try {
      if (a.clave === "ventas") {
        const { filas, sinFecha, hoja, columnasNCfaltan } = leerRenglones(a.buffer);
        // Puerta de las columnas de NC: sin ellas la nota crédito sale 0 y el
        // neto se infla. Se pregunta antes de escribir porque la carga no falla
        // sola — el reporte "por ítem" de SIESA no trae estas columnas.
        if (!confirmado && columnasNCfaltan.length) {
          throw new CargaRequiereConfirmacion(
            `El archivo de ventas NO trae ${columnasNCfaltan.length} columna(s) que el motor de notas crédito necesita: ` +
            `${columnasNCfaltan.join(", ")}. Sin ellas, el descuento financiero (nota crédito) de esos renglones se calcula ` +
            "como CERO y la venta neta sale inflada. Vuelve a exportar de SIESA el informe de ventas COMPLETO (con esas " +
            "columnas) antes de cargarlo. Si aun así quieres continuar, confirma la carga.",
          );
        }
        // Puerta de la columna Cantidad ×100: se pregunta antes de escribir,
        // porque una vez guardada la cifra mala nadie la vuelve a mirar.
        const sospecha = confirmado ? null : cantidadesSospechosas(filas);
        if (sospecha) {
          throw new CargaRequiereConfirmacion(
            `De ${sospecha.conCantidad} renglón(es) con cantidad, ${sospecha.multiplos} traen un múltiplo exacto de 100 ` +
            "(100, 200, 300…). Así se ve la columna Cantidad cuando sale del Excel con formato de PORCENTAJE: " +
            "queda multiplicada por cien y un tornillo aparece como 100 unidades. Revisa el formato de esa columna " +
            "en el archivo antes de cargarlo — la plata no se afecta, pero las cantidades y el costo unitario sí.",
          );
        }
        const { cargadas, estrategia } = await persistirVentas(filas);
        res.datasets[a.clave] = { titulo: titulo(a.clave), archivo: a.nombre, hoja, filas: filas.length, cargadas, omitidas: sinFecha, estrategia };
        continue;
      }
      const parsed = parseDataset(a.clave, a.buffer);
      const { cargadas, estrategia } = await persistir(a.clave, parsed.rows);
      res.datasets[a.clave] = { titulo: titulo(a.clave), archivo: a.nombre, hoja: parsed.hoja, filas: parsed.rows.length, cargadas, omitidas: parsed.omitidas, estrategia };
    } catch (e) {
      // Una confirmación pendiente NO es un error: nada se escribió y la
      // pregunta tiene que llegar entera hasta la pantalla de carga.
      if (esConfirmacionPendiente(e)) throw e;
      res.ok = false;
      const msg = e instanceof Error ? e.message : "error";
      res.errores.push(`${titulo(a.clave)} (${a.nombre}): ${msg}`);
    }
  }

  if (registrar) {
    await prisma.cargaSiesa.create({
      data: { ok: res.ok, resumen: res as unknown as object, mensaje: res.errores.join(" · ") || null, origenIp: origenIp ?? null },
    });
  }
  return res;
}
