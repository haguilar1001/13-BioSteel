// ==========================================================
// Descuentos Financieros por Cliente — réplica de la vista homónima de Power
// BI. Para cada "Razón social cliente despacho": Σ Valor subtotal local,
// Σ NOTA_CREDITO (descuento reliquidado), % descuento y venta neta.
//
// Se calcula EN VIVO desde VentaDoc con el MISMO motor de NC que usa el
// informe (nota-credito.ts), así que la columna "Neto" cuadra exactamente con
// la Venta Neta del tablero. Es, además, el diagnóstico para comparar con
// Power BI: un cliente con % de descuento más bajo que en PBI delata notas
// crédito que no se calcularon (normalmente porque el archivo cargado vino sin
// las columnas que el motor necesita: sucursal, convenio, procedimiento, línea).
//
// El mapa de NAN (una NAN de otro mes anula el descuento) necesita TODO el año,
// así que se carga el año completo y luego se acota a los meses pedidos.
// ==========================================================
import "server-only";
import { prisma } from "@/lib/db";
import {
  notaCredito, construirNanMeses, nroClave,
  type CtxNC, type ParamNC, type VentaRow,
} from "./nota-credito";

export interface FilaDescuento {
  cliente: string;
  subtotal: number;
  notaCredito: number;
  neto: number;
  /** NOTA_CREDITO / subtotal × 100. 0 si subtotal 0. */
  pct: number;
}

export interface ResumenDescuentos {
  filas: FilaDescuento[];
  subtotal: number;
  notaCredito: number;
  neto: number;
  pct: number;
  /** Renglones leídos y cuántos traen vacías las columnas que el motor usa. */
  renglones: number;
  sinColumnasNC: number;
}

type DocRow = VentaRow & { cliente: string };

/** Descuentos financieros por cliente del período (año, opcionalmente meses). */
export async function descuentosPorCliente(anio: number, meses?: number[]): Promise<ResumenDescuentos> {
  const [pRows, xRows, docs] = await Promise.all([
    prisma.parametroNotaCredito.findMany(),
    prisma.exclusionNC.findMany({ where: { concepto: "TODOS" } }),
    prisma.ventaDoc.findMany({
      where: { anio },
      select: {
        nro: true, tipo: true, aprobada: true, fecha: true, anio: true, mes: true,
        ips: true, suc: true, bod: true, notas: true, conv: true, proc: true, linea: true,
        subtotal: true, fbd: true, cliente: true,
      },
    }),
  ]);

  const params: ParamNC[] = pRows.map((p) => ({
    ips: p.ips, concepto: p.concepto, pct: p.pct.toNumber(),
    ini: p.fechaInicio.getTime(), fin: p.fechaFin.getTime(),
  }));
  const excluidos = new Set(xRows.map((x) => nroClave(x.nroDocumento)));

  const rows: DocRow[] = docs.map((d) => ({
    nro: d.nro, tipo: d.tipo, aprobada: d.aprobada, ms: d.fecha.getTime(), anio: d.anio, mes: d.mes,
    ips: d.ips, suc: d.suc, bod: d.bod, notas: d.notas, conv: d.conv, proc: d.proc, linea: d.linea,
    subtotal: d.subtotal.toNumber(), fbd: d.fbd ?? undefined, cliente: d.cliente || "(sin cliente)",
  }));
  // NAN de todo el año: el gate de "NAN de otro mes" necesita el año completo.
  const ctx: CtxNC = { params, nanMeses: construirNanMeses(rows, (i) => rows[i]!.fbd ?? ""), excluidos };

  const acota = meses && meses.length ? new Set(meses) : null;
  const porCliente = new Map<string, { sub: number; nc: number }>();
  let subtotal = 0, nc = 0, renglones = 0, sinColumnasNC = 0;

  for (const r of rows) {
    if (acota && !acota.has(r.mes)) continue;
    renglones++;
    const descuento = notaCredito(r, ctx);
    // Un FET elegible a descuento pero sin ninguna de las columnas de matching
    // es señal de archivo incompleto: se cuenta para avisarlo en pantalla.
    if (r.tipo === "FET" && !r.suc && !r.conv && !r.proc && !r.linea) sinColumnasNC++;
    const e = porCliente.get(r.cliente) ?? { sub: 0, nc: 0 };
    e.sub += r.subtotal; e.nc += descuento;
    porCliente.set(r.cliente, e);
    subtotal += r.subtotal; nc += descuento;
  }

  const filas: FilaDescuento[] = [...porCliente.entries()]
    .map(([cliente, e]) => ({
      cliente, subtotal: e.sub, notaCredito: e.nc,
      neto: e.sub - e.nc, pct: e.sub ? (e.nc / e.sub) * 100 : 0,
    }))
    .sort((a, b) => b.subtotal - a.subtotal);

  return {
    filas, subtotal, notaCredito: nc, neto: subtotal - nc,
    pct: subtotal ? (nc / subtotal) * 100 : 0,
    renglones, sinColumnasNC,
  };
}
