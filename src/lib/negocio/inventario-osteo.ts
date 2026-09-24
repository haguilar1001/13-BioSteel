// ==========================================================
// Consultas del inventario de material de osteosíntesis.
//
// Conciliar significa cruzar dos reportes de SIESA que miran lo mismo desde
// ángulos distintos: el BALANCE viene por instalación (101 propio · 102
// consignación · 106 aprovechamiento) y los MOVIMIENTOS por bodega. El puente
// es InvBodega.instalacion; sin él las cifras no se pueden comparar.
//
// Que un mes no cuadre casi siempre significa una de dos cosas:
//   · el export de movimientos es anterior al del balance (aparecen
//     documentos contabilizados en el intervalo) → el movimiento queda por
//     debajo del balance, y se arregla reexportando;
//   · una bodega quedó sin catalogar → su plata se va a la instalación
//     equivocada y las diferencias de 101 y 102 se compensan entre sí.
// ==========================================================
import "server-only";
import { prisma } from "@/lib/db";

/** Bajo este umbral (en pesos) se considera que el mes cuadra. */
export const UMBRAL = 1;

export const NOMBRE_INSTALACION: Record<number, string> = {
  101: "Propio",
  102: "Consignación",
  // La 103 apareció con el balance por bodega (bodega 203 "PRUEBA"). Nunca
  // tiene saldo, así que no va en los selectores; está aquí para que la
  // etiqueta exista si algún día lo tiene.
  103: "Prueba",
  104: "Préstamo",
  106: "Aprovechamiento",
};

/**
 * Instalaciones que sí mueven material: las que van en los selectores.
 * La 104 (préstamo, bodegas "…4P") entró al catálogo el 2026-09-02.
 */
export const INSTALACIONES_CON_MATERIAL = [101, 102, 104, 106] as const;

export const MES_CORTO = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const n = (v: unknown): number => (v == null ? 0 : Number(v));

/** Literal de texto escapado para interpolarlo en SQL. */
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`;

/** Instalaciones por las que se filtra una vista; vacío/undefined = todas. */
export type FiltroInstalacion = number[] | undefined;

/** Fragmento SQL para acotar por una o más instalaciones (números validados contra el catálogo). */
function soloInst(insts: FiltroInstalacion, col = "instalacion"): string {
  const validas = (insts ?? []).filter((i) => NOMBRE_INSTALACION[i]);
  return validas.length ? ` AND ${col} IN (${validas.join(",")})` : "";
}

/**
 * Recorte del saldo valorizado. `bodega` solo aplica a los meses cargados con
 * el export nuevo; los viejos tienen bodegaCodigo = "" (ver `mesesConBodega`).
 */
export interface FiltroSaldo {
  inst?: number[];
  bodega?: string[];
}

/** Fragmento SQL para acotar el balance por instalación y bodega. */
function soloSaldo(f: FiltroSaldo | undefined, pre = ""): string {
  if (!f) return "";
  const p = pre ? `${pre}.` : "";
  let s = soloInst(f.inst, `${p}instalacion`);
  if (f.bodega && f.bodega.length) s += ` AND ${p}"bodegaCodigo" IN (${f.bodega.map(lit).join(",")})`;
  return s;
}

export interface FilaConciliacion {
  mes: number;
  instalacion: number;
  balEntradas: number; movEntradas: number; difEntradas: number;
  balSalidas: number; movSalidas: number; difSalidas: number;
  cuadra: boolean;
  /** Hay movimientos pero el balance del mes todavía no se ha cargado. */
  sinBalance: boolean;
}

/** Años con balance cargado, del más viejo al más nuevo. */
export async function aniosConBalance(): Promise<number[]> {
  const filas = await prisma.invBalance.groupBy({ by: ["anio"], orderBy: { anio: "asc" } });
  return filas.map((f) => f.anio);
}

/** Conciliación mes × instalación de un año. */
export async function conciliacion(anio: number): Promise<FilaConciliacion[]> {
  const filas = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH bal AS (
      SELECT mes, instalacion,
             SUM("valorEntradas") AS ent, SUM("valorSalidas") AS sal
      FROM "InvBalance" WHERE anio = ${anio} GROUP BY mes, instalacion
    ), mov AS (
      SELECT m.mes, COALESCE(m.instalacion, b.instalacion) AS instalacion,
             SUM(m."costoEntradas") AS ent, SUM(m."costoSalidas") AS sal
      FROM "InvMovimiento" m JOIN "InvBodega" b ON b.codigo = m."bodegaCodigo"
      WHERE m.anio = ${anio} GROUP BY m.mes, COALESCE(m.instalacion, b.instalacion)
    )
    SELECT COALESCE(bal.mes, mov.mes) AS mes,
           COALESCE(bal.instalacion, mov.instalacion) AS instalacion,
           COALESCE(bal.ent, 0) AS bal_ent, COALESCE(bal.sal, 0) AS bal_sal,
           COALESCE(mov.ent, 0) AS mov_ent, COALESCE(mov.sal, 0) AS mov_sal
    FROM bal FULL OUTER JOIN mov
      ON bal.mes = mov.mes AND bal.instalacion = mov.instalacion
    ORDER BY 1, 2`;

  // Un mes con movimientos pero sin balance (el mes en curso) no es un
  // descuadre: todavía no hay contra qué compararlo.
  const conBalance = new Set(await mesesConBalance(anio));

  return filas.map((f) => {
    const balEntradas = n(f.bal_ent), movEntradas = n(f.mov_ent);
    const balSalidas = n(f.bal_sal), movSalidas = n(f.mov_sal);
    const difEntradas = movEntradas - balEntradas, difSalidas = movSalidas - balSalidas;
    const mes = n(f.mes);
    const sinBalance = !conBalance.has(mes);
    return {
      mes, instalacion: n(f.instalacion),
      balEntradas, movEntradas, difEntradas,
      balSalidas, movSalidas, difSalidas,
      cuadra: sinBalance || (Math.abs(difEntradas) < UMBRAL && Math.abs(difSalidas) < UMBRAL),
      sinBalance,
    };
  });
}

export interface FilaCadena {
  anio: number; mes: number;
  inicial: number; entradas: number; salidas: number; final: number;
  /** Saldo final del periodo anterior; null en el primero cargado. */
  finalAnterior: number | null;
  /** inicial − finalAnterior: si no da 0, se perdió un mes o el corte cambió. */
  saltoEnlace: number | null;
  /** (inicial + entradas − salidas) − final: si no da 0, el mes no es consistente. */
  saltoInterno: number;
  /** final − inicial: cuánto subió (+) o bajó (−) el inventario en el mes. */
  variacion: number;
}

/**
 * Cadena de saldos de todo lo cargado. Dos validaciones distintas:
 * que cada mes cierre solo, y que enlace con el mes anterior.
 */
export async function cadenaDeSaldos(inst?: FiltroInstalacion): Promise<FilaCadena[]> {
  const filas = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT anio, mes,
           SUM("valorInicial") AS ini, SUM("valorEntradas") AS ent,
           SUM("valorSalidas") AS sal, SUM("valorFinal") AS fin
    FROM "InvBalance" WHERE TRUE${soloInst(inst)}
    GROUP BY anio, mes ORDER BY anio, mes`);

  let anterior: number | null = null;
  return filas.map((f) => {
    const inicial = n(f.ini), entradas = n(f.ent), salidas = n(f.sal), final = n(f.fin);
    const fila: FilaCadena = {
      anio: n(f.anio), mes: n(f.mes), inicial, entradas, salidas, final,
      finalAnterior: anterior,
      saltoEnlace: anterior == null ? null : inicial - anterior,
      saltoInterno: inicial + entradas - salidas - final,
      variacion: final - inicial,
    };
    anterior = final;
    return fila;
  });
}

export interface FilaBodega {
  codigo: string; descripcion: string; ciudad: string;
  instalacion: number; modeloCompra: string; inferida: boolean;
  movimientos: number; entradas: number; salidas: number;
}

/** Movimientos de un mes agrupados por bodega (para ubicar una diferencia). */
export async function movimientosPorBodega(anio: number, mes: number): Promise<FilaBodega[]> {
  const filas = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT m."bodegaCodigo" AS codigo, b.descripcion, b.ciudad,
           COALESCE(m.instalacion, b.instalacion) AS instalacion,
           b."modeloCompra", b.inferida, COUNT(*) AS movs,
           SUM(m."costoEntradas") AS ent, SUM(m."costoSalidas") AS sal
    FROM "InvMovimiento" m JOIN "InvBodega" b ON b.codigo = m."bodegaCodigo"
    WHERE m.anio = ${anio} AND m.mes = ${mes}
    GROUP BY 1, 2, 3, 4, 5, 6
    ORDER BY (SUM(m."costoEntradas") + SUM(m."costoSalidas")) DESC`;

  return filas.map((f) => ({
    codigo: String(f.codigo), descripcion: String(f.descripcion ?? ""),
    ciudad: String(f.ciudad ?? ""), instalacion: n(f.instalacion),
    modeloCompra: String(f.modeloCompra ?? ""), inferida: Boolean(f.inferida),
    movimientos: n(f.movs), entradas: n(f.ent), salidas: n(f.sal),
  }));
}

export interface FilaReferencia {
  instalacion: number; referencia: string; descripcion: string;
  difEntradas: number; difSalidas: number; peso: number;
}

/**
 * Ítems donde el balance y los movimientos no coinciden, de mayor a menor.
 * Es el detalle accionable: con la referencia en mano se busca el documento
 * en SIESA.
 */
export async function diferenciasPorReferencia(anio: number, mes: number, limite = 50): Promise<FilaReferencia[]> {
  const filas = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH bal AS (
      SELECT instalacion, referencia, MAX(descripcion) AS descripcion,
             SUM("valorEntradas") AS ent, SUM("valorSalidas") AS sal
      FROM "InvBalance" WHERE anio = ${anio} AND mes = ${mes}
      GROUP BY instalacion, referencia
    ), mov AS (
      SELECT COALESCE(m.instalacion, b.instalacion) AS instalacion, m.referencia, MAX(m.descripcion) AS descripcion,
             SUM(m."costoEntradas") AS ent, SUM(m."costoSalidas") AS sal
      FROM "InvMovimiento" m JOIN "InvBodega" b ON b.codigo = m."bodegaCodigo"
      WHERE m.anio = ${anio} AND m.mes = ${mes}
      GROUP BY COALESCE(m.instalacion, b.instalacion), m.referencia
    ), j AS (
      SELECT COALESCE(bal.instalacion, mov.instalacion) AS instalacion,
             COALESCE(bal.referencia, mov.referencia) AS referencia,
             COALESCE(bal.descripcion, mov.descripcion) AS descripcion,
             COALESCE(mov.ent, 0) - COALESCE(bal.ent, 0) AS dif_ent,
             COALESCE(mov.sal, 0) - COALESCE(bal.sal, 0) AS dif_sal
      FROM bal FULL OUTER JOIN mov
        ON bal.instalacion = mov.instalacion AND bal.referencia = mov.referencia
    )
    SELECT * FROM j
    WHERE ABS(dif_ent) + ABS(dif_sal) >= ${UMBRAL}
    ORDER BY ABS(dif_ent) + ABS(dif_sal) DESC
    LIMIT ${limite}`;

  return filas.map((f) => {
    const difEntradas = n(f.dif_ent), difSalidas = n(f.dif_sal);
    return {
      instalacion: n(f.instalacion), referencia: String(f.referencia ?? ""),
      descripcion: String(f.descripcion ?? ""), difEntradas, difSalidas,
      peso: Math.abs(difEntradas) + Math.abs(difSalidas),
    };
  });
}

/** Cuántos ítems difieren en el mes (el detalle sale recortado por `limite`). */
export async function totalDiferencias(anio: number, mes: number): Promise<{ items: number; peso: number }> {
  const filas = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH bal AS (
      SELECT instalacion, referencia,
             SUM("valorEntradas") AS ent, SUM("valorSalidas") AS sal
      FROM "InvBalance" WHERE anio = ${anio} AND mes = ${mes}
      GROUP BY instalacion, referencia
    ), mov AS (
      SELECT COALESCE(m.instalacion, b.instalacion) AS instalacion, m.referencia,
             SUM(m."costoEntradas") AS ent, SUM(m."costoSalidas") AS sal
      FROM "InvMovimiento" m JOIN "InvBodega" b ON b.codigo = m."bodegaCodigo"
      WHERE m.anio = ${anio} AND m.mes = ${mes}
      GROUP BY COALESCE(m.instalacion, b.instalacion), m.referencia
    ), j AS (
      SELECT ABS(COALESCE(mov.ent, 0) - COALESCE(bal.ent, 0))
           + ABS(COALESCE(mov.sal, 0) - COALESCE(bal.sal, 0)) AS peso
      FROM bal FULL OUTER JOIN mov
        ON bal.instalacion = mov.instalacion AND bal.referencia = mov.referencia
    )
    SELECT COUNT(*) AS items, COALESCE(SUM(peso), 0) AS peso FROM j WHERE peso >= ${UMBRAL}`;
  const f = filas[0] ?? {};
  return { items: n(f.items), peso: n(f.peso) };
}

/** Meses de un año que tienen balance cargado. */
export async function mesesConBalance(anio: number): Promise<number[]> {
  const filas = await prisma.invBalance.groupBy({
    by: ["mes"], where: { anio }, orderBy: { mes: "asc" },
  });
  return filas.map((f) => f.mes);
}

/**
 * Meses de un año cuyo balance sí viene abierto por bodega. Los cargados con
 * el export viejo tienen bodegaCodigo = "" y no se pueden filtrar por bodega.
 */
export async function mesesConBodega(anio: number): Promise<number[]> {
  const filas = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT DISTINCT mes FROM "InvBalance"
    WHERE anio = ${anio} AND "bodegaCodigo" <> '' ORDER BY mes`;
  return filas.map((f) => n(f.mes));
}

export interface OpcionBodegaSaldo {
  codigo: string; descripcion: string; ciudad: string; instalacion: number;
  valor: number;
}

/**
 * Bodegas con saldo en el mes, de mayor a menor plata. Es el selector y a la
 * vez la respuesta a "cuánto material tengo en cada bodega".
 */
export async function bodegasConSaldo(anio: number, mes: number): Promise<OpcionBodegaSaldo[]> {
  const filas = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT b."bodegaCodigo" AS codigo, MAX(b.instalacion) AS instalacion,
           SUM(b."valorFinal") AS valor
    FROM "InvBalance" b
    WHERE b.anio = ${anio} AND b.mes = ${mes} AND b."bodegaCodigo" <> ''
    GROUP BY b."bodegaCodigo"
    ORDER BY SUM(b."valorFinal") DESC, b."bodegaCodigo"`;
  const cat = new Map((await prisma.invBodega.findMany({
    select: { codigo: true, descripcion: true, ciudad: true },
  })).map((b) => [b.codigo, b] as const));
  return filas.map((f) => {
    const codigo = String(f.codigo);
    const c = cat.get(codigo);
    return {
      codigo, descripcion: c?.descripcion ?? "sin nombre", ciudad: c?.ciudad ?? "",
      instalacion: n(f.instalacion), valor: n(f.valor),
    };
  });
}

// ---------- Inventario valorizado ----------

/** Dimensiones por las que se puede abrir el saldo (columnas del balance). */
export const DIMENSIONES = {
  bodegaCodigo: "Bodega",
  marca: "Marca",
  linea: "Línea",
  anatomia: "Anatomía",
  sistema: "Sistema",
  categoria: "Categoría",
} as const;
export type Dimension = keyof typeof DIMENSIONES;

export interface ResumenValorizado {
  valor: number; unidades: number; items: number;
  /** Saldo del mes anterior (0 si no hay). */
  valorAnterior: number;
  entradas: number; salidas: number;
  /** Ítems con existencia pero valorizados en $0. */
  itemsSinCosto: number; unidadesSinCosto: number;
}

/** KPIs del mes: saldo, movimiento y lo que no tiene costo. */
export async function resumenValorizado(anio: number, mes: number, filtro?: FiltroSaldo): Promise<ResumenValorizado> {
  const anterior = mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
  const filas = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT
      SUM("valorFinal") AS valor,
      SUM("cantFinal") AS unidades,
      COUNT(*) FILTER (WHERE "cantFinal" <> 0) AS items,
      SUM("valorEntradas") AS entradas,
      SUM("valorSalidas") AS salidas,
      COUNT(*) FILTER (WHERE "cantFinal" > 0 AND "valorFinal" = 0) AS items_sc,
      COALESCE(SUM("cantFinal") FILTER (WHERE "cantFinal" > 0 AND "valorFinal" = 0), 0) AS und_sc
    FROM "InvBalance" WHERE anio = ${anio} AND mes = ${mes}${soloSaldo(filtro)}`);
  const prev = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT SUM("valorFinal") AS valor FROM "InvBalance"
    WHERE anio = ${anterior.anio} AND mes = ${anterior.mes}${soloSaldo(filtro)}`);
  const f = filas[0] ?? {};
  return {
    valor: n(f.valor), unidades: n(f.unidades), items: n(f.items),
    valorAnterior: n(prev[0]?.valor),
    entradas: n(f.entradas), salidas: n(f.salidas),
    itemsSinCosto: n(f.items_sc), unidadesSinCosto: n(f.und_sc),
  };
}

export interface SaldoInstalacion { instalacion: number; valor: number; unidades: number; items: number }

export async function saldoPorInstalacion(anio: number, mes: number, f?: FiltroSaldo): Promise<SaldoInstalacion[]> {
  const filas = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT instalacion, SUM("valorFinal") AS valor, SUM("cantFinal") AS unidades,
           COUNT(*) FILTER (WHERE "cantFinal" <> 0) AS items
    FROM "InvBalance" WHERE anio = ${anio} AND mes = ${mes}${soloSaldo(f)}
    GROUP BY instalacion ORDER BY instalacion`);
  return filas.map((f) => ({
    instalacion: n(f.instalacion), valor: n(f.valor),
    unidades: n(f.unidades), items: n(f.items),
  }));
}

export interface SaldoDimension {
  label: string; valor: number; unidades: number; items: number;
  entradas: number; salidas: number;
  /** Meses de inventario: saldo ÷ salida mensual promedio del año. null si no rota. */
  mesesInventario: number | null;
}

/**
 * Saldo del mes abierto por una dimensión, con la rotación calculada sobre las
 * salidas del año corrido: un ítem con mucho saldo y poca salida es plata
 * quieta, y eso es lo que hay que poder ver.
 */
export async function saldoPorDimension(anio: number, mes: number, dim: Dimension, f?: FiltroSaldo): Promise<SaldoDimension[]> {
  // `dim` está acotado por el tipo Dimension; el nombre de columna nunca viene del usuario.
  const col = `"${dim}"`;
  const filas = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    WITH saldo AS (
      SELECT ${col} AS label, SUM("valorFinal") AS valor, SUM("cantFinal") AS unidades,
             COUNT(*) FILTER (WHERE "cantFinal" <> 0) AS items,
             SUM("valorEntradas") AS entradas, SUM("valorSalidas") AS salidas
      FROM "InvBalance" WHERE anio = $1 AND mes = $2${soloSaldo(f)} GROUP BY 1
    ), anual AS (
      SELECT ${col} AS label, SUM("valorSalidas") AS salidas_anio, COUNT(DISTINCT mes) AS meses
      FROM "InvBalance" WHERE anio = $1 AND mes <= $2${soloSaldo(f)} GROUP BY 1
    )
    SELECT s.label, s.valor, s.unidades, s.items, s.entradas, s.salidas,
           a.salidas_anio, a.meses
    FROM saldo s LEFT JOIN anual a ON a.label = s.label
    ORDER BY s.valor DESC`, anio, mes);

  // La bodega es un código: sin el nombre la tabla no se lee.
  const nombres = dim === "bodegaCodigo"
    ? new Map((await prisma.invBodega.findMany({ select: { codigo: true, descripcion: true, ciudad: true } }))
        .map((b) => [b.codigo, b.ciudad ? `${b.descripcion} · ${b.ciudad}` : b.descripcion] as const))
    : null;

  return filas.map((r) => {
    const valor = n(r.valor);
    const salidaMensual = n(r.meses) > 0 ? n(r.salidas_anio) / n(r.meses) : 0;
    const cod = String(r.label ?? "");
    const label = dim === "bodegaCodigo"
      ? (cod ? `${cod} · ${nombres?.get(cod) ?? "sin nombre"}` : "(mes sin detalle por bodega)")
      : String(r.label || "(sin clasificar)");
    return {
      label,
      valor, unidades: n(r.unidades), items: n(r.items),
      entradas: n(r.entradas), salidas: n(r.salidas),
      mesesInventario: salidaMensual > 0 ? valor / salidaMensual : null,
    };
  });
}

export interface PuntoMes { anio: number; mes: number; valor: number; unidades: number }

/** Serie del saldo final mes a mes, para ver la tendencia. */
export async function evolucionSaldo(f?: FiltroSaldo): Promise<PuntoMes[]> {
  const filas = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT anio, mes, SUM("valorFinal") AS valor, SUM("cantFinal") AS unidades
    FROM "InvBalance" WHERE TRUE${soloSaldo(f)}
    GROUP BY anio, mes ORDER BY anio, mes`);
  return filas.map((f) => ({
    anio: n(f.anio), mes: n(f.mes), valor: n(f.valor), unidades: n(f.unidades),
  }));
}

export interface ItemSaldo {
  item: string; referencia: string; descripcion: string;
  instalacion: number; marca: string;
  unidades: number; valor: number; costoUnit: number;
  /** Meses sin una sola salida (hasta el mes consultado, dentro del año). */
  mesesSinSalida: number;
  /** En cuántas bodegas está repartido; 0 si el mes no tiene detalle. */
  bodegas: number;
}

/**
 * Ítems de mayor saldo, con cuántos meses llevan sin salir. Es la lista para
 * atacar inventario quieto.
 */
export async function itemsConSaldo(anio: number, mes: number, limite = 100, f?: FiltroSaldo): Promise<ItemSaldo[]> {
  // Con el balance por bodega el mismo ítem aparece en varias bodegas; se
  // agrupa para que la lista sea de ítems y no de ubicaciones.
  const filas = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    WITH ult AS (
      SELECT item, instalacion, MAX(mes) AS ultimo_mov
      FROM "InvBalance"
      WHERE anio = ${anio} AND mes <= ${mes} AND "cantSalidas" > 0${soloSaldo(f)}
      GROUP BY item, instalacion
    ), saldo AS (
      SELECT b.item, b.instalacion, MAX(b.referencia) AS referencia,
             MAX(b.descripcion) AS descripcion, MAX(b.marca) AS marca,
             SUM(b."cantFinal") AS unidades, SUM(b."valorFinal") AS valor,
             COUNT(DISTINCT NULLIF(b."bodegaCodigo", '')) FILTER (WHERE b."cantFinal" <> 0) AS bodegas
      FROM "InvBalance" b
      WHERE b.anio = ${anio} AND b.mes = ${mes} AND b."cantFinal" > 0${soloSaldo(f, 'b')}
      GROUP BY b.item, b.instalacion
    )
    SELECT s.*, ${mes} - COALESCE(u.ultimo_mov, 0) AS sin_salida
    FROM saldo s LEFT JOIN ult u ON u.item = s.item AND u.instalacion = s.instalacion
    ORDER BY s.valor DESC
    LIMIT ${limite}`);

  return filas.map((r) => {
    const unidades = n(r.unidades), valor = n(r.valor);
    return {
      item: String(r.item), referencia: String(r.referencia ?? ""),
      descripcion: String(r.descripcion ?? ""), instalacion: n(r.instalacion),
      marca: String(r.marca ?? ""), unidades, valor,
      costoUnit: unidades > 0 ? valor / unidades : 0,
      mesesSinSalida: n(r.sin_salida),
      bodegas: n(r.bodegas),
    };
  });
}

// ---------- Movimientos (única vista que sí tiene bodega) ----------

export interface OpcionBodega {
  codigo: string; descripcion: string; ciudad: string;
  instalacion: number; modeloCompra: string;
}

/** Catálogo de bodegas para los selectores. */
export async function bodegas(): Promise<OpcionBodega[]> {
  const filas = await prisma.invBodega.findMany({
    orderBy: [{ ciudad: "asc" }, { descripcion: "asc" }],
    select: { codigo: true, descripcion: true, ciudad: true, instalacion: true, modeloCompra: true },
  });
  return filas;
}

export interface FiltroMovimientos {
  anio: number; mes?: number[];
  bodega?: string[]; instalacion?: number[]; tipoDoc?: string[];
  /**
   * Columna MARCA del export ("1003 - SAMPEDRO"). En SIESA la marca ES la casa
   * comercial que nos vende, así que este mismo campo es el proveedor: es el
   * mismo string que usa el Informe de Consumos.
   */
  marca?: string[];
}

/** Cláusula WHERE compartida por las consultas de movimientos. */
function whereMov(f: FiltroMovimientos): string {
  const p: string[] = [`m.anio = ${f.anio}`];
  if (f.mes && f.mes.length) p.push(`m.mes IN (${f.mes.join(",")})`);
  if (f.bodega && f.bodega.length) p.push(`m."bodegaCodigo" IN (${f.bodega.map(lit).join(",")})`);
  if (f.instalacion && f.instalacion.length) {
    const validas = f.instalacion.filter((i) => NOMBRE_INSTALACION[i]);
    if (validas.length) p.push(`COALESCE(m.instalacion, b.instalacion) IN (${validas.join(",")})`);
  }
  if (f.tipoDoc && f.tipoDoc.length) {
    const validos = f.tipoDoc.filter((t) => /^[A-Z]{3}$/.test(t));
    if (validos.length) p.push(`m."tipoDoc" IN (${validos.map(lit).join(",")})`);
  }
  if (f.marca && f.marca.length) p.push(`m.marca IN (${f.marca.map(lit).join(",")})`);
  return p.join(" AND ");
}

export interface SaldoPeriodo {
  /** Hay saldo que mostrar; si no, `motivo` dice por qué. */
  disponible: boolean;
  /** "bodega" = el mes se cargó sin detalle por bodega · "sin-balance" = mes no cargado. */
  motivo?: "bodega" | "sin-balance";
  inicial: number; final: number;
  /** Meses del año que el balance alcanza a cubrir dentro del filtro. */
  mesInicial: number; mesFinal: number;
}

/**
 * Saldo inicial y final del periodo filtrado, tomados del BALANCE y no de los
 * movimientos: los movimientos cargados arrancan en 2024-12 y no traen saldo
 * de apertura, así que acumularlos daría una cifra que no es el saldo.
 *
 * Con el export nuevo el balance ya trae bodega, así que el filtro de bodega
 * también da saldo — salvo en los meses cargados con el export viejo, que
 * quedaron a nivel instalación. El tipo de documento no aplica nunca: el
 * saldo es existencia, no flujo.
 */
export async function saldoDelPeriodo(f: FiltroMovimientos): Promise<SaldoPeriodo> {
  const vacio = { disponible: false, inicial: 0, final: 0, mesInicial: 0, mesFinal: 0 };

  const cond: string[] = [`anio = ${f.anio}`];
  if (f.mes && f.mes.length) cond.push(`mes IN (${f.mes.join(",")})`);
  if (f.instalacion && f.instalacion.length) {
    const validas = f.instalacion.filter((i) => NOMBRE_INSTALACION[i]);
    if (validas.length) cond.push(`instalacion IN (${validas.join(",")})`);
  }
  if (f.marca && f.marca.length) cond.push(`marca IN (${f.marca.map(lit).join(",")})`);
  if (f.bodega && f.bodega.length) cond.push(`"bodegaCodigo" IN (${f.bodega.map(lit).join(",")})`);
  const w = cond.join(" AND ");

  // El rango es el que alcanza el balance dentro del filtro: si se pide "todo
  // el año" y solo hay balance hasta julio, el saldo final es el de julio.
  const filas = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    WITH rango AS (SELECT MIN(mes) AS ini, MAX(mes) AS fin FROM "InvBalance" WHERE ${w})
    SELECT r.ini, r.fin,
      (SELECT COALESCE(SUM("valorInicial"), 0) FROM "InvBalance" WHERE ${w} AND mes = r.ini) AS v_ini,
      (SELECT COALESCE(SUM("valorFinal"), 0)   FROM "InvBalance" WHERE ${w} AND mes = r.fin) AS v_fin
    FROM rango r`);

  const r = filas[0];
  // Sin filas con bodega el mes puede existir igual, cargado con el export
  // viejo: hay que distinguirlo de "no hay balance del todo".
  if (!r || r.ini == null) return { ...vacio, motivo: f.bodega && f.bodega.length ? "bodega" : "sin-balance" };
  return {
    disponible: true, inicial: n(r.v_ini), final: n(r.v_fin),
    mesInicial: n(r.ini), mesFinal: n(r.fin),
  };
}

/** Proveedores (columna MARCA) con movimiento en el año, para el selector. */
export async function marcasConMovimientos(anio: number): Promise<string[]> {
  const filas = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT DISTINCT marca FROM "InvMovimiento"
    WHERE anio = ${anio} AND marca <> '' ORDER BY marca`;
  return filas.map((f) => String(f.marca));
}

export interface ResumenMovimientos {
  movimientos: number; documentos: number; referencias: number;
  cantEntradas: number; cantSalidas: number;
  costoEntradas: number; costoSalidas: number;
}

export async function resumenMovimientos(f: FiltroMovimientos): Promise<ResumenMovimientos> {
  const filas = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT COUNT(*) AS movs, COUNT(DISTINCT m.documento) AS docs,
           COUNT(DISTINCT m.referencia) AS refs,
           COALESCE(SUM(m."cantEntradas"), 0) AS qe, COALESCE(SUM(m."cantSalidas"), 0) AS qs,
           COALESCE(SUM(m."costoEntradas"), 0) AS ce, COALESCE(SUM(m."costoSalidas"), 0) AS cs
    FROM "InvMovimiento" m JOIN "InvBodega" b ON b.codigo = m."bodegaCodigo"
    WHERE ${whereMov(f)}`);
  const r = filas[0] ?? {};
  return {
    movimientos: n(r.movs), documentos: n(r.docs), referencias: n(r.refs),
    cantEntradas: n(r.qe), cantSalidas: n(r.qs),
    costoEntradas: n(r.ce), costoSalidas: n(r.cs),
  };
}

export interface FilaTipoDoc {
  tipoDoc: string; descripcion: string; movimientos: number;
  cantEntradas: number; cantSalidas: number;
  costoEntradas: number; costoSalidas: number;
}

/** Movimientos agrupados por tipo de documento (EPC, TIN, REM, AIN…). */
export async function movimientosPorTipo(f: FiltroMovimientos): Promise<FilaTipoDoc[]> {
  const filas = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT m."tipoDoc", MAX(m."descTipoDoc") AS descripcion, COUNT(*) AS movs,
           SUM(m."cantEntradas") AS qe, SUM(m."cantSalidas") AS qs,
           SUM(m."costoEntradas") AS ce, SUM(m."costoSalidas") AS cs
    FROM "InvMovimiento" m JOIN "InvBodega" b ON b.codigo = m."bodegaCodigo"
    WHERE ${whereMov(f)}
    GROUP BY m."tipoDoc"
    ORDER BY (SUM(m."costoEntradas") + SUM(m."costoSalidas")) DESC`);
  return filas.map((r) => ({
    tipoDoc: String(r.tipoDoc), descripcion: String(r.descripcion ?? ""),
    movimientos: n(r.movs), cantEntradas: n(r.qe), cantSalidas: n(r.qs),
    costoEntradas: n(r.ce), costoSalidas: n(r.cs),
  }));
}

/** Movimientos agrupados por bodega, con su ciudad e instalación. */
export async function movimientosPorBodegaFiltrado(f: FiltroMovimientos): Promise<FilaBodega[]> {
  const filas = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT m."bodegaCodigo" AS codigo, b.descripcion, b.ciudad,
           COALESCE(m.instalacion, b.instalacion) AS instalacion,
           b."modeloCompra", b.inferida, COUNT(*) AS movs,
           SUM(m."costoEntradas") AS ent, SUM(m."costoSalidas") AS sal
    FROM "InvMovimiento" m JOIN "InvBodega" b ON b.codigo = m."bodegaCodigo"
    WHERE ${whereMov(f)}
    GROUP BY 1, 2, 3, 4, 5, 6
    ORDER BY (SUM(m."costoEntradas") + SUM(m."costoSalidas")) DESC`);
  return filas.map((r) => ({
    codigo: String(r.codigo), descripcion: String(r.descripcion ?? ""),
    ciudad: String(r.ciudad ?? ""), instalacion: n(r.instalacion),
    modeloCompra: String(r.modeloCompra ?? ""), inferida: Boolean(r.inferida),
    movimientos: n(r.movs), entradas: n(r.ent), salidas: n(r.sal),
  }));
}

export interface FilaMovimiento {
  fecha: Date; documento: string; tipoDoc: string; descTipoDoc: string;
  bodegaCodigo: string; bodegaDesc: string; instalacion: number;
  referencia: string; descripcion: string; lote: string; marca: string;
  cantEntradas: number; cantSalidas: number;
  costoEntradas: number; costoSalidas: number; usuario: string; notas: string;
}

/** Detalle de movimientos, del más reciente al más viejo. */
export async function detalleMovimientos(f: FiltroMovimientos, limite = 300): Promise<FilaMovimiento[]> {
  const filas = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    SELECT m.fecha, m.documento, m."tipoDoc", m."descTipoDoc",
           m."bodegaCodigo", b.descripcion AS bodega_desc,
           COALESCE(m.instalacion, b.instalacion) AS instalacion,
           m.referencia, m.descripcion, m.lote, m.marca,
           m."cantEntradas", m."cantSalidas", m."costoEntradas", m."costoSalidas",
           m.usuario, m.notas
    FROM "InvMovimiento" m JOIN "InvBodega" b ON b.codigo = m."bodegaCodigo"
    WHERE ${whereMov(f)}
    ORDER BY m.fecha DESC, m.documento DESC
    LIMIT ${Math.max(1, Math.trunc(limite))}`);
  return filas.map((r) => ({
    fecha: r.fecha as Date, documento: String(r.documento),
    tipoDoc: String(r.tipoDoc), descTipoDoc: String(r.descTipoDoc ?? ""),
    bodegaCodigo: String(r.bodegaCodigo), bodegaDesc: String(r.bodega_desc ?? ""),
    instalacion: n(r.instalacion), referencia: String(r.referencia ?? ""),
    descripcion: String(r.descripcion ?? ""), lote: String(r.lote ?? ""),
    marca: String(r.marca ?? ""),
    cantEntradas: n(r.cantEntradas), cantSalidas: n(r.cantSalidas),
    costoEntradas: n(r.costoEntradas), costoSalidas: n(r.costoSalidas),
    usuario: String(r.usuario ?? ""), notas: String(r.notas ?? ""),
  }));
}

/** Años y meses con movimientos cargados. */
export async function aniosConMovimientos(): Promise<number[]> {
  const filas = await prisma.invMovimiento.groupBy({ by: ["anio"], orderBy: { anio: "asc" } });
  return filas.map((f) => f.anio);
}
export async function mesesConMovimientos(anio: number): Promise<number[]> {
  const filas = await prisma.invMovimiento.groupBy({
    by: ["mes"], where: { anio }, orderBy: { mes: "asc" },
  });
  return filas.map((f) => f.mes);
}
