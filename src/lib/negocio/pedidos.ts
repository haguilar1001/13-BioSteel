// ==========================================================
// Consultas del MÓDULO DE PEDIDOS — réplica de la página "PEDIDOS" del
// tablero de Power BI, sobre la tabla Pedido (un renglón por ítem pedido).
//
//   $ PEDIDOS    Σ costoProm ("Costo promedio total")
//   PEDIDOS      nro de documentos distintos
//   # Pacientes  pacientes distintos
//   Aprobado / Comprometido / Cumplido → el mismo $ partido por estado del
//   movimiento; los tres suman $ PEDIDOS, porque son estados del MISMO
//   pedido y no cifras independientes.
//
// OJO con cuál es "$ PEDIDOS": es el COSTO promedio del material pedido, no
// el valor bruto (la venta). Verificado contra el tablero en jun-2026: con el
// costo da $1.249.405.333,91 y cuadran al peso el corte por línea, por
// ciudad, por proveedor y por modelo de compra; el valor bruto de ese mismo
// mes son $3.305.832.863. La pista definitiva es el modelo APROVECHAMIENTO:
// en el tablero vale $0, y solo el costo da cero ahí (ese material no tiene
// valor en libros). La venta y la utilidad se muestran al lado, como lo que
// son: otra medida del mismo pedido.
//
// Ojo también con el COSTO UNITARIO: se calcula solo sobre los renglones que
// tienen costo. Si se promediara sobre todo, el material de aprovechamiento
// —costo 0 por definición— abarataría el unitario de una línea sin que nada
// hubiera cambiado de precio.
// ==========================================================
import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const MES_LARGO = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
export const MES_CORTO = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Etiqueta de los renglones cuya bodega no está en el catálogo. */
export const SIN_MODELO = "Sin modelo";

const n = (v: unknown): number => (v == null ? 0 : Number(v));

export interface FiltroPedidos {
  anio: number;
  /** 1–12. undefined = todo el año. */
  mes?: number;
  /** 1–31. Solo tiene efecto junto con `mes`. */
  dia?: number;
  ciudad?: string[];
  cliente?: string[];
  marca?: string[];
  linea?: string[];
  anatomia?: string[];
  estado?: string[];
  proveedor?: string;
}

// ---------- WHERE ----------

function where(f: FiltroPedidos): Prisma.Sql {
  const partes: Prisma.Sql[] = [Prisma.sql`m."anio" = ${f.anio}`];
  if (f.mes) partes.push(Prisma.sql`m."mes" = ${f.mes}`);
  if (f.mes && f.dia) partes.push(Prisma.sql`m."dia" = ${f.dia}`);
  if (f.ciudad?.length) partes.push(Prisma.sql`m."ciudad" IN (${Prisma.join(f.ciudad)})`);
  if (f.cliente?.length) partes.push(Prisma.sql`m."cliente" IN (${Prisma.join(f.cliente)})`);
  if (f.marca?.length) partes.push(Prisma.sql`m."marca" IN (${Prisma.join(f.marca)})`);
  if (f.linea?.length) partes.push(Prisma.sql`m."linea" IN (${Prisma.join(f.linea)})`);
  if (f.anatomia?.length) partes.push(Prisma.sql`m."anatomia" IN (${Prisma.join(f.anatomia)})`);
  if (f.estado?.length) partes.push(Prisma.sql`m."estado" IN (${Prisma.join(f.estado)})`);
  if (f.proveedor) partes.push(Prisma.sql`m."proveedor" = ${f.proveedor}`);
  return Prisma.join(partes, " AND ");
}

/** Mismo filtro en forma de WhereInput, para las consultas que no van en SQL. */
export function whereInput(f: FiltroPedidos): Prisma.PedidoWhereInput {
  return {
    anio: f.anio,
    ...(f.mes ? { mes: f.mes } : {}),
    ...(f.mes && f.dia ? { dia: f.dia } : {}),
    ...(f.ciudad?.length ? { ciudad: { in: f.ciudad } } : {}),
    ...(f.cliente?.length ? { cliente: { in: f.cliente } } : {}),
    ...(f.marca?.length ? { marca: { in: f.marca } } : {}),
    ...(f.linea?.length ? { linea: { in: f.linea } } : {}),
    ...(f.anatomia?.length ? { anatomia: { in: f.anatomia } } : {}),
    ...(f.estado?.length ? { estado: { in: f.estado } } : {}),
    ...(f.proveedor ? { proveedor: f.proveedor } : {}),
  };
}

// ---------- Opciones de los segmentadores ----------

export async function aniosConPedidos(): Promise<number[]> {
  const filas = await prisma.pedido.groupBy({ by: ["anio"], orderBy: { anio: "asc" } });
  return filas.map((f) => f.anio);
}

export async function mesesConPedidos(anio: number): Promise<number[]> {
  const filas = await prisma.pedido.groupBy({ by: ["mes"], where: { anio }, orderBy: { mes: "asc" } });
  return filas.map((f) => f.mes);
}

export async function diasConPedidos(anio: number, mes: number): Promise<number[]> {
  const filas = await prisma.pedido.groupBy({ by: ["dia"], where: { anio, mes }, orderBy: { dia: "asc" } });
  return filas.map((f) => f.dia);
}

type CampoTexto = "ciudad" | "cliente" | "marca" | "linea" | "anatomia" | "estado" | "proveedor";

/**
 * Valores distintos de una columna en el año. Los selectores se llenan SIN el
 * resto del filtro a propósito: si se filtraran entre sí, escoger un proveedor
 * dejaría el selector de marca con una sola opción y sin manera de volver.
 */
async function distintos(anio: number, campo: CampoTexto): Promise<string[]> {
  const filas = await prisma.pedido.findMany({
    where: { anio, [campo]: { not: "" } },
    distinct: [campo],
    select: { [campo]: true },
    orderBy: { [campo]: "asc" },
  } as Prisma.PedidoFindManyArgs);
  return (filas as unknown as Record<CampoTexto, string>[]).map((f) => f[campo]).filter(Boolean);
}

export const ciudadesConPedidos = (anio: number) => distintos(anio, "ciudad");
export const clientesConPedidos = (anio: number) => distintos(anio, "cliente");
export const marcasConPedidos = (anio: number) => distintos(anio, "marca");
export const lineasConPedidos = (anio: number) => distintos(anio, "linea");
export const anatomiasConPedidos = (anio: number) => distintos(anio, "anatomia");
export const estadosConPedidos = (anio: number) => distintos(anio, "estado");
export const proveedoresConPedidos = (anio: number) => distintos(anio, "proveedor");

// ---------- KPIs ----------

export interface ResumenPedidos {
  /** $ PEDIDOS: el costo promedio del material pedido. */
  costo: number;
  /** Valor bruto (venta) de ese mismo material. */
  venta: number;
  utilidad: number;
  cantidad: number;
  documentos: number;
  pacientes: number;
  referencias: number;
  /** El mismo $ partido por estado del movimiento. */
  porEstado: { estado: string; costo: number; venta: number; documentos: number }[];
}

export async function resumenPedidos(f: FiltroPedidos): Promise<ResumenPedidos> {
  const [tot] = await prisma.$queryRaw<{
    costo: unknown; venta: unknown; utilidad: unknown; cantidad: unknown;
    documentos: unknown; pacientes: unknown; referencias: unknown;
  }[]>`
    SELECT COALESCE(SUM(m."costoProm"), 0)  AS costo,
           COALESCE(SUM(m."valorBruto"), 0) AS venta,
           COALESCE(SUM(m."utilidad"), 0)   AS utilidad,
           COALESCE(SUM(m."cantPedida"), 0) AS cantidad,
           COUNT(DISTINCT m."nroDocumento") AS documentos,
           COUNT(DISTINCT NULLIF(m."paciente", '')) AS pacientes,
           COUNT(DISTINCT m."referencia")   AS referencias
    FROM "Pedido" m WHERE ${where(f)}`;

  const estados = await prisma.$queryRaw<{ estado: string; costo: unknown; venta: unknown; documentos: unknown }[]>`
    SELECT m."estado" AS estado,
           COALESCE(SUM(m."costoProm"), 0)  AS costo,
           COALESCE(SUM(m."valorBruto"), 0) AS venta,
           COUNT(DISTINCT m."nroDocumento") AS documentos
    FROM "Pedido" m WHERE ${where(f)}
    GROUP BY m."estado" ORDER BY 2 DESC`;

  return {
    costo: n(tot?.costo), venta: n(tot?.venta), utilidad: n(tot?.utilidad),
    cantidad: n(tot?.cantidad), documentos: n(tot?.documentos),
    pacientes: n(tot?.pacientes), referencias: n(tot?.referencias),
    porEstado: estados.map((e) => ({
      estado: e.estado || "(sin estado)",
      costo: n(e.costo), venta: n(e.venta), documentos: n(e.documentos),
    })),
  };
}

// ---------- Cortes del tablero ----------

export interface FilaLinea {
  linea: string;
  costoTotal: number;
  costoUnitario: number;
  cantidad: number;
  venta: number;
}

/** "COSTO PROM por LINEA": costo total, unitario y cantidad pedida. */
export async function costoPorLinea(f: FiltroPedidos): Promise<FilaLinea[]> {
  const filas = await prisma.$queryRaw<{ linea: string; costo: unknown; cant: unknown; cantConCosto: unknown; venta: unknown }[]>`
    SELECT m."linea" AS linea,
           COALESCE(SUM(m."costoProm"), 0)  AS costo,
           COALESCE(SUM(m."cantPedida"), 0) AS cant,
           COALESCE(SUM(CASE WHEN m."costoProm" > 0 THEN m."cantPedida" ELSE 0 END), 0) AS "cantConCosto",
           COALESCE(SUM(m."valorBruto"), 0) AS venta
    FROM "Pedido" m WHERE ${where(f)}
    GROUP BY m."linea" ORDER BY 2 DESC`;
  return filas.map((r) => {
    const costo = n(r.costo), cantConCosto = n(r.cantConCosto);
    return {
      linea: r.linea || "(sin línea)",
      costoTotal: costo,
      costoUnitario: cantConCosto > 0 ? costo / cantConCosto : 0,
      cantidad: n(r.cant),
      venta: n(r.venta),
    };
  });
}

/** `costo` es la medida del tablero ($ PEDIDOS); `venta` va al lado. */
export interface FilaCorte { label: string; costo: number; venta: number; cantidad: number; documentos: number }

/** Agrupación genérica por una columna de texto de Pedido. */
async function porColumna(f: FiltroPedidos, columna: string, vacio: string): Promise<FilaCorte[]> {
  const filas = await prisma.$queryRaw<{ label: string; costo: unknown; venta: unknown; cant: unknown; docs: unknown }[]>`
    SELECT m.${Prisma.raw(`"${columna}"`)} AS label,
           COALESCE(SUM(m."costoProm"), 0)  AS costo,
           COALESCE(SUM(m."valorBruto"), 0) AS venta,
           COALESCE(SUM(m."cantPedida"), 0) AS cant,
           COUNT(DISTINCT m."nroDocumento") AS docs
    FROM "Pedido" m WHERE ${where(f)}
    GROUP BY 1 ORDER BY 2 DESC`;
  return filas.map((r) => ({
    label: r.label || vacio, costo: n(r.costo), venta: n(r.venta),
    cantidad: n(r.cant), documentos: n(r.docs),
  }));
}

export const pedidosPorMarca = (f: FiltroPedidos) => porColumna(f, "marca", "(sin marca)");
export const pedidosPorCiudad = (f: FiltroPedidos) => porColumna(f, "ciudad", "(en blanco)");
export const pedidosPorAnatomia = (f: FiltroPedidos) => porColumna(f, "anatomia", "(sin anatomía)");
export const pedidosPorProveedor = (f: FiltroPedidos) => porColumna(f, "proveedor", "(sin proveedor)");

/**
 * "$ Pedidos x Modelo de Compra". El modelo no está en el pedido: sale del
 * catálogo de bodegas (InvBodega.modeloCompra), que es de donde lo toma el
 * tablero. Las bodegas que el catálogo no tiene caen en "Sin modelo" en vez
 * de desaparecer, y son las mismas que en el tablero salen como "--".
 */
export async function pedidosPorModeloCompra(f: FiltroPedidos): Promise<FilaCorte[]> {
  const [filas, bodegas] = await Promise.all([
    porColumna(f, "bodegaCodigo", ""),
    prisma.invBodega.findMany({ select: { codigo: true, modeloCompra: true } }),
  ]);
  const catalogo = new Map(bodegas.map((b) => [b.codigo, b.modeloCompra]));
  const mapa = new Map<string, FilaCorte>();
  for (const r of filas) {
    const modelo = catalogo.get(r.label) || SIN_MODELO;
    const e = mapa.get(modelo) ?? { label: modelo, costo: 0, venta: 0, cantidad: 0, documentos: 0 };
    e.costo += r.costo; e.venta += r.venta; e.cantidad += r.cantidad; e.documentos += r.documentos;
    mapa.set(modelo, e);
  }
  return [...mapa.values()].sort((a, b) => b.costo - a.costo);
}

/**
 * Cruce marca × modelo de compra, en $ costo. Responde a "de lo que le pido a
 * SAMPEDRO, ¿cuánto es material a stock y cuánto por procedimiento?", que es
 * lo que decide si esa marca se puede reponer o se compra cirugía a cirugía.
 *
 * El modelo no está en el pedido: sale del catálogo de bodegas, igual que en
 * pedidosPorModeloCompra. Se agrupa por bodega y se traduce en memoria porque
 * el catálogo son 84 filas y no vale la pena un JOIN.
 */
export async function pedidosPorMarcaYModelo(f: FiltroPedidos): Promise<Map<string, Map<string, number>>> {
  const [filas, bodegas] = await Promise.all([
    prisma.$queryRaw<{ marca: string; bodega: string; costo: unknown }[]>`
      SELECT m."marca" AS marca, m."bodegaCodigo" AS bodega,
             COALESCE(SUM(m."costoProm"), 0) AS costo
      FROM "Pedido" m WHERE ${where(f)}
      GROUP BY 1, 2`,
    prisma.invBodega.findMany({ select: { codigo: true, modeloCompra: true } }),
  ]);
  const catalogo = new Map(bodegas.map((b) => [b.codigo, b.modeloCompra]));
  const out = new Map<string, Map<string, number>>();
  for (const r of filas) {
    // La misma etiqueta que usa pedidosPorMarca, para que las dos tablas
    // hablen de la misma fila.
    const marca = r.marca || "(sin marca)";
    const modelo = catalogo.get(r.bodega) || SIN_MODELO;
    const porModelo = out.get(marca) ?? new Map<string, number>();
    porModelo.set(modelo, (porModelo.get(modelo) ?? 0) + n(r.costo));
    out.set(marca, porModelo);
  }
  return out;
}

/** Evolución mensual del año filtrado (12 posiciones, 1–12). */
export async function pedidosPorMes(f: FiltroPedidos): Promise<{ mes: number; costo: number; venta: number; cantidad: number }[]> {
  const filas = await prisma.$queryRaw<{ mes: number; costo: unknown; venta: unknown; cant: unknown }[]>`
    SELECT m."mes" AS mes,
           COALESCE(SUM(m."costoProm"), 0)  AS costo,
           COALESCE(SUM(m."valorBruto"), 0) AS venta,
           COALESCE(SUM(m."cantPedida"), 0) AS cant
    FROM "Pedido" m WHERE ${where({ ...f, mes: undefined, dia: undefined })}
    GROUP BY m."mes"`;
  const mapa = new Map(filas.map((r) => [r.mes, r]));
  return Array.from({ length: 12 }, (_, i) => {
    const r = mapa.get(i + 1);
    return { mes: i + 1, costo: n(r?.costo), venta: n(r?.venta), cantidad: n(r?.cant) };
  });
}

// ---------- Detalle ----------

export interface FilaDetalle {
  fecha: Date;
  nroDocumento: string;
  estado: string;
  bodegaDesc: string;
  referencia: string;
  descItem: string;
  cantPedida: number;
  costoProm: number;
  valorBruto: number;
  utilidad: number;
  marca: string;
  linea: string;
  anatomia: string;
  cliente: string;
  ciudad: string;
  paciente: string;
  medico: string;
  proveedor: string;
}

export async function detallePedidos(f: FiltroPedidos, tope: number): Promise<FilaDetalle[]> {
  const filas = await prisma.pedido.findMany({
    where: whereInput(f),
    orderBy: [{ fecha: "desc" }, { nroDocumento: "desc" }],
    take: tope,
    select: {
      fecha: true, nroDocumento: true, estado: true, bodegaDesc: true,
      referencia: true, descItem: true, cantPedida: true, costoProm: true,
      valorBruto: true, utilidad: true, marca: true, linea: true, anatomia: true,
      cliente: true, ciudad: true, paciente: true, medico: true, proveedor: true,
    },
  });
  return filas.map((r) => ({
    ...r,
    cantPedida: r.cantPedida.toNumber(),
    costoProm: r.costoProm.toNumber(),
    valorBruto: r.valorBruto.toNumber(),
    utilidad: r.utilidad.toNumber(),
  }));
}

export async function contarDetalle(f: FiltroPedidos): Promise<number> {
  return prisma.pedido.count({ where: whereInput(f) });
}
