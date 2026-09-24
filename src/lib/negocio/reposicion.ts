// ==========================================================
// AGENTE DE REPOSICIÓN — qué hay que comprar, referencia por referencia.
//
// No es una caja negra ni llama a ninguna API: es la fórmula clásica de punto
// de reorden, con todos los supuestos a la vista y editables desde la
// pantalla. Cada número de la tabla se puede reconstruir a mano con las
// columnas de la izquierda, que es justo lo que hace falta para que Compras
// pueda discutir una sugerencia en vez de tener que creerle.
//
// Las tres fuentes que cruza:
//   1. CONSUMO    Pedido.cantPedida en la ventana de análisis. Es la demanda
//                 real del bloque quirúrgico, no la venta facturada: lo que
//                 hay que reponer es lo que los cirujanos pidieron.
//   2. EXISTENCIA InvBalance del último mes cargado (cantFinal por
//                 referencia). Se prefiere al "Cant. existencia" del propio
//                 archivo de pedidos porque ese es una foto del momento del
//                 export y varía por bodega dentro del mismo archivo.
//                 El balance solo guarda filas con algún valor distinto de
//                 cero, así que una referencia ausente está en cero de verdad.
//   3. EN TRÁNSITO CompraPendiente.cantPendiente: lo ya ordenado al proveedor
//                 y todavía sin despachar. Sin esto el agente mandaría a
//                 comprar de nuevo lo que ya viene en camino.
//
// La fórmula:
//   consumo mensual (CPM) = consumo de la ventana / meses de la ventana
//   disponible            = existencia + en tránsito
//   punto de reorden      = CPM × (lead time + seguridad)
//   objetivo              = CPM × (lead time + seguridad + cobertura)
//   sugerido              = techo( max(0, objetivo − disponible) )
//
// Los tres parámetros —lead time, colchón de seguridad y cobertura objetivo—
// están en MESES y se ajustan en la pantalla. Los valores por defecto
// (1 / 0,5 / 2) son un punto de partida razonable para material de
// osteosíntesis importado, NO una medición: cuando Compras tenga el lead time
// real por proveedor, hay que subirlo aquí.
//
// EL MODELO DE COMPRA IMPORTA, y mucho. En jun-2026, el 81 % de lo pedido
// salió de bodegas PXP (se compra por procedimiento) y solo el 18 % de
// bodegas MAYORITARIO (se compra a stock). El punto de reorden es una regla
// de INVENTARIO: donde no se mantiene inventario a propósito, una referencia
// en cero no es una alarma, es el funcionamiento normal. Por eso cada fila
// trae el modelo de compra que concentra su consumo y la pantalla deja
// filtrar por él: leer la lista completa como si toda fuera reponible
// infla la sugerencia con material que nunca se tuvo en bodega.
//
// Lo que el agente todavía no sabe, y conviene tener presente al leerlo:
//   · el lead time es uno solo para todos los proveedores;
//   · no modela estacionalidad ni la variabilidad de la demanda (el colchón
//     de seguridad es fijo en meses, no un z×σ);
//   · una referencia que se pidió una sola vez en seis meses produce el mismo
//     CPM que una que se pide poquito todos los meses. Por eso la tabla trae
//     "meses con consumo": con 1 de 6, la sugerencia hay que mirarla dos
//     veces, y la pantalla lo marca.
// ==========================================================
import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

const n = (v: unknown): number => (v == null ? 0 : Number(v));

/**
 * Estados de pedido que cuentan como demanda real. Queda fuera "En
 * elaboración", que es un borrador y todavía puede no existir.
 */
const ESTADOS_DEMANDA = ["Cumplido", "Comprometido", "Comprometido parcial", "Aprobado"];

/** Etiqueta de las bodegas que el catálogo no clasifica. */
export const SIN_MODELO = "Sin modelo";

export interface ParametrosReposicion {
  /** Meses de historia que se promedian. */
  ventanaMeses: number;
  /** Meses entre poner la orden y recibir el material. */
  leadTimeMeses: number;
  /** Colchón sobre el lead time, en meses de consumo. */
  seguridadMeses: number;
  /** Meses de consumo que se quiere dejar en bodega al reponer. */
  coberturaMeses: number;
}

export const PARAMETROS_DEFECTO: ParametrosReposicion = {
  ventanaMeses: 6,
  leadTimeMeses: 1,
  seguridadMeses: 0.5,
  coberturaMeses: 2,
};

export interface FiltroReposicion {
  proveedor?: string[];
  marca?: string[];
  linea?: string[];
  ciudad?: string[];
  /** Modelo de compra de la bodega: MAYORITARIO, PXP, CONSIGNACIÓN… */
  modeloCompra?: string;
  /** 101 propia · 102 consignación · 106 aprovechamiento. */
  instalacion?: number;
}

/** Semáforo de la referencia, de más urgente a menos. */
export type EstadoRepo = "Agotado" | "Crítico" | "Bajo" | "OK" | "Exceso" | "Sin consumo";

/** Orden de urgencia, para priorizar la tabla. */
export const ORDEN_ESTADO: Record<EstadoRepo, number> = {
  Agotado: 0, "Crítico": 1, Bajo: 2, OK: 3, Exceso: 4, "Sin consumo": 5,
};

export interface FilaReposicion {
  referencia: string;
  descripcion: string;
  marca: string;
  proveedor: string;
  linea: string;
  /** Modelo de compra que concentra el consumo de esta referencia. */
  modelo: string;
  /** Unidades pedidas en la ventana. */
  consumo: number;
  /** Meses de la ventana en que hubo algún pedido (1..ventanaMeses). */
  mesesConConsumo: number;
  /** Consumo promedio mensual. */
  cpm: number;
  existencia: number;
  enTransito: number;
  disponible: number;
  /** Meses de consumo que alcanza el disponible. null = sin consumo. */
  cobertura: number | null;
  puntoReorden: number;
  sugerido: number;
  /** Costo unitario promedio de lo pedido con costo (>0). */
  costoUnitario: number;
  /** sugerido × costo unitario. */
  valorSugerido: number;
  /** Costo consumido en la ventana, base de la clasificación ABC. */
  valorConsumo: number;
  clase: "A" | "B" | "C";
  estado: EstadoRepo;
  /** Última vez que se pidió. */
  ultimoPedido: Date | null;
}

export interface PeriodoVentana { anio: number; mes: number }

export interface ResumenReposicion {
  referencias: number;
  aComprar: number;
  unidades: number;
  valorSugerido: number;
  agotadas: number;
  criticas: number;
  exceso: number;
  /** Referencias consumidas que no tienen ninguna existencia en el balance. */
  sinExistencia: number;
  /** Referencias con consumo en un solo mes de la ventana (dato flojo). */
  consumoEsporadico: number;
}

export interface ResultadoReposicion {
  filas: FilaReposicion[];
  /** Meses efectivamente incluidos en la ventana (el más viejo primero). */
  ventana: PeriodoVentana[];
  /** Mes del balance de inventario que se usó como existencia. */
  corteInventario: PeriodoVentana | null;
  /** true si hay pendientes por despacho cargados (si no, "en tránsito" es 0). */
  hayTransito: boolean;
  parametros: ParametrosReposicion;
  resumen: ResumenReposicion;
}

/** Los N meses anteriores (inclusive) al periodo dado. */
export function ventanaDeMeses(hasta: PeriodoVentana, meses: number): PeriodoVentana[] {
  const out: PeriodoVentana[] = [];
  let { anio, mes } = hasta;
  for (let i = 0; i < meses; i++) {
    out.unshift({ anio, mes });
    mes -= 1;
    if (mes === 0) { mes = 12; anio -= 1; }
  }
  return out;
}

/** Último periodo con pedidos cargados. null si no hay nada. */
export async function ultimoPeriodoPedidos(): Promise<PeriodoVentana | null> {
  const [r] = await prisma.$queryRaw<{ anio: number; mes: number }[]>`
    SELECT "anio", "mes" FROM "Pedido" ORDER BY "anio" DESC, "mes" DESC LIMIT 1`;
  return r ?? null;
}

/** Último balance de inventario cargado. null si no hay ninguno. */
export async function ultimoPeriodoBalance(): Promise<PeriodoVentana | null> {
  const [r] = await prisma.$queryRaw<{ anio: number; mes: number }[]>`
    SELECT "anio", "mes" FROM "InvBalance" ORDER BY "anio" DESC, "mes" DESC LIMIT 1`;
  return r ?? null;
}

/** Modelos de compra del catálogo de bodegas, para el selector. */
export async function modelosDeCompra(): Promise<string[]> {
  const filas = await prisma.invBodega.findMany({
    where: { modeloCompra: { not: "" } },
    distinct: ["modeloCompra"], select: { modeloCompra: true },
    orderBy: { modeloCompra: "asc" },
  });
  return filas.map((f) => f.modeloCompra);
}

/**
 * Calcula la sugerencia de compra. El trabajo pesado son cuatro consultas
 * agrupadas (consumo, consumo por bodega, existencia y tránsito) que se
 * cruzan en memoria por referencia: son ~4.000 referencias, y no vale la pena
 * un JOIN en SQL entre tablas que ni siquiera guardan la llave igual.
 */
export async function calcularReposicion(
  hasta: PeriodoVentana,
  parametros: ParametrosReposicion,
  filtro: FiltroReposicion = {},
): Promise<ResultadoReposicion> {
  const ventana = ventanaDeMeses(hasta, Math.max(1, Math.round(parametros.ventanaMeses)));
  const corte = await ultimoPeriodoBalance();

  // Catálogo de bodegas: da el modelo de compra de cada referencia y, si se
  // filtró por modelo, la lista de bodegas que hay que mirar.
  const bodegas = await prisma.invBodega.findMany({ select: { codigo: true, modeloCompra: true } });
  const modeloDeBodega = new Map(bodegas.map((b) => [b.codigo, b.modeloCompra || SIN_MODELO]));
  const codigosDelModelo = filtro.modeloCompra
    ? bodegas.filter((b) => (b.modeloCompra || SIN_MODELO) === filtro.modeloCompra).map((b) => b.codigo)
    : null;

  // Un modelo sin ninguna bodega no puede tener consumo: se sale temprano en
  // vez de mandar un IN vacío, que en SQL no compila.
  if (codigosDelModelo && codigosDelModelo.length === 0) {
    return {
      filas: [], ventana, corteInventario: corte, hayTransito: false, parametros,
      resumen: {
        referencias: 0, aComprar: 0, unidades: 0, valorSugerido: 0,
        agotadas: 0, criticas: 0, exceso: 0, sinExistencia: 0, consumoEsporadico: 0,
      },
    };
  }

  // --- WHERE del consumo ---
  // El periodo se compara como anio*100+mes para que la ventana pueda cruzar
  // el cambio de año sin partir la consulta en dos.
  const desde = ventana[0]!.anio * 100 + ventana[0]!.mes;
  const hastaClave = hasta.anio * 100 + hasta.mes;
  const cond: Prisma.Sql[] = [
    Prisma.sql`(m."anio" * 100 + m."mes") BETWEEN ${desde} AND ${hastaClave}`,
    Prisma.sql`m."estado" IN (${Prisma.join(ESTADOS_DEMANDA.map((e) => Prisma.sql`${e}`))})`,
  ];
  if (filtro.proveedor?.length) cond.push(Prisma.sql`m."proveedor" IN (${Prisma.join(filtro.proveedor)})`);
  if (filtro.marca?.length) cond.push(Prisma.sql`m."marca" IN (${Prisma.join(filtro.marca)})`);
  if (filtro.linea?.length) cond.push(Prisma.sql`m."linea" IN (${Prisma.join(filtro.linea)})`);
  if (filtro.ciudad?.length) cond.push(Prisma.sql`m."ciudad" IN (${Prisma.join(filtro.ciudad)})`);
  if (filtro.instalacion) cond.push(Prisma.sql`m."instalacion" = ${filtro.instalacion}`);
  if (codigosDelModelo) {
    cond.push(Prisma.sql`m."bodegaCodigo" IN (${Prisma.join(codigosDelModelo.map((c) => Prisma.sql`${c}`))})`);
  }
  const whereConsumo = Prisma.join(cond, " AND ");

  // --- 1) Consumo por referencia en la ventana ---
  const consumo = await prisma.$queryRaw<{
    referencia: string; cant: unknown; costo: unknown; cantConCosto: unknown;
    meses: unknown; ultimo: Date | null;
    descripcion: string | null; marca: string | null; proveedor: string | null; linea: string | null;
  }[]>`
    SELECT m."referencia" AS referencia,
           COALESCE(SUM(m."cantPedida"), 0) AS cant,
           COALESCE(SUM(m."costoProm"), 0)  AS costo,
           COALESCE(SUM(CASE WHEN m."costoProm" > 0 THEN m."cantPedida" ELSE 0 END), 0) AS "cantConCosto",
           COUNT(DISTINCT (m."anio" * 100 + m."mes")) AS meses,
           MAX(m."fecha") AS ultimo,
           (array_agg(m."descItem"  ORDER BY m."fecha" DESC))[1] AS descripcion,
           (array_agg(m."marca"     ORDER BY m."fecha" DESC))[1] AS marca,
           (array_agg(m."proveedor" ORDER BY m."fecha" DESC))[1] AS proveedor,
           (array_agg(m."linea"     ORDER BY m."fecha" DESC))[1] AS linea
    FROM "Pedido" m
    WHERE ${whereConsumo}
    GROUP BY m."referencia"`;

  // --- 2) Modelo de compra dominante de cada referencia ---
  // El modelo vive en la bodega, no en el pedido: una misma referencia puede
  // salir de una bodega a stock y de otra por procedimiento. Se le asigna el
  // modelo por el que pasó MÁS unidades, que es el que decide cómo se compra.
  const porBodega = await prisma.$queryRaw<{ referencia: string; bodega: string; cant: unknown }[]>`
    SELECT m."referencia" AS referencia, m."bodegaCodigo" AS bodega,
           COALESCE(SUM(m."cantPedida"), 0) AS cant
    FROM "Pedido" m
    WHERE ${whereConsumo}
    GROUP BY 1, 2`;
  const acumModelo = new Map<string, Map<string, number>>();
  for (const r of porBodega) {
    const modelo = modeloDeBodega.get(r.bodega) ?? SIN_MODELO;
    const m = acumModelo.get(r.referencia) ?? new Map<string, number>();
    m.set(modelo, (m.get(modelo) ?? 0) + n(r.cant));
    acumModelo.set(r.referencia, m);
  }
  const modeloDominante = new Map<string, string>();
  for (const [ref, m] of acumModelo) {
    modeloDominante.set(ref, [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0]);
  }

  // --- 3) Existencia del último balance ---
  const existencias = new Map<string, number>();
  if (corte) {
    const filas = await prisma.$queryRaw<{ referencia: string; cant: unknown }[]>`
      SELECT b."referencia" AS referencia, COALESCE(SUM(b."cantFinal"), 0) AS cant
      FROM "InvBalance" b
      WHERE b."anio" = ${corte.anio} AND b."mes" = ${corte.mes}
        ${filtro.instalacion ? Prisma.sql`AND b."instalacion" = ${filtro.instalacion}` : Prisma.empty}
      GROUP BY b."referencia"`;
    for (const f of filas) existencias.set(f.referencia, n(f.cant));
  }

  // --- 4) En tránsito (pendiente por despachar) ---
  // CompraPendiente no guarda la referencia aparte: viene pegada al inicio de
  // "Item resumen" ("112227 MATRIZ BASE RIO"), así que se corta por el primer
  // espacio, que es como SIESA arma esa columna.
  const transito = new Map<string, number>();
  const pend = await prisma.$queryRaw<{ referencia: string; cant: unknown }[]>`
    SELECT split_part(p."itemResumen", ' ', 1) AS referencia,
           COALESCE(SUM(p."cantPendiente"), 0) AS cant
    FROM "CompraPendiente" p
    WHERE p."itemResumen" <> ''
    GROUP BY 1`;
  for (const f of pend) if (f.referencia) transito.set(f.referencia, n(f.cant));

  // --- 5) Cruce y fórmula ---
  const meses = ventana.length;
  const { leadTimeMeses: lt, seguridadMeses: ss, coberturaMeses: cob } = parametros;
  const filas: FilaReposicion[] = consumo.map((c) => {
    const cant = n(c.cant);
    const cantConCosto = n(c.cantConCosto);
    const costoUnitario = cantConCosto > 0 ? n(c.costo) / cantConCosto : 0;
    const cpm = cant / meses;
    const existencia = existencias.get(c.referencia) ?? 0;
    const enTransito = transito.get(c.referencia) ?? 0;
    const disponible = existencia + enTransito;
    const puntoReorden = cpm * (lt + ss);
    const objetivo = cpm * (lt + ss + cob);
    const sugerido = Math.max(0, Math.ceil(objetivo - disponible));
    const cobertura = cpm > 0 ? disponible / cpm : null;

    let estado: EstadoRepo;
    if (cpm <= 0) estado = "Sin consumo";
    else if (disponible <= 0) estado = "Agotado";
    else if (disponible < puntoReorden) estado = "Crítico";
    else if (sugerido > 0) estado = "Bajo";
    // El doble del objetivo es la línea de "esto ya sobra": no dispara una
    // acción, pero es la lista por la que hay que empezar a preguntar.
    else if (cobertura != null && cobertura > (lt + ss + cob) * 2) estado = "Exceso";
    else estado = "OK";

    return {
      referencia: c.referencia,
      descripcion: c.descripcion ?? "",
      marca: c.marca ?? "",
      proveedor: c.proveedor ?? "",
      linea: c.linea ?? "",
      modelo: modeloDominante.get(c.referencia) ?? SIN_MODELO,
      consumo: cant,
      mesesConConsumo: n(c.meses),
      cpm,
      existencia, enTransito, disponible, cobertura,
      puntoReorden, sugerido,
      costoUnitario,
      valorSugerido: sugerido * costoUnitario,
      valorConsumo: n(c.costo),
      clase: "C",
      estado,
      ultimoPedido: c.ultimo ?? null,
    };
  });

  // --- 6) Clasificación ABC sobre el costo consumido (Pareto 80/95) ---
  const totalValor = filas.reduce((s, f) => s + f.valorConsumo, 0);
  const porValor = [...filas].sort((a, b) => b.valorConsumo - a.valorConsumo);
  let acumulado = 0;
  for (const f of porValor) {
    acumulado += f.valorConsumo;
    const pct = totalValor > 0 ? acumulado / totalValor : 1;
    f.clase = pct <= 0.8 ? "A" : pct <= 0.95 ? "B" : "C";
  }

  // Prioridad: primero lo más urgente, y dentro de cada estado lo que más
  // plata mueve. Así la primera pantalla ya es la orden de compra del día.
  filas.sort((a, b) =>
    ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] ||
    b.valorSugerido - a.valorSugerido ||
    b.valorConsumo - a.valorConsumo);

  const aComprar = filas.filter((f) => f.sugerido > 0);
  return {
    filas, ventana, corteInventario: corte, hayTransito: transito.size > 0, parametros,
    resumen: {
      referencias: filas.length,
      aComprar: aComprar.length,
      unidades: aComprar.reduce((s, f) => s + f.sugerido, 0),
      valorSugerido: aComprar.reduce((s, f) => s + f.valorSugerido, 0),
      agotadas: filas.filter((f) => f.estado === "Agotado").length,
      criticas: filas.filter((f) => f.estado === "Crítico").length,
      exceso: filas.filter((f) => f.estado === "Exceso").length,
      sinExistencia: filas.filter((f) => f.existencia === 0).length,
      consumoEsporadico: filas.filter((f) => f.mesesConConsumo <= 1).length,
    },
  };
}

export interface FilaProveedorRepo {
  proveedor: string;
  referencias: number;
  unidades: number;
  valor: number;
  agotadas: number;
  criticas: number;
}

/** Resumen de lo sugerido agrupado por proveedor: la orden de compra por hacer. */
export function sugerenciaPorProveedor(filas: FilaReposicion[]): FilaProveedorRepo[] {
  const mapa = new Map<string, FilaProveedorRepo>();
  for (const f of filas) {
    if (f.sugerido <= 0) continue;
    const k = f.proveedor || "(sin proveedor)";
    const e = mapa.get(k) ?? { proveedor: k, referencias: 0, unidades: 0, valor: 0, agotadas: 0, criticas: 0 };
    e.referencias += 1;
    e.unidades += f.sugerido;
    e.valor += f.valorSugerido;
    if (f.estado === "Agotado") e.agotadas += 1;
    if (f.estado === "Crítico") e.criticas += 1;
    mapa.set(k, e);
  }
  return [...mapa.values()].sort((a, b) => b.valor - a.valor);
}

/** Reparto de lo sugerido por modelo de compra, para leer la lista con criterio. */
export function sugerenciaPorModelo(filas: FilaReposicion[]): { modelo: string; referencias: number; unidades: number; valor: number }[] {
  const mapa = new Map<string, { modelo: string; referencias: number; unidades: number; valor: number }>();
  for (const f of filas) {
    if (f.sugerido <= 0) continue;
    const e = mapa.get(f.modelo) ?? { modelo: f.modelo, referencias: 0, unidades: 0, valor: 0 };
    e.referencias += 1;
    e.unidades += f.sugerido;
    e.valor += f.valorSugerido;
    mapa.set(f.modelo, e);
  }
  return [...mapa.values()].sort((a, b) => b.valor - a.valor);
}
