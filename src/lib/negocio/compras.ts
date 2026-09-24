// ==========================================================
// Consultas del MÓDULO DE COMPRAS — réplica del "INFORME DE COMPRAS" de
// Power BI. Cuatro medidas, cada una de una fuente distinta, todas cuadradas
// contra el tablero (corte 11-ago-2026):
//
//   $ Ordenes de Compra      Σ CompraOrden.valorNeto        por fechaOrden
//   Cantidad ODC             nro de órdenes distintas
//   $ Pendiente por Despacho Σ CompraPendiente.valorPendiente por fechaEntrega
//   Cantidad PPD             nro de órdenes distintas
//   $ Facturado Proveedor    Σ CompraFactura.valorNeto      por fecha
//   Cantidad FPP             nro de documentos distintos
//   $ Entradas por Compras   Σ InvMovimiento.costoEntradas  con tipoDoc EPC o ECG
//                            (Power BI mide solo EPC: ver TIPOS_ENTRADA_COMPRA)
//
// Ojo con el PENDIENTE: se agrupa por FECHA DE ENTREGA de la orden, no por
// fecha de la orden. Agruparlo por fecha de orden da otra cifra (y fue el
// primer intento fallido al reconstruir el tablero).
//
// Qué filtro aplica a qué fuente — no todas tienen todas las columnas:
//   · proveedor → órdenes, pendientes y facturas de forma exacta. Las
//     entradas se atribuyen por DOCUMENTO usando el reporte "entradas por
//     compra" (tabla EntradaProveedor), y solo donde ese reporte no llega se
//     cae a la MARCA, que sí es una aproximación y se marca como tal.
//   · línea     → órdenes, pendientes y entradas. NO a las facturas: el
//     documento CCP es de cabecera, sin línea de producto.
//   · tipo de compra → igual que proveedor (vía ProveedorCompra).
// La pantalla avisa cuando una cifra es estimada o cuando un filtro no aplica.
// ==========================================================
import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { NOMBRE_INSTALACION } from "./inventario-osteo";

export const MES_LARGO = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
export const MES_CORTO = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Etiqueta de los proveedores que no están en el catálogo de tipos. */
export const SIN_CLASIFICAR = "SIN CLASIFICAR";

/**
 * Documentos de inventario que cuentan como entrada por compra:
 *   EPC — entrada por compra
 *   ECG — entrada en consignación (decisión de Héctor, 21-ago-2026)
 *
 * OJO: el tablero de Power BI mide solo EPC, así que desde que entra ECG las
 * dos cifras dejan de coincidir a propósito (~$139 M más en 2026).
 * Los ajustes y devoluciones en compra (AEC, DEC) NO entran: son valores
 * negativos que restarían de la entrada, y nadie los ha pedido.
 */
const TIPOS_ENTRADA_COMPRA = ["EPC", "ECG"];

/** Fragmento SQL con la lista de tipos, para los IN (...). */
const listaTipos = () => Prisma.join(TIPOS_ENTRADA_COMPRA.map((t) => Prisma.sql`${t}`));

const n = (v: unknown): number => (v == null ? 0 : Number(v));

export interface FiltroCompras {
  anio: number;
  /** 1–12. undefined = todo el año. */
  mes?: number;
  /** 1–31. Solo tiene efecto junto con `mes`. */
  dia?: number;
  proveedor?: string[];
  linea?: string[];
  tipoCompra?: string[];
  /**
   * 101 propio · 102 consignación · 106 aprovechamiento. Ninguna fuente de
   * compras la trae: se deduce de la BODEGA con el catálogo InvBodega, el
   * mismo puente que usa Osteosíntesis.
   */
  instalacion?: number[];
}

// ---------- Fragmentos de WHERE ----------

/** Acota por año/mes/día sobre las columnas anio/mes + una columna de fecha. */
function periodo(f: FiltroCompras, colFecha: string): Prisma.Sql {
  const partes: Prisma.Sql[] = [Prisma.sql`m."anio" = ${f.anio}`];
  if (f.mes) partes.push(Prisma.sql`m."mes" = ${f.mes}`);
  if (f.mes && f.dia) {
    partes.push(Prisma.sql`EXTRACT(DAY FROM m.${Prisma.raw(`"${colFecha}"`)}) = ${f.dia}`);
  }
  return Prisma.join(partes, " AND ");
}

/**
 * Proveedores del tipo (o tipos) de compra pedido. "SIN CLASIFICAR" = los que
 * no están en el catálogo, para que el filtro nunca esconda plata sin avisar.
 */
function porTipoCompra(f: FiltroCompras): Prisma.Sql {
  const tipos = f.tipoCompra ?? [];
  if (!tipos.length) return Prisma.empty;
  const normales = tipos.filter((t) => t !== SIN_CLASIFICAR);
  const partes: Prisma.Sql[] = [];
  if (normales.length) {
    partes.push(Prisma.sql`m."proveedor" IN (SELECT "razonSocial" FROM "ProveedorCompra" WHERE "tipoCompra" IN (${Prisma.join(normales)}))`);
  }
  if (tipos.includes(SIN_CLASIFICAR)) {
    partes.push(Prisma.sql`m."proveedor" NOT IN (SELECT "razonSocial" FROM "ProveedorCompra" WHERE "tipoCompra" <> '')`);
  }
  return Prisma.sql` AND (${Prisma.join(partes, " OR ")})`;
}

const porProveedorSql = (f: FiltroCompras): Prisma.Sql =>
  f.proveedor && f.proveedor.length ? Prisma.sql` AND m."proveedor" IN (${Prisma.join(f.proveedor)})` : Prisma.empty;

const porLineaSql = (f: FiltroCompras): Prisma.Sql =>
  f.linea && f.linea.length ? Prisma.sql` AND m."linea" IN (${Prisma.join(f.linea)})` : Prisma.empty;

/**
 * Instalación de las órdenes y los pendientes: la del catálogo de bodegas.
 * Una bodega sin catalogar no pertenece a ninguna instalación, así que queda
 * FUERA del filtro en vez de colarse en la que no es.
 */
const porInstalacionSql = (f: FiltroCompras): Prisma.Sql => {
  const validas = (f.instalacion ?? []).filter((i) => NOMBRE_INSTALACION[i]);
  return validas.length
    ? Prisma.sql` AND m."bodegaCodigo" IN (SELECT "codigo" FROM "InvBodega" WHERE "instalacion" IN (${Prisma.join(validas)}))`
    : Prisma.empty;
};

/** Igual, pero el movimiento de inventario sí declara su propia instalación. */
const porInstalacionMovSql = (f: FiltroCompras): Prisma.Sql => {
  const validas = (f.instalacion ?? []).filter((i) => NOMBRE_INSTALACION[i]);
  return validas.length
    ? Prisma.sql` AND COALESCE(m."instalacion", (SELECT b."instalacion" FROM "InvBodega" b WHERE b."codigo" = m."bodegaCodigo")) IN (${Prisma.join(validas)})`
    : Prisma.empty;
};

/** WHERE de órdenes y pendientes (tienen proveedor y línea). */
function whereOrdenes(f: FiltroCompras): Prisma.Sql {
  return Prisma.sql`${periodo(f, "fechaOrden")}${porProveedorSql(f)}${porLineaSql(f)}${porTipoCompra(f)}${porInstalacionSql(f)}`;
}
function wherePendientes(f: FiltroCompras): Prisma.Sql {
  return Prisma.sql`${periodo(f, "fechaEntrega")}${porProveedorSql(f)}${porLineaSql(f)}${porTipoCompra(f)}${porInstalacionSql(f)}`;
}
/** WHERE de facturas: sin línea (el documento CCP no la trae). */
function whereFacturas(f: FiltroCompras): Prisma.Sql {
  return Prisma.sql`${periodo(f, "fecha")}${porProveedorSql(f)}${porTipoCompra(f)}`;
}
/** WHERE de entradas por compra: sin proveedor (el movimiento trae marca). */
function whereEntradas(f: FiltroCompras): Prisma.Sql {
  return Prisma.sql`m."tipoDoc" IN (${listaTipos()}) AND ${periodo(f, "fecha")}${porLineaSql(f)}${porInstalacionMovSql(f)}`;
}

/** Filtros que una fuente no puede aplicar tal cual (para avisarlo en pantalla). */
export function filtrosIgnorados(f: FiltroCompras): { facturas: string[] } {
  const facturas: string[] = [];
  if (f.linea?.length) facturas.push("línea");
  // El documento CCP es de cabecera: no trae bodega, así que tampoco hay
  // instalación que mirar.
  if (f.instalacion?.length) facturas.push("instalación");
  return { facturas };
}

// ---------- Catálogos para los selectores ----------

export async function aniosConCompras(): Promise<number[]> {
  const filas = await prisma.$queryRaw<{ anio: number }[]>`
    SELECT DISTINCT "anio" FROM "CompraOrden"
    UNION SELECT DISTINCT "anio" FROM "CompraFactura"
    UNION SELECT DISTINCT "anio" FROM "CompraPendiente"
    UNION SELECT DISTINCT "anio" FROM "InvMovimiento" WHERE "tipoDoc" IN (${listaTipos()})
    ORDER BY 1`;
  return filas.map((f) => Number(f.anio));
}

export async function mesesConCompras(anio: number): Promise<number[]> {
  const filas = await prisma.$queryRaw<{ mes: number }[]>`
    SELECT DISTINCT "mes" FROM "CompraOrden" WHERE "anio" = ${anio}
    UNION SELECT DISTINCT "mes" FROM "CompraFactura" WHERE "anio" = ${anio}
    UNION SELECT DISTINCT "mes" FROM "CompraPendiente" WHERE "anio" = ${anio}
    UNION SELECT DISTINCT "mes" FROM "InvMovimiento" WHERE "anio" = ${anio} AND "tipoDoc" IN (${listaTipos()})
    ORDER BY 1`;
  return filas.map((f) => Number(f.mes));
}

export async function diasConCompras(anio: number, mes: number): Promise<number[]> {
  const filas = await prisma.$queryRaw<{ dia: number }[]>`
    SELECT DISTINCT "dia" FROM "CompraOrden" WHERE "anio" = ${anio} AND "mes" = ${mes}
    UNION SELECT DISTINCT "dia" FROM "CompraFactura" WHERE "anio" = ${anio} AND "mes" = ${mes}
    UNION SELECT DISTINCT EXTRACT(DAY FROM "fechaEntrega")::int FROM "CompraPendiente"
      WHERE "anio" = ${anio} AND "mes" = ${mes} AND "fechaEntrega" IS NOT NULL
    UNION SELECT DISTINCT EXTRACT(DAY FROM "fecha")::int FROM "InvMovimiento"
      WHERE "anio" = ${anio} AND "mes" = ${mes} AND "tipoDoc" IN (${listaTipos()})
    ORDER BY 1`;
  return filas.map((f) => Number(f.dia)).filter((d) => d >= 1 && d <= 31);
}

/** Proveedores con actividad en el año (órdenes, pendientes o facturas). */
export async function proveedoresConCompras(anio: number): Promise<string[]> {
  const filas = await prisma.$queryRaw<{ proveedor: string }[]>`
    SELECT DISTINCT "proveedor" FROM "CompraOrden" WHERE "anio" = ${anio} AND "proveedor" <> ''
    UNION SELECT DISTINCT "proveedor" FROM "CompraFactura" WHERE "anio" = ${anio} AND "proveedor" <> ''
    UNION SELECT DISTINCT "proveedor" FROM "CompraPendiente" WHERE "anio" = ${anio} AND "proveedor" <> ''
    ORDER BY 1`;
  return filas.map((f) => f.proveedor);
}

export async function lineasConCompras(anio: number): Promise<string[]> {
  const filas = await prisma.$queryRaw<{ linea: string }[]>`
    SELECT DISTINCT "linea" FROM "CompraOrden" WHERE "anio" = ${anio} AND "linea" <> ''
    UNION SELECT DISTINCT "linea" FROM "CompraPendiente" WHERE "anio" = ${anio} AND "linea" <> ''
    ORDER BY 1`;
  return filas.map((f) => f.linea);
}

/** Tipos de compra del catálogo, más "SIN CLASIFICAR" si hay proveedores sueltos. */
export async function tiposDeCompra(): Promise<string[]> {
  const filas = await prisma.proveedorCompra.findMany({
    where: { tipoCompra: { not: "" } },
    distinct: ["tipoCompra"],
    select: { tipoCompra: true },
    orderBy: { tipoCompra: "asc" },
  });
  const tipos = filas.map((f) => f.tipoCompra);
  return tipos.length ? [...tipos, SIN_CLASIFICAR] : [];
}

/**
 * Instalaciones presentes en las compras del año (101 · 102 · 106). Se
 * consulta en vez de listar las tres siempre: ofrecer una opción que solo
 * devuelve ceros hace dudar del dato, no del filtro.
 */
export async function instalacionesConCompras(anio: number): Promise<number[]> {
  const filas = await prisma.$queryRaw<{ instalacion: number | null }[]>`
    SELECT DISTINCT b."instalacion" AS instalacion
      FROM "CompraOrden" m JOIN "InvBodega" b ON b."codigo" = m."bodegaCodigo"
     WHERE m."anio" = ${anio}
    UNION
    SELECT DISTINCT COALESCE(m."instalacion", b."instalacion") AS instalacion
      FROM "InvMovimiento" m LEFT JOIN "InvBodega" b ON b."codigo" = m."bodegaCodigo"
     WHERE m."anio" = ${anio} AND m."tipoDoc" IN (${listaTipos()})
    ORDER BY 1`;
  return filas.map((r) => Number(r.instalacion)).filter((i) => NOMBRE_INSTALACION[i]);
}

/**
 * Lo que NINGUNA instalación va a mostrar: órdenes y pendientes cuya bodega
 * no está en el catálogo InvBodega. Sin catálogo no hay instalación, así que
 * al filtrar esa plata se queda fuera; se avisa en pantalla para que no
 * desaparezca en silencio (hoy: la 154P "PRESTAMO VALLESALUD SUR").
 */
export async function comprasSinInstalacion(f: FiltroCompras): Promise<{ valor: number; bodegas: string[] }> {
  const sinInst: FiltroCompras = { ...f, instalacion: undefined };
  const filas = await prisma.$queryRaw<{ bodega: string; valor: unknown }[]>`
    SELECT m."bodegaCodigo" || ' · ' || MIN(m."bodegaDesc") AS bodega, SUM(m."valorNeto") AS valor
      FROM "CompraOrden" m LEFT JOIN "InvBodega" b ON b."codigo" = m."bodegaCodigo"
     WHERE ${whereOrdenes(sinInst)} AND b."codigo" IS NULL
     GROUP BY m."bodegaCodigo"
    UNION ALL
    SELECT m."bodegaCodigo" || ' · ' || MIN(m."bodegaDesc") AS bodega, SUM(m."valorPendiente") AS valor
      FROM "CompraPendiente" m LEFT JOIN "InvBodega" b ON b."codigo" = m."bodegaCodigo"
     WHERE ${wherePendientes(sinInst)} AND b."codigo" IS NULL
     GROUP BY m."bodegaCodigo"`;
  const valor = filas.reduce((t, r) => t + n(r.valor), 0);
  return { valor, bodegas: [...new Set(filas.map((r) => r.bodega))] };
}

/** Etiqueta del selector: "101 · Propio". */
export const etiquetaInstalacion = (i: number): string => `${i} · ${NOMBRE_INSTALACION[i] ?? "?"}`;

// ---------- Los cuatro KPI ----------

export interface ResumenCompras {
  entradas: number;
  entradasUnidades: number;
  /** true = la cifra se atribuyó por marca (hay filtro de proveedor/tipo). */
  entradasEstimadas: boolean;
  ordenes: number;
  ordenesCant: number;
  pendiente: number;
  pendienteCant: number;
  facturado: number;
  facturadoCant: number;
}

export async function resumenCompras(f: FiltroCompras): Promise<ResumenCompras> {
  const [ent, ord, pen, fac] = await Promise.all([
    entradasDelFiltro(f),
    prisma.$queryRaw<{ valor: unknown; cant: unknown }[]>`
      SELECT COALESCE(SUM(m."valorNeto"), 0) AS valor, COUNT(DISTINCT m."nroOrden") AS cant
      FROM "CompraOrden" m WHERE ${whereOrdenes(f)}`,
    prisma.$queryRaw<{ valor: unknown; cant: unknown }[]>`
      SELECT COALESCE(SUM(m."valorPendiente"), 0) AS valor, COUNT(DISTINCT m."nroOrden") AS cant
      FROM "CompraPendiente" m WHERE ${wherePendientes(f)}`,
    prisma.$queryRaw<{ valor: unknown; cant: unknown }[]>`
      SELECT COALESCE(SUM(m."valorNeto"), 0) AS valor, COUNT(DISTINCT m."nroDocumento") AS cant
      FROM "CompraFactura" m WHERE ${whereFacturas(f)}`,
  ]);
  return {
    entradas: ent.valor, entradasUnidades: ent.unidades, entradasEstimadas: ent.estimado,
    ordenes: n(ord[0]?.valor), ordenesCant: n(ord[0]?.cant),
    pendiente: n(pen[0]?.valor), pendienteCant: n(pen[0]?.cant),
    facturado: n(fac[0]?.valor), facturadoCant: n(fac[0]?.cant),
  };
}

// ---------- Series y desgloses ----------

export interface SerieMes { mes: number; ordenes: number; entradas: number; facturado: number }

/** Las tres medidas mensuales del año, ignorando el filtro de mes/día. */
export async function comprasPorMes(f: FiltroCompras): Promise<SerieMes[]> {
  const anual: FiltroCompras = { ...f, mes: undefined, dia: undefined };
  const [ord, ent, fac] = await Promise.all([
    prisma.$queryRaw<{ mes: number; valor: unknown }[]>`
      SELECT m."mes" AS mes, SUM(m."valorNeto") AS valor FROM "CompraOrden" m
      WHERE ${whereOrdenes(anual)} GROUP BY m."mes"`,
    prisma.$queryRaw<{ mes: number; valor: unknown }[]>`
      SELECT m."mes" AS mes, SUM(m."costoEntradas") AS valor FROM "InvMovimiento" m
      WHERE ${whereEntradas(anual)} GROUP BY m."mes"`,
    prisma.$queryRaw<{ mes: number; valor: unknown }[]>`
      SELECT m."mes" AS mes, SUM(m."valorNeto") AS valor FROM "CompraFactura" m
      WHERE ${whereFacturas(anual)} GROUP BY m."mes"`,
  ]);
  const mapa = (filas: { mes: number; valor: unknown }[]) =>
    new Map(filas.map((r) => [Number(r.mes), n(r.valor)]));
  const mo = mapa(ord), me = mapa(ent), mf = mapa(fac);
  return Array.from({ length: 12 }, (_, i) => ({
    mes: i + 1,
    ordenes: mo.get(i + 1) ?? 0,
    entradas: me.get(i + 1) ?? 0,
    facturado: mf.get(i + 1) ?? 0,
  }));
}

export interface Segmento { label: string; valor: number }

/**
 * Órdenes por MODELO DE COMPRA. El modelo vive en el catálogo de bodegas
 * (InvBodega.modeloCompra); las órdenes de bodegas sin catalogar caen en
 * "Sin modelo", igual que el "(En blanco)" del tablero de Power BI.
 */
export async function ordenesPorModeloCompra(f: FiltroCompras): Promise<Segmento[]> {
  const filas = await prisma.$queryRaw<{ label: string; valor: unknown }[]>`
    SELECT COALESCE(NULLIF(b."modeloCompra", ''), 'Sin modelo') AS label, SUM(m."valorNeto") AS valor
    FROM "CompraOrden" m LEFT JOIN "InvBodega" b ON b."codigo" = m."bodegaCodigo"
    WHERE ${whereOrdenes(f)}
    GROUP BY 1 ORDER BY 2 DESC`;
  return filas.map((r) => ({ label: r.label, valor: n(r.valor) }));
}

/** Entradas por compra abiertas por ciudad de la bodega. */
export async function entradasPorCiudad(f: FiltroCompras): Promise<Segmento[]> {
  const filas = await prisma.$queryRaw<{ label: string; valor: unknown }[]>`
    SELECT COALESCE(NULLIF(b."ciudad", ''), 'Sin ciudad') AS label, SUM(m."costoEntradas") AS valor
    FROM "InvMovimiento" m LEFT JOIN "InvBodega" b ON b."codigo" = m."bodegaCodigo"
    WHERE ${whereEntradas(f)}
    GROUP BY 1 HAVING SUM(m."costoEntradas") <> 0 ORDER BY 2 DESC`;
  return filas.map((r) => ({ label: r.label, valor: n(r.valor) }));
}

export interface FilaProveedor {
  proveedor: string;
  tipoCompra: string;
  ordenes: number;
  ordenesCant: number;
  pendiente: number;
  facturado: number;
  /** ATRIBUIDO por marca, no exacto. Ver `entradasPorProveedor`. */
  entradas: number;
}

/**
 * Puente marca → proveedor. El movimiento de inventario NO trae razón social,
 * solo la marca del producto ("1046 - STRYKER"), así que la única forma de
 * llevar las entradas a un proveedor es preguntarle a las órdenes, que sí
 * traen las dos columnas.
 *
 * Cuando una marca se le compró a varios proveedores gana el que más ordenó.
 * En 2026 eso pasa en 8 de 51 marcas, que pesan ~2 % del valor ordenado: la
 * atribución es buena para leer el reparto, pero NO es exacta como las otras
 * tres columnas, y por eso la pantalla la marca como estimada.
 */
export async function mapaMarcaProveedor(): Promise<Map<string, string>> {
  const filas = await prisma.$queryRaw<{ marca: string; proveedor: string }[]>`
    WITH pares AS (
      SELECT "marca", "proveedor", SUM("valorNeto") AS v
      FROM "CompraOrden" WHERE "marca" <> '' AND "proveedor" <> ''
      GROUP BY 1, 2
    ), ranked AS (
      SELECT "marca", "proveedor", ROW_NUMBER() OVER (PARTITION BY "marca" ORDER BY v DESC, "proveedor") AS rn
      FROM pares
    )
    SELECT "marca", "proveedor" FROM ranked WHERE rn = 1`;
  return new Map(filas.map((r) => [r.marca, r.proveedor]));
}

export interface EntradaProveedor {
  valor: number;
  unidades: number;
  /** true = parte del valor se dedujo por marca, no salió del documento. */
  estimado: boolean;
}

export interface EntradasAtribuidas {
  /** proveedor → entradas por compra del periodo. */
  porProveedor: Map<string, EntradaProveedor>;
  /** Entradas que no se pudieron atribuir a ningún proveedor. */
  sinIdentificar: number;
  /** Del total atribuido, cuánto salió del documento (exacto). */
  exacto: number;
  /** Del total atribuido, cuánto hubo que deducir por marca (aproximado). */
  porMarca: number;
}

/**
 * Entradas por compra repartidas por proveedor. Dos caminos, en este orden:
 *
 *   1. Por DOCUMENTO (exacto). El reporte "entradas por compra" dice a quién
 *      se le compró cada EPC/ECG; ese documento es el mismo de InvMovimiento.
 *   2. Por MARCA (aproximado), para los documentos que ese reporte no cubre
 *      todavía —hoy solo va de enero a julio de 2026—. Se le carga al
 *      proveedor que más ha ordenado la marca.
 *
 * El VALOR siempre sale de InvMovimiento, nunca del reporte de entradas: son
 * dos valoraciones distintas (costo promedio vs. precio del documento) y
 * mezclarlas daría cifras que no cuadran con el resto del informe.
 */
export async function entradasPorProveedor(f: FiltroCompras): Promise<EntradasAtribuidas> {
  const [grupos, mapa] = await Promise.all([
    prisma.$queryRaw<{ proveedor: string; marca: string; valor: unknown; unidades: unknown }[]>`
      SELECT COALESCE(ep."proveedor", '') AS proveedor, m."marca" AS marca,
             SUM(m."costoEntradas") AS valor, SUM(m."cantEntradas") AS unidades
      FROM "InvMovimiento" m
      LEFT JOIN "EntradaProveedor" ep ON ep."documento" = m."documento"
      WHERE ${whereEntradas(f)} GROUP BY 1, 2`,
    mapaMarcaProveedor(),
  ]);

  const porProveedor = new Map<string, EntradaProveedor>();
  let sinIdentificar = 0, exacto = 0, porMarca = 0;
  for (const r of grupos) {
    const valor = n(r.valor), unidades = n(r.unidades);
    if (!valor && !unidades) continue;

    const delDocumento = r.proveedor !== "";
    const proveedor = delDocumento ? r.proveedor : mapa.get(r.marca);
    if (!proveedor) { sinIdentificar += valor; continue; }

    if (delDocumento) exacto += valor; else porMarca += valor;
    const acc = porProveedor.get(proveedor) ?? { valor: 0, unidades: 0, estimado: false };
    acc.valor += valor; acc.unidades += unidades;
    if (!delDocumento) acc.estimado = true;
    porProveedor.set(proveedor, acc);
  }
  return { porProveedor, sinIdentificar, exacto, porMarca };
}

/**
 * Entradas del periodo respetando el filtro de proveedor / tipo de compra.
 * Sin esos filtros la cifra sale directo del movimiento y es EXACTA; con
 * ellos hay que pasar por la marca, y entonces es una aproximación. El flag
 * `estimado` es lo que la pantalla usa para no presentarla como exacta.
 */
async function entradasDelFiltro(f: FiltroCompras): Promise<{ valor: number; unidades: number; estimado: boolean }> {
  if (!f.proveedor?.length && !f.tipoCompra?.length) {
    const r = await prisma.$queryRaw<{ valor: unknown; unidades: unknown }[]>`
      SELECT COALESCE(SUM(m."costoEntradas"), 0) AS valor, COALESCE(SUM(m."cantEntradas"), 0) AS unidades
      FROM "InvMovimiento" m WHERE ${whereEntradas(f)}`;
    return { valor: n(r[0]?.valor), unidades: n(r[0]?.unidades), estimado: false };
  }

  const { porProveedor } = await entradasPorProveedor(f);
  let tipos: Map<string, string> | undefined;
  if (f.tipoCompra?.length) {
    const cat = await prisma.proveedorCompra.findMany({ select: { razonSocial: true, tipoCompra: true } });
    tipos = new Map(cat.map((t) => [t.razonSocial, t.tipoCompra]));
  }

  let valor = 0, unidades = 0, estimado = false;
  for (const [proveedor, e] of porProveedor) {
    if (f.proveedor?.length && !f.proveedor.includes(proveedor)) continue;
    if (f.tipoCompra?.length) {
      const t = tipos?.get(proveedor) ?? "";
      const coincide = f.tipoCompra.some((tc) => (tc === SIN_CLASIFICAR ? t === "" : t === tc));
      if (!coincide) continue;
    }
    valor += e.valor; unidades += e.unidades;
    if (e.estimado) estimado = true;
  }
  return { valor, unidades, estimado };
}

export interface TablaProveedores {
  filas: FilaProveedor[];
  /** Entradas que no se pudieron atribuir a ningún proveedor. */
  entradasSinIdentificar: number;
  /** Entradas atribuidas por documento (exactas). */
  entradasExacto: number;
  /** Entradas atribuidas por marca (aproximadas). */
  entradasPorMarca: number;
}

/** Tabla del informe: órdenes, pendiente, facturado y entradas por proveedor. */
export async function comprasPorProveedor(f: FiltroCompras): Promise<TablaProveedores> {
  const [ord, pen, fac, tipos] = await Promise.all([
    prisma.$queryRaw<{ proveedor: string; valor: unknown; cant: unknown }[]>`
      SELECT m."proveedor" AS proveedor, SUM(m."valorNeto") AS valor, COUNT(DISTINCT m."nroOrden") AS cant
      FROM "CompraOrden" m WHERE ${whereOrdenes(f)} GROUP BY 1`,
    prisma.$queryRaw<{ proveedor: string; valor: unknown }[]>`
      SELECT m."proveedor" AS proveedor, SUM(m."valorPendiente") AS valor
      FROM "CompraPendiente" m WHERE ${wherePendientes(f)} GROUP BY 1`,
    prisma.$queryRaw<{ proveedor: string; valor: unknown }[]>`
      SELECT m."proveedor" AS proveedor, SUM(m."valorNeto") AS valor
      FROM "CompraFactura" m WHERE ${whereFacturas(f)} GROUP BY 1`,
    prisma.proveedorCompra.findMany({ select: { razonSocial: true, tipoCompra: true } }),
  ]);

  const entradas = await entradasPorProveedor(f);

  const tipo = new Map(tipos.map((t) => [t.razonSocial, t.tipoCompra]));
  const out = new Map<string, FilaProveedor>();
  const fila = (p: string) => {
    let r = out.get(p);
    if (!r) {
      r = { proveedor: p, tipoCompra: tipo.get(p) || SIN_CLASIFICAR, ordenes: 0, ordenesCant: 0, pendiente: 0, facturado: 0, entradas: 0 };
      out.set(p, r);
    }
    return r;
  };
  for (const r of ord) { const x = fila(r.proveedor); x.ordenes = n(r.valor); x.ordenesCant = n(r.cant); }
  for (const r of pen) fila(r.proveedor).pendiente = n(r.valor);
  for (const r of fac) fila(r.proveedor).facturado = n(r.valor);

  // Con filtro de proveedor la tabla solo muestra esos proveedores: lo que se
  // les atribuya a los demás no cabe en la tabla y se contaría de más en el total.
  const entradasSinIdentificar = f.proveedor?.length ? 0 : entradas.sinIdentificar;
  for (const [proveedor, e] of entradas.porProveedor) {
    if (f.proveedor?.length && !f.proveedor.includes(proveedor)) continue;
    fila(proveedor).entradas = e.valor;
  }

  return {
    filas: [...out.values()].sort((a, b) => (b.ordenes + b.facturado) - (a.ordenes + a.facturado)),
    entradasSinIdentificar,
    entradasExacto: entradas.exacto,
    entradasPorMarca: entradas.porMarca,
  };
}

// ---------- Detalles ----------

export interface DetalleOrden {
  fechaOrden: Date; nroOrden: string; proveedor: string; bodegaCodigo: string; bodegaDesc: string;
  referencia: string; descItem: string; cantOrdenada: number; valorNeto: number;
  estado: string; linea: string; marca: string;
}

export async function detalleOrdenes(f: FiltroCompras, limite = 300): Promise<DetalleOrden[]> {
  const filas = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT m."fechaOrden", m."nroOrden", m."proveedor", m."bodegaCodigo", m."bodegaDesc",
           m."referencia", m."descItem", m."cantOrdenada", m."valorNeto", m."estado", m."linea", m."marca"
    FROM "CompraOrden" m WHERE ${whereOrdenes(f)}
    ORDER BY m."fechaOrden" DESC, m."nroOrden" DESC LIMIT ${limite}`;
  return filas.map((r) => ({
    fechaOrden: r.fechaOrden as Date, nroOrden: String(r.nroOrden), proveedor: String(r.proveedor),
    bodegaCodigo: String(r.bodegaCodigo), bodegaDesc: String(r.bodegaDesc),
    referencia: String(r.referencia), descItem: String(r.descItem),
    cantOrdenada: n(r.cantOrdenada), valorNeto: n(r.valorNeto),
    estado: String(r.estado), linea: String(r.linea), marca: String(r.marca),
  }));
}

export interface DetallePendiente {
  nroOrden: string; proveedor: string; itemResumen: string; bodegaCodigo: string; bodegaDesc: string;
  cantOrden: number; cantEntrada: number; cantPendiente: number; valorPendiente: number;
  fechaOrden: Date | null; fechaEntrega: Date | null; diasVencido: number | null; linea: string;
}

/**
 * Pendientes con los días de atraso frente a la fecha de entrega pactada.
 * `hoy` se pasa por parámetro para que la vista y el Excel den lo mismo.
 */
export async function detallePendientes(f: FiltroCompras, hoy: Date, limite = 500): Promise<DetallePendiente[]> {
  const filas = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT m."nroOrden", m."proveedor", m."itemResumen", m."bodegaCodigo", m."bodegaDesc",
           m."cantOrden", m."cantEntrada", m."cantPendiente", m."valorPendiente",
           m."fechaOrden", m."fechaEntrega", m."linea"
    FROM "CompraPendiente" m WHERE ${wherePendientes(f)}
    ORDER BY m."fechaEntrega" ASC NULLS LAST, m."valorPendiente" DESC LIMIT ${limite}`;
  const corte = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  return filas.map((r) => {
    const fechaEntrega = (r.fechaEntrega as Date | null) ?? null;
    return {
      nroOrden: String(r.nroOrden), proveedor: String(r.proveedor), itemResumen: String(r.itemResumen),
      bodegaCodigo: String(r.bodegaCodigo), bodegaDesc: String(r.bodegaDesc),
      cantOrden: n(r.cantOrden), cantEntrada: n(r.cantEntrada), cantPendiente: n(r.cantPendiente),
      valorPendiente: n(r.valorPendiente),
      fechaOrden: (r.fechaOrden as Date | null) ?? null,
      fechaEntrega,
      diasVencido: fechaEntrega ? Math.round((corte - fechaEntrega.getTime()) / 86_400_000) : null,
      linea: String(r.linea),
    };
  });
}

export interface DetalleFactura {
  nroDocumento: string; fecha: Date; proveedor: string; doctoProveedor: string; claseDocto: string;
  estado: string; valorBruto: number; valorImptos: number; valorNeto: number;
  valorRetenciones: number; valorCxp: number; notas: string;
}

export async function detalleFacturas(f: FiltroCompras, limite = 300): Promise<DetalleFactura[]> {
  const filas = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT m."nroDocumento", m."fecha", m."proveedor", m."doctoProveedor", m."claseDocto", m."estado",
           m."valorBruto", m."valorImptos", m."valorNeto", m."valorRetenciones", m."valorCxp", m."notas"
    FROM "CompraFactura" m WHERE ${whereFacturas(f)}
    ORDER BY m."fecha" DESC, m."nroDocumento" DESC LIMIT ${limite}`;
  return filas.map((r) => ({
    nroDocumento: String(r.nroDocumento), fecha: r.fecha as Date, proveedor: String(r.proveedor),
    doctoProveedor: String(r.doctoProveedor), claseDocto: String(r.claseDocto), estado: String(r.estado),
    valorBruto: n(r.valorBruto), valorImptos: n(r.valorImptos), valorNeto: n(r.valorNeto),
    valorRetenciones: n(r.valorRetenciones), valorCxp: n(r.valorCxp), notas: String(r.notas),
  }));
}

/** Facturado abierto por clase de documento (consignación vs proveedor). */
export async function facturadoPorClase(f: FiltroCompras): Promise<Segmento[]> {
  const filas = await prisma.$queryRaw<{ label: string; valor: unknown }[]>`
    SELECT COALESCE(NULLIF(m."claseDocto", ''), 'Sin clase') AS label, SUM(m."valorNeto") AS valor
    FROM "CompraFactura" m WHERE ${whereFacturas(f)}
    GROUP BY 1 ORDER BY 2 DESC`;
  return filas.map((r) => ({ label: r.label, valor: n(r.valor) }));
}

export interface FilaTipoCompra {
  tipo: string;
  ordenes: number;
  entradas: number;
  facturado: number;
}

/**
 * Reparto por TIPO DE COMPRA (MATERIAL DE OSTEOSÍNTESIS, ALTO COSTO,
 * INSUMOS…). El tipo es del PROVEEDOR, no del documento: sale de la hoja
 * "TIPOS DE PROVEEDORES" de las Tablas Auxiliares (tabla ProveedorCompra).
 *
 * Sin ese catálogo cargado todo cae en SIN CLASIFICAR — no es un error de
 * cálculo, es que falta el archivo.
 *
 * Las entradas se reparten con la misma atribución por marca que usa la
 * tabla por proveedor, así que también son aproximadas.
 */
export async function comprasPorTipoCompra(f: FiltroCompras): Promise<FilaTipoCompra[]> {
  const [ord, fac, entradas, cat] = await Promise.all([
    prisma.$queryRaw<{ tipo: string; valor: unknown }[]>`
      SELECT COALESCE(NULLIF(pc."tipoCompra", ''), ${SIN_CLASIFICAR}) AS tipo, SUM(m."valorNeto") AS valor
      FROM "CompraOrden" m LEFT JOIN "ProveedorCompra" pc ON pc."razonSocial" = m."proveedor"
      WHERE ${whereOrdenes(f)} GROUP BY 1`,
    prisma.$queryRaw<{ tipo: string; valor: unknown }[]>`
      SELECT COALESCE(NULLIF(pc."tipoCompra", ''), ${SIN_CLASIFICAR}) AS tipo, SUM(m."valorNeto") AS valor
      FROM "CompraFactura" m LEFT JOIN "ProveedorCompra" pc ON pc."razonSocial" = m."proveedor"
      WHERE ${whereFacturas(f)} GROUP BY 1`,
    entradasPorProveedor(f),
    prisma.proveedorCompra.findMany({ select: { razonSocial: true, tipoCompra: true } }),
  ]);

  const tipoDe = new Map(cat.map((c) => [c.razonSocial, c.tipoCompra || SIN_CLASIFICAR]));
  const out = new Map<string, FilaTipoCompra>();
  const fila = (t: string) => {
    let r = out.get(t);
    if (!r) { r = { tipo: t, ordenes: 0, entradas: 0, facturado: 0 }; out.set(t, r); }
    return r;
  };
  for (const r of ord) fila(r.tipo).ordenes += n(r.valor);
  for (const r of fac) fila(r.tipo).facturado += n(r.valor);
  for (const [proveedor, e] of entradas.porProveedor) {
    if (f.proveedor?.length && !f.proveedor.includes(proveedor)) continue;
    fila(tipoDe.get(proveedor) ?? SIN_CLASIFICAR).entradas += e.valor;
  }
  // Las entradas sin marca reconocible no tienen proveedor y por tanto tampoco tipo.
  if (!f.proveedor?.length && entradas.sinIdentificar) fila(SIN_CLASIFICAR).entradas += entradas.sinIdentificar;

  return [...out.values()].sort((a, b) => b.ordenes - a.ordenes);
}

/** Órdenes abiertas por estado (Cumplido / Aprobado / Parcial / En elaboración). */
export async function ordenesPorEstado(f: FiltroCompras): Promise<Segmento[]> {
  const filas = await prisma.$queryRaw<{ label: string; valor: unknown }[]>`
    SELECT COALESCE(NULLIF(m."estado", ''), 'Sin estado') AS label, SUM(m."valorNeto") AS valor
    FROM "CompraOrden" m WHERE ${whereOrdenes(f)}
    GROUP BY 1 ORDER BY 2 DESC`;
  return filas.map((r) => ({ label: r.label, valor: n(r.valor) }));
}

/** Fecha de la última carga de pendientes (la foto es de un día concreto). */
export async function corteDePendientes(): Promise<Date | null> {
  const r = await prisma.compraPendiente.aggregate({ _max: { cargadoEn: true } });
  return r._max.cargadoEn ?? null;
}

// ---------- Matriz proveedor × mes ----------

export interface FilaMatrizProveedor {
  proveedor: string;
  tipoCompra: string;
  /** 12 posiciones, enero a diciembre. */
  meses: number[];
  total: number;
}

export interface MatrizProveedorMes {
  filas: FilaMatrizProveedor[];
  totalMes: number[];
  total: number;
}

/**
 * Facturado por proveedor abierto mes a mes, para el año del filtro.
 *
 * Sale de CompraFactura (reporte de facturas de proveedor de SIESA). La
 * versión anterior de esta vista vivía en /ventas y se alimentaba de
 * DocumentoCxp, que NO es un reporte de compras sino el saldo de cuentas por
 * pagar: solo trae los documentos con saldo abierto, arrastra notas crédito
 * en negativo y llega hasta 2017. Por eso daba $1.840M para 2025 cuando lo
 * realmente facturado fueron $14.668M.
 */
export async function facturadoPorProveedorMes(f: FiltroCompras): Promise<MatrizProveedorMes> {
  const anual: FiltroCompras = { ...f, mes: undefined, dia: undefined };
  const [filas, tipos] = await Promise.all([
    prisma.$queryRaw<{ proveedor: string; mes: number; valor: unknown }[]>`
      SELECT m."proveedor" AS proveedor, m."mes" AS mes, SUM(m."valorNeto") AS valor
      FROM "CompraFactura" m WHERE ${whereFacturas(anual)} GROUP BY 1, 2`,
    prisma.proveedorCompra.findMany({ select: { razonSocial: true, tipoCompra: true } }),
  ]);

  const tipo = new Map(tipos.map((t) => [t.razonSocial, t.tipoCompra]));
  const mapa = new Map<string, FilaMatrizProveedor>();
  const totalMes = Array<number>(12).fill(0);
  let total = 0;

  for (const r of filas) {
    const mes = Number(r.mes);
    if (mes < 1 || mes > 12) continue;
    const valor = n(r.valor);
    let fila = mapa.get(r.proveedor);
    if (!fila) {
      fila = {
        proveedor: r.proveedor || "(sin proveedor)",
        tipoCompra: tipo.get(r.proveedor) || SIN_CLASIFICAR,
        meses: Array<number>(12).fill(0), total: 0,
      };
      mapa.set(r.proveedor, fila);
    }
    fila.meses[mes - 1] = (fila.meses[mes - 1] ?? 0) + valor;
    fila.total += valor;
    totalMes[mes - 1] = (totalMes[mes - 1] ?? 0) + valor;
    total += valor;
  }

  return {
    filas: [...mapa.values()].sort((a, b) => b.total - a.total),
    totalMes, total,
  };
}
