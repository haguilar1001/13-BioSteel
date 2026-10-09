// ==========================================================
// Escribe los agregados de venta neta a la BD desde renglones (FilaVenta):
// VentaLinea / VentaCliente / VentaMarca / VentaMarcaIps (mensuales, con
// ajustes manuales) + VentaDia (venta neta por día, sin ajustes).
// Módulo PURO (acepta el PrismaClient): lo usan el CLI (prisma/set-ventas) y la
// carga por formulario (carga-siesa), para que VentaLinea salga IDÉNTICO en
// ambos caminos (misma agregarVentas).
// ==========================================================
import type { PrismaClient } from "@prisma/client";
import { agregarVentas, mapaInstalacionPorBodega, normalizaBodega, type FilaVenta } from "./importar-ventas";
import { nroClave, type ParamNC } from "./nota-credito";

const BATCH = 5000;
const r2 = (v: number) => Math.round(v * 100) / 100;

async function crearEnLotes<T>(rows: T[], fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += BATCH) await fn(rows.slice(i, i + BATCH));
}

export interface ResultadoRecalculo {
  netoPorAnio: Map<number, number>; totalNC: number; anios: number[];
  /** Nombres de bodega que NO cruzaron contra InvBodega: quedaron sin instalación. */
  bodegasSinInstalacion: string[];
}

/** Recalcula y escribe todos los agregados de venta desde los renglones dados. */
export async function escribirAgregados(prisma: PrismaClient, filas: FilaVenta[]): Promise<ResultadoRecalculo> {
  const [pRows, xRows, ajustes, bodegas] = await Promise.all([
    prisma.parametroNotaCredito.findMany(),
    prisma.exclusionNC.findMany({ where: { concepto: "TODOS" } }),
    prisma.ajusteVenta.findMany(),
    // Mismo catálogo de Compras/Osteosíntesis: de ahí sale la instalación
    // (101/102/104/106) de cada renglón, cruzando por nombre de bodega.
    prisma.invBodega.findMany({ select: { descripcion: true, instalacion: true } }),
  ]);
  const params: ParamNC[] = pRows.map((p) => ({ ips: p.ips, concepto: p.concepto, pct: p.pct.toNumber(), ini: p.fechaInicio.getTime(), fin: p.fechaFin.getTime() }));
  const excluidos = new Set(xRows.map((x) => nroClave(x.nroDocumento)));
  const mapaInstalacion = mapaInstalacionPorBodega(bodegas);

  const agg = agregarVentas(filas, params, excluidos, mapaInstalacion);

  // Ajustes manuales (mensuales) como línea sintética por concepto (igual que el CLI).
  // IMPORTANTE: solo se aplican a años PRESENTES en este lote. Si el archivo trae
  // solo 2026, NO se toca 2024/2025 (evita borrar años que no vienen en la carga).
  const lineas = [...agg.porLinea];
  const clientes = [...agg.porCliente];
  const marcas = [...agg.porMarca];
  const marcaIps = [...agg.porMarcaIps];
  const items = agg.porItem; // el detalle por ítem no recibe ajustes sintéticos
  const itemsIps = agg.porItemIps; // ídem, abierto por IPS
  const anios = [...agg.anios];
  const aniosData = new Set(agg.anios);
  for (const aj of ajustes) {
    if (!aniosData.has(aj.anio)) continue; // no recalcular años ausentes en este lote
    const v = aj.valor.toNumber(); const c = aj.concepto;
    agg.netoPorAnio.set(aj.anio, (agg.netoPorAnio.get(aj.anio) ?? 0) + v);
    lineas.push({ anio: aj.anio, mes: aj.mes, linea: c, valor: v, costo: 0 });
    clientes.push({ anio: aj.anio, mes: aj.mes, clienteNombre: c, nit: null, valor: v, costo: 0 });
    marcas.push({ anio: aj.anio, mes: aj.mes, marca: c, valor: v, costo: 0 });
    marcaIps.push({ anio: aj.anio, mes: aj.mes, marca: c, ips: c, valor: v, costo: 0 });
  }

  // Mensuales: delete+recreate SOLO de los años presentes en el lote.
  for (const anio of anios.sort((a, b) => a - b)) {
    const L = lineas.filter((e) => e.anio === anio);
    const C = clientes.filter((e) => e.anio === anio);
    const M = marcas.filter((e) => e.anio === anio);
    const MI = marcaIps.filter((e) => e.anio === anio);
    const I = items.filter((e) => e.anio === anio);
    const II = itemsIps.filter((e) => e.anio === anio);
    await prisma.$transaction([
      prisma.ventaLinea.deleteMany({ where: { anio } }),
      prisma.ventaCliente.deleteMany({ where: { anio } }),
      prisma.ventaMarca.deleteMany({ where: { anio } }),
      prisma.ventaMarcaIps.deleteMany({ where: { anio } }),
      prisma.ventaItem.deleteMany({ where: { anio } }),
      prisma.ventaItemIps.deleteMany({ where: { anio } }),
    ]);
    await crearEnLotes(L, (c) => prisma.ventaLinea.createMany({ data: c.map((e) => ({ anio: e.anio, mes: e.mes, linea: e.linea, valor: r2(e.valor), costo: r2(e.costo) })) }));
    await crearEnLotes(C, (c) => prisma.ventaCliente.createMany({ data: c.map((e) => ({ anio: e.anio, mes: e.mes, clienteNombre: e.clienteNombre, nit: e.nit, valor: r2(e.valor), costo: r2(e.costo) })) }));
    await crearEnLotes(M, (c) => prisma.ventaMarca.createMany({ data: c.map((e) => ({ anio: e.anio, mes: e.mes, marca: e.marca, valor: r2(e.valor), costo: r2(e.costo) })) }));
    await crearEnLotes(MI, (c) => prisma.ventaMarcaIps.createMany({ data: c.map((e) => ({ anio: e.anio, mes: e.mes, marca: e.marca, ips: e.ips, valor: r2(e.valor), costo: r2(e.costo) })) }));
    await crearEnLotes(I, (c) => prisma.ventaItem.createMany({ data: c.map((e) => ({ anio: e.anio, mes: e.mes, marca: e.marca, referencia: e.referencia, descripcion: e.descripcion, cantidad: r2(e.cantidad), valor: r2(e.valor), costo: r2(e.costo) })) }));
    await crearEnLotes(II, (c) => prisma.ventaItemIps.createMany({ data: c.map((e) => ({ anio: e.anio, mes: e.mes, marca: e.marca, referencia: e.referencia, descripcion: e.descripcion, ips: e.ips, nit: e.nit, lista: e.lista, instalacion: e.instalacion, linea: e.linea, cantidad: r2(e.cantidad), valor: r2(e.valor), costo: r2(e.costo) })) }));
  }

  // Venta neta por día: reemplazo total (sin ajustes mensuales).
  await prisma.ventaDia.deleteMany({});
  await crearEnLotes(agg.porDia, (c) => prisma.ventaDia.createMany({ data: c.map((e) => ({ anio: e.anio, mes: e.mes, dia: e.dia, valor: r2(e.valor), costo: r2(e.costo) })) }));

  // Nombra las bodegas del lote que no cruzaron contra el catálogo, para que
  // el aviso diga cuáles corregir en vez de solo "algo quedó sin instalación".
  const sinCruce = new Set<string>();
  for (const f of filas) {
    if (f.bod && !mapaInstalacion.has(normalizaBodega(f.bod))) sinCruce.add(f.bod);
  }
  return { netoPorAnio: agg.netoPorAnio, totalNC: agg.totalNC, anios, bodegasSinInstalacion: [...sinCruce].sort() };
}

/** Convierte una fila de VentaDoc (BD) a FilaVenta para recalcular. */
export function docABitVenta(d: {
  nro: string; tipo: string; aprobada: boolean; fecha: Date; anio: number; mes: number;
  ips: string | null; suc: string; bod: string; notas: string; conv: string; proc: string;
  linea: string; subtotal: { toNumber(): number }; fbd: string | null; costo: { toNumber(): number };
  cliente: string; nit: string | null; marca: string; referencia?: string; cantidad?: { toNumber(): number };
  lista?: string;
}): FilaVenta {
  return {
    nro: d.nro, tipo: d.tipo, aprobada: d.aprobada, ms: d.fecha.getTime(), anio: d.anio, mes: d.mes,
    ips: d.ips, suc: d.suc, bod: d.bod, notas: d.notas, conv: d.conv, proc: d.proc, linea: d.linea,
    subtotal: d.subtotal.toNumber(), fbd: d.fbd ?? undefined, costo: d.costo.toNumber(),
    cliente: d.cliente, nit: d.nit, marca: d.marca,
    referencia: d.referencia ?? "", cantidad: d.cantidad ? d.cantidad.toNumber() : 0,
    lista: d.lista ?? "",
  };
}
