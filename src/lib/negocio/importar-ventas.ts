// ==========================================================
// Parser del reporte SIESA "FACTURAS POR ITEM" → agregados de venta neta.
//
// Normaliza cada renglón, corre el motor de Notas Crédito (nota-credito.ts) y
// pre-agrega a [anio,mes,línea] y [anio,mes,cliente] con la venta NETA
// (subtotal − NOTA_CREDITO) y el costo. Módulo PURO (sin server-only): lo usan
// el script de carga (prisma/set-ventas.ts) y el importador in-app.
// ==========================================================
import * as XLSX from "xlsx";
import { ipsDe, notaCredito, type VentaRow, type ParamNC, type CtxNC } from "./nota-credito";
import { nombreLista } from "./listas-precio";

/** Renglón normalizado: lo del motor + campos para agregar (costo/cliente/nit). */
export interface FilaVenta extends VentaRow {
  costo: number;
  cliente: string;
  nit: string | null;
  marca: string;
  referencia: string; // código del ítem (SIESA "Referencia")
  cantidad: number;   // unidades del renglón (SIESA "Cantidad")
  lista: string;      // "Desc. lista de precios": la tarifa aplicada
}

/**
 * Instalación de la bodega que despachó, a partir del texto de "Desc.
 * bodega" del reporte de ventas (no trae código, solo el nombre). Se cruza
 * contra el mismo catálogo InvBodega de Compras/Osteosíntesis por
 * descripción normalizada — es el mismo bodegaje, dos reportes distintos.
 *
 * Cuatro bodegas de ventas no calzan letra por letra contra su nombre en el
 * catálogo (abreviaciones o una palabra de más/menos); se resuelven a mano
 * aquí. Verificado el 2026-09-09: cubren el 100 % de las ~290 mil filas de
 * VentaDoc — nunca ha aparecido una bodega de ventas que el catálogo no
 * reconozca ni por su nombre exacto ni por este alias.
 */
const ALIAS_BODEGA_VENTAS: Record<string, string> = {
  "SEDE SAN FERNANDO": "BODEGA SAN FERNANDO",
  "UNIDAD MEDICA TRAUMA DEL VALLE": "BODEGA UNDIDAD MEDICA TRAUMA DEL VALLE",
  "VALLE SALUD SEDE NORTE": "BODEGA VALLE SALUD NORTE",
  "VALLE SALUD SEDE SUR": "BODEGA VALLE  SALUD SUR",
};

/** "Bodega X" → "BODEGA X", sin tildes ni espacios repetidos, para cruzar contra el catálogo. */
export function normalizaBodega(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

/**
 * Arma el mapa "descripción de bodega normalizada" → instalación, listo
 * para resolverInstalacion(). Se construye una sola vez por carga a partir
 * del catálogo InvBodega (el mismo que ya usan Compras/Osteosíntesis).
 */
export function mapaInstalacionPorBodega(catalogo: { descripcion: string; instalacion: number }[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const b of catalogo) mapa.set(normalizaBodega(b.descripcion), b.instalacion);
  for (const [alias, real] of Object.entries(ALIAS_BODEGA_VENTAS)) {
    const inst = mapa.get(normalizaBodega(real));
    if (inst != null) mapa.set(normalizaBodega(alias), inst);
  }
  return mapa;
}

/** Instalación de un renglón por su "Desc. bodega"; null si la bodega no cruza. */
export function resolverInstalacion(bod: string, mapa: Map<string, number>): number | null {
  if (!bod) return null;
  return mapa.get(normalizaBodega(bod)) ?? null;
}

/** "$ 1,234.00" / "(1,234)" → número. Tolerante a formato es-CO con símbolo. */
export function limpiarMonto(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const bruto = String(v).trim();
  // El libro se lee con raw:false, o sea que llega el TEXTO ya formateado por
  // Excel. Una celda con formato de porcentaje muestra "200%" cuando su valor
  // real es 2: si solo se le quita el símbolo, la cifra queda multiplicada por
  // cien. Pasó con la columna Cantidad del archivo de ventas 2026, donde los
  // dos valores más frecuentes (1 y 2 unidades) llegaron como 100 y 200.
  const esPorcentaje = bruto.includes("%");
  const s = bruto.replace(/\(/g, "-").replace(/\)/g, "").replace(/[^0-9.\-]/g, "");
  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  return esPorcentaje ? n / 100 : n;
}

/**
 * Detector de la columna Cantidad multiplicada por cien.
 *
 * Las cantidades reales son 1, 2, 6, 14 unidades: que TODAS sean múltiplos
 * exactos de 100 no pasa por azar. Cuando la columna sale del Excel con
 * formato de porcentaje, la cifra se infla ×100 y un tornillo aparece como
 * 100 — pasó con los archivos del 29, 30 y 31 de julio, el 31 de agosto y el
 * 1 de septiembre de 2026, y cada vez se descubrió semanas después, mirando
 * un informe que ya nadie creía.
 *
 * Devuelve null cuando el archivo se ve normal. El umbral es deliberadamente
 * alto (90 % de los renglones con cantidad, mínimo 20) porque un falso
 * positivo frena una carga legítima.
 */
export function cantidadesSospechosas(filas: { cantidad: number }[]): { conCantidad: number; multiplos: number } | null {
  const conCantidad = filas.filter((f) => f.cantidad !== 0).length;
  if (conCantidad < 20) return null;
  const multiplos = filas.filter((f) => f.cantidad !== 0 && Number.isInteger(f.cantidad / 100)).length;
  return multiplos / conCantidad >= 0.9 ? { conCantidad, multiplos } : null;
}

/** Fecha SIESA en formato M/D/AA (americano) → { ms, anio, mes }. */
export function parseFechaMDY(v: unknown): { ms: number; anio: number; mes: number } | null {
  const m = String(v ?? "").trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let y = Number(m[3]); if (y < 100) y += 2000;
  const mes = Number(m[1]), dia = Number(m[2]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return { ms: Date.UTC(y, mes - 1, dia), anio: y, mes };
}

export interface RenglonesLeidos {
  filas: FilaVenta[];
  sinFecha: number;
  hoja: string;
}

/** Lee el workbook (primera hoja) y devuelve los renglones normalizados. */
export function leerRenglones(buffer: Buffer | ArrayBuffer): RenglonesLeidos {
  const wb = XLSX.read(buffer, { dense: true });
  const nombreHoja = wb.SheetNames[0]!;
  const ws = wb.Sheets[nombreHoja]!;
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: null });
  const H = (aoa[0] as unknown[] ?? []).map((h) => String(h ?? "").trim());
  const ix = (n: string) => H.indexOf(n);
  // Lista de precios. SIESA exporta DOS columnas contiguas: "Lista de precios"
  // con el código (4, 14, 999…) y "Desc. lista de precios" con el nombre. Por
  // eso se buscan en ORDEN DE PREFERENCIA y no con un findIndex que acepte
  // cualquiera: así se agarraba la que apareciera primero en el archivo, que
  // es la del código, y la pantalla mostraba números en vez de nombres.
  // Si no está ninguna, la columna queda vacía y la pantalla lo muestra como
  // "(sin lista)" en vez de fallar la carga.
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
  const CANDIDATAS_LISTA = ["desclistadeprecios", "desclistaprecios", "listadeprecios"];
  let ixLista = -1;
  for (const cand of CANDIDATAS_LISTA) {
    const i = H.findIndex((h) => norm(h) === cand);
    if (i >= 0) { ixLista = i; break; }
  }
  const C = {
    doc: ix("Nro documento"), est: ix("Estado"), fecha: ix("Fecha"),
    nit: ix("Cliente factura"), cli: ix("Razón social cliente despacho"),
    suc: ix("Desc. sucursal factura"), bod: ix("Desc. bodega"), notas: ix("Notas ítem"),
    conv: ix("Convenio"), costo: ix("Costo promedio total"), sub: ix("Valor subtotal local"),
    proc: ix("Procedimiento"), linea: ix("LÍNEA"), fbd: ix("Factura base devolución"),
    marca: ix("MARCA"), ref: ix("Referencia"), cant: ix("Cantidad"),
  };
  if (C.doc < 0 || C.fecha < 0 || C.sub < 0) {
    throw new Error("No parece un reporte SIESA de ventas: faltan columnas 'Nro documento' / 'Fecha' / 'Valor subtotal local'.");
  }
  const up = (v: unknown) => (v == null ? "" : String(v).toUpperCase());
  const filas: FilaVenta[] = [];
  let sinFecha = 0;

  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i] as unknown[] | undefined;
    if (!r) continue;
    const f = parseFechaMDY(r[C.fecha]);
    if (!f) { sinFecha++; continue; }
    const nro = String(r[C.doc] ?? "");
    const cliente = String(r[C.cli] ?? "").trim();
    filas.push({
      nro,
      tipo: nro.split("-")[0] ?? "",
      aprobada: String(r[C.est] ?? "").trim() === "Aprobada",
      ms: f.ms, anio: f.anio, mes: f.mes,
      ips: ipsDe(cliente),
      suc: up(r[C.suc]), bod: up(r[C.bod]), notas: up(r[C.notas]), conv: up(r[C.conv]),
      proc: up(r[C.proc]), linea: String(r[C.linea] ?? "").trim(),
      subtotal: limpiarMonto(r[C.sub]),
      fbd: String(r[C.fbd] ?? ""),
      costo: limpiarMonto(r[C.costo]),
      cliente: cliente || "(sin cliente)",
      nit: C.nit >= 0 && r[C.nit] != null ? String(r[C.nit]).trim() : null,
      marca: (C.marca >= 0 ? String(r[C.marca] ?? "").trim() : "") || "(sin marca)",
      referencia: C.ref >= 0 ? String(r[C.ref] ?? "").trim() : "",
      cantidad: C.cant >= 0 ? limpiarMonto(r[C.cant]) : 0,
      lista: ixLista >= 0 ? String(r[ixLista] ?? "").trim() : "",
    });
  }
  return { filas, sinFecha, hoja: nombreHoja };
}

export interface FilaLineaAgg { anio: number; mes: number; linea: string; valor: number; costo: number }
export interface FilaClienteAgg { anio: number; mes: number; clienteNombre: string; nit: string | null; valor: number; costo: number }
export interface FilaMarcaAgg { anio: number; mes: number; marca: string; valor: number; costo: number }
export interface FilaMarcaIpsAgg { anio: number; mes: number; marca: string; ips: string; valor: number; costo: number }
export interface FilaItemAgg { anio: number; mes: number; marca: string; referencia: string; descripcion: string; cantidad: number; valor: number; costo: number }
export interface FilaItemIpsAgg extends FilaItemAgg {
  ips: string; nit: string | null; lista: string;
  /** Instalación de la bodega que despachó; null si no cruzó contra el catálogo. */
  instalacion: number | null;
}
export interface FilaDiaAgg { anio: number; mes: number; dia: number; valor: number; costo: number }

export interface AgregadosVenta {
  anios: number[];
  porLinea: FilaLineaAgg[];
  porCliente: FilaClienteAgg[];
  porMarca: FilaMarcaAgg[];
  porMarcaIps: FilaMarcaIpsAgg[];
  porItem: FilaItemAgg[];
  porItemIps: FilaItemIpsAgg[];
  porDia: FilaDiaAgg[];
  /** Venta neta total por año. */
  netoPorAnio: Map<number, number>;
  totalNC: number;
  renglones: number;
}

/** Construye el mapa de NAN vinculadas (FET → meses de sus NAN). */
function construirNanMeses(filas: FilaVenta[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const r of filas) {
    if (r.tipo !== "NAN" || !r.fbd || r.fbd === "0") continue;
    let s = m.get(r.fbd);
    if (!s) { s = new Set(); m.set(r.fbd, s); }
    s.add(`${r.anio}-${r.mes}`);
  }
  return m;
}

/**
 * Corre el motor de NC y pre-agrega la venta NETA por línea×mes y cliente×mes.
 * `venta neta = Σ(Valor subtotal local) − Σ(NOTA_CREDITO)` (todos los renglones;
 * NC sólo en FET). Aplica los parámetros y las exclusiones dados.
 */
export function agregarVentas(
  filas: FilaVenta[], params: ParamNC[], excluidos: Set<string>,
  mapaInstalacion: Map<string, number> = new Map(),
): AgregadosVenta {
  const ctx: CtxNC = { params, nanMeses: construirNanMeses(filas), excluidos };
  const porLinea = new Map<string, FilaLineaAgg>();
  const porCliente = new Map<string, FilaClienteAgg>();
  const porMarca = new Map<string, FilaMarcaAgg>();
  const porMarcaIps = new Map<string, FilaMarcaIpsAgg>();
  const porItem = new Map<string, FilaItemAgg>();
  const porItemIps = new Map<string, FilaItemIpsAgg>();
  const porDia = new Map<string, FilaDiaAgg>();
  const anios = new Set<number>();
  const netoPorAnio = new Map<number, number>();
  let totalNC = 0;

  for (const r of filas) {
    const nc = notaCredito(r, ctx);
    totalNC += nc;
    const neto = r.subtotal - nc;
    anios.add(r.anio);
    netoPorAnio.set(r.anio, (netoPorAnio.get(r.anio) ?? 0) + neto);

    const dia = new Date(r.ms).getUTCDate();
    const kD = `${r.anio}|${r.mes}|${dia}`;
    const eD = porDia.get(kD) ?? { anio: r.anio, mes: r.mes, dia, valor: 0, costo: 0 };
    eD.valor += neto; eD.costo += r.costo;
    porDia.set(kD, eD);

    const linea = r.linea || "(sin línea)";
    const kL = `${r.anio}|${r.mes}|${linea}`;
    const eL = porLinea.get(kL) ?? { anio: r.anio, mes: r.mes, linea, valor: 0, costo: 0 };
    eL.valor += neto; eL.costo += r.costo;
    porLinea.set(kL, eL);

    const kC = `${r.anio}|${r.mes}|${r.cliente}`;
    const eC = porCliente.get(kC) ?? { anio: r.anio, mes: r.mes, clienteNombre: r.cliente, nit: r.nit, valor: 0, costo: 0 };
    eC.valor += neto; eC.costo += r.costo;
    porCliente.set(kC, eC);

    const kM = `${r.anio}|${r.mes}|${r.marca}`;
    const eM = porMarca.get(kM) ?? { anio: r.anio, mes: r.mes, marca: r.marca, valor: 0, costo: 0 };
    eM.valor += neto; eM.costo += r.costo;
    porMarca.set(kM, eM);

    const kMI = `${r.anio}|${r.mes}|${r.marca}|${r.cliente}`;
    const eMI = porMarcaIps.get(kMI) ?? { anio: r.anio, mes: r.mes, marca: r.marca, ips: r.cliente, valor: 0, costo: 0 };
    eMI.valor += neto; eMI.costo += r.costo;
    porMarcaIps.set(kMI, eMI);

    const ref = r.referencia?.trim() || "(sin ref)";
    const kI = `${r.anio}|${r.mes}|${r.marca}|${ref}`;
    const eI = porItem.get(kI) ?? { anio: r.anio, mes: r.mes, marca: r.marca, referencia: ref, descripcion: (r.notas || "").trim() || ref, cantidad: 0, valor: 0, costo: 0 };
    eI.cantidad += r.cantidad; eI.valor += neto; eI.costo += r.costo;
    porItem.set(kI, eI);

    // Mismo detalle, abierto por IPS, LISTA DE PRECIOS e INSTALACIÓN: es lo
    // que permite filtrar el consumo por cliente, ciudad, tarifa o bodega de
    // origen sin volver a recorrer VentaDoc. Cada una va en la llave por la
    // misma razón: el mismo ítem despachado dos veces con un dato distinto
    // (tarifa, bodega) son dos historias que no hay que sumar en una sola.
    //
    // La lista se normaliza a su NOMBRE aquí, al agregar — no como parche
    // aparte sobre lo ya guardado (así se arregló la vez pasada, con
    // normalizar-listas.ts, y se deshizo solo en el siguiente recálculo:
    // ese script tocaba VentaItemIps directo, pero esta función lo
    // reconstruye entero cada vez). El reporte de SIESA a veces trae el
    // código (4, 14…) y a veces el nombre ya resuelto (SOAT…) según el mes;
    // sin normalizar, la misma lista aparecía DOS veces en el filtro —una
    // por código y otra por nombre— con la utilidad partida entre las dos.
    const listaCanon = nombreLista(r.lista);
    const instalacion = resolverInstalacion(r.bod, mapaInstalacion);
    const kII = `${kI}|${r.cliente}|${listaCanon}|${instalacion}`;
    const eII = porItemIps.get(kII) ?? {
      anio: r.anio, mes: r.mes, marca: r.marca, referencia: ref,
      descripcion: (r.notas || "").trim() || ref, ips: r.cliente, nit: r.nit,
      lista: listaCanon, instalacion,
      cantidad: 0, valor: 0, costo: 0,
    };
    eII.cantidad += r.cantidad; eII.valor += neto; eII.costo += r.costo;
    porItemIps.set(kII, eII);
  }

  return {
    anios: [...anios].sort((a, b) => a - b),
    porLinea: [...porLinea.values()],
    porCliente: [...porCliente.values()],
    porMarca: [...porMarca.values()],
    porMarcaIps: [...porMarcaIps.values()],
    porItem: [...porItem.values()],
    porItemIps: [...porItemIps.values()],
    porDia: [...porDia.values()],
    netoPorAnio, totalNC, renglones: filas.length,
  };
}
