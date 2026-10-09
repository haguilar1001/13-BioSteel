// ==========================================================
// Ventas (fuente: reporte de ventas pre-agregado — ver set-ventas.ts).
//   VentaLinea   = venta neta + costo por línea × mes
//   VentaCliente = venta neta + costo por cliente × mes
// Venta neta = Σ(Valor subtotal local) − Σ(NOTA_CREDITO). Costo = Σ(Costo prom. total).
// (Coincide con el Power BI.)
// ==========================================================
import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NOMBRE_INSTALACION } from "./inventario-osteo";

export interface FilaLinea {
  linea: string;
  valor: number; // venta neta
  costo: number;
}

/**
 * Etiqueta de una línea. Se deja el código ("2007 - EQUIPOS MÉDICOS"): hay
 * nombres que se repiten con distinto código (2007 y 3000) y sin él no se
 * distinguirían en el filtro ni en el anillo.
 */
export function nombreLinea(linea: string): string {
  return linea.trim();
}

/** Líneas con venta en el año (para el selector), asc. */
export async function lineasConVenta(anio: number): Promise<string[]> {
  const g = await prisma.ventaLinea.groupBy({ by: ["linea"], where: { anio }, _sum: { valor: true } });
  return g.filter((x) => (x._sum.valor?.toNumber() ?? 0) !== 0).map((x) => x.linea).sort((a, b) => a.localeCompare(b, "es"));
}

/** Venta por línea (opcionalmente filtrada a un conjunto de meses), desc. */
export async function ventaPorLinea(anio: number, meses?: number[]): Promise<FilaLinea[]> {
  const where: Prisma.VentaLineaWhereInput = { anio, ...(meses && meses.length ? { mes: { in: meses } } : {}) };
  const grupos = await prisma.ventaLinea.groupBy({ by: ["linea"], where, _sum: { valor: true, costo: true } });
  return grupos
    .map((g) => ({ linea: g.linea, valor: g._sum.valor?.toNumber() ?? 0, costo: g._sum.costo?.toNumber() ?? 0 }))
    .sort((a, b) => b.valor - a.valor);
}

/** Venta neta total del período. */
export async function ventaTotal(anio: number, meses?: number[]): Promise<number> {
  const where: Prisma.VentaLineaWhereInput = { anio, ...(meses && meses.length ? { mes: { in: meses } } : {}) };
  const agg = await prisma.ventaLinea.aggregate({ where, _sum: { valor: true } });
  return agg._sum.valor?.toNumber() ?? 0;
}

/** Venta neta total por mes (para tendencias / sparkline). Devuelve [mes]=valor. */
export async function ventaMensual(anio: number): Promise<Map<number, number>> {
  const grupos = await prisma.ventaLinea.groupBy({ by: ["mes"], where: { anio }, _sum: { valor: true } });
  const m = new Map<number, number>();
  for (const g of grupos) m.set(g.mes, g._sum.valor?.toNumber() ?? 0);
  return m;
}

export interface MesVenta { mes: number; venta: number; costo: number }

/** Venta neta y costo por mes (1–12) del año. Rellena meses sin datos con 0. */
export async function ventaMensualDetalle(anio: number, lineas?: string[]): Promise<MesVenta[]> {
  const grupos = await prisma.ventaLinea.groupBy({ by: ["mes"], where: { anio, ...(lineas?.length ? { linea: { in: lineas } } : {}) }, _sum: { valor: true, costo: true } });
  const map = new Map(grupos.map((g) => [g.mes, { venta: g._sum.valor?.toNumber() ?? 0, costo: g._sum.costo?.toNumber() ?? 0 }]));
  return Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    const e = map.get(mes) ?? { venta: 0, costo: 0 };
    return { mes, venta: e.venta, costo: e.costo };
  });
}

export interface ResumenAnual { venta: number; costo: number; utilidad: number; margen: number }

/** KPIs del período (año, opcionalmente meses): venta neta, costo, utilidad y % utilidad. */
export async function resumenAnual(anio: number, meses?: number[], lineas?: string[]): Promise<ResumenAnual> {
  const where: Prisma.VentaLineaWhereInput = {
    anio, ...(meses && meses.length ? { mes: { in: meses } } : {}), ...(lineas?.length ? { linea: { in: lineas } } : {}),
  };
  const agg = await prisma.ventaLinea.aggregate({ where, _sum: { valor: true, costo: true } });
  const venta = agg._sum.valor?.toNumber() ?? 0;
  const costo = agg._sum.costo?.toNumber() ?? 0;
  const utilidad = venta - costo;
  return { venta, costo, utilidad, margen: venta > 0 ? (utilidad / venta) * 100 : 0 };
}

/** Clientes con venta en el año (para el selector), asc. */
export async function clientesConVenta(anio: number): Promise<string[]> {
  const g = await prisma.ventaCliente.groupBy({ by: ["clienteNombre"], where: { anio }, _sum: { valor: true } });
  return g.filter((x) => (x._sum.valor?.toNumber() ?? 0) !== 0).map((x) => x.clienteNombre).sort((a, b) => a.localeCompare(b, "es"));
}

/** KPIs de uno o varios clientes (desde VentaCliente), opcionalmente por meses. */
export async function resumenAnualCliente(anio: number, clientes: string[], meses?: number[]): Promise<ResumenAnual> {
  const where: Prisma.VentaClienteWhereInput = { anio, clienteNombre: { in: clientes }, ...(meses && meses.length ? { mes: { in: meses } } : {}) };
  const agg = await prisma.ventaCliente.aggregate({ where, _sum: { valor: true, costo: true } });
  const venta = agg._sum.valor?.toNumber() ?? 0;
  const costo = agg._sum.costo?.toNumber() ?? 0;
  const utilidad = venta - costo;
  return { venta, costo, utilidad, margen: venta > 0 ? (utilidad / venta) * 100 : 0 };
}

/** Venta neta y costo por mes (1–12) de uno o varios clientes. Rellena meses sin datos con 0. */
export async function ventaMensualDetalleCliente(anio: number, clientes: string[]): Promise<MesVenta[]> {
  const g = await prisma.ventaCliente.groupBy({ by: ["mes"], where: { anio, clienteNombre: { in: clientes } }, _sum: { valor: true, costo: true } });
  const map = new Map(g.map((x) => [x.mes, { venta: x._sum.valor?.toNumber() ?? 0, costo: x._sum.costo?.toNumber() ?? 0 }]));
  return Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    const e = map.get(mes) ?? { venta: 0, costo: 0 };
    return { mes, venta: e.venta, costo: e.costo };
  });
}

export interface FilaMarcaVenta { marca: string; valor: number; costo: number }

/** Venta neta y costo por MARCA (proveedor), opcionalmente por meses, desc. */
export async function ventaPorMarca(anio: number, meses?: number[]): Promise<FilaMarcaVenta[]> {
  const where: Prisma.VentaMarcaWhereInput = { anio, ...(meses && meses.length ? { mes: { in: meses } } : {}) };
  const grupos = await prisma.ventaMarca.groupBy({ by: ["marca"], where, _sum: { valor: true, costo: true } });
  return grupos
    .map((g) => ({ marca: g.marca, valor: g._sum.valor?.toNumber() ?? 0, costo: g._sum.costo?.toNumber() ?? 0 }))
    .sort((a, b) => b.valor - a.valor);
}

export interface MarcaConIps {
  marca: string; valor: number; costo: number;
  ips: { ips: string; valor: number; costo: number }[];
}

/** Venta neta y costo por MARCA (proveedor), con desglose por IPS (cliente). */
export async function ventaPorMarcaConIps(anio: number, meses?: number[]): Promise<MarcaConIps[]> {
  const where: Prisma.VentaMarcaIpsWhereInput = { anio, ...(meses && meses.length ? { mes: { in: meses } } : {}) };
  const grupos = await prisma.ventaMarcaIps.groupBy({ by: ["marca", "ips"], where, _sum: { valor: true, costo: true } });
  const map = new Map<string, MarcaConIps>();
  for (const g of grupos) {
    const v = g._sum.valor?.toNumber() ?? 0, c = g._sum.costo?.toNumber() ?? 0;
    const m = map.get(g.marca) ?? { marca: g.marca, valor: 0, costo: 0, ips: [] };
    m.valor += v; m.costo += c;
    m.ips.push({ ips: g.ips, valor: v, costo: c });
    map.set(g.marca, m);
  }
  const arr = [...map.values()];
  for (const m of arr) m.ips.sort((a, b) => b.valor - a.valor);
  return arr.sort((a, b) => b.valor - a.valor);
}

export interface ItemFila { referencia: string; descripcion: string; cantidad: number; valor: number; costo: number }

/**
 * Ítems (referencia) por MARCA para el período, agregados sobre los meses.
 * Devuelve un mapa marca → ítems (ordenados por costo total desc). Alimenta el
 * "Consumo por Ítem" desplegable bajo cada proveedor.
 */
export async function itemsPorMarca(anio: number, meses?: number[]): Promise<Map<string, ItemFila[]>> {
  const where: Prisma.VentaItemWhereInput = { anio, ...(meses && meses.length ? { mes: { in: meses } } : {}) };
  const grupos = await prisma.ventaItem.groupBy({
    by: ["marca", "referencia", "descripcion"], where,
    _sum: { cantidad: true, valor: true, costo: true },
  });
  const map = new Map<string, ItemFila[]>();
  for (const g of grupos) {
    const arr = map.get(g.marca) ?? [];
    arr.push({
      referencia: g.referencia, descripcion: g.descripcion,
      cantidad: g._sum.cantidad?.toNumber() ?? 0,
      valor: g._sum.valor?.toNumber() ?? 0,
      costo: g._sum.costo?.toNumber() ?? 0,
    });
    map.set(g.marca, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => b.costo - a.costo);
  return map;
}

export interface ProveedorFila { marca: string; valor: number; costo: number; estado: string; motivo: string }

/** Marcas con venta del período + su estado/motivo (Sin clasificar si no tiene). */
export async function proveedoresConEstado(anio: number, meses?: number[]): Promise<ProveedorFila[]> {
  const [marcas, estados] = await Promise.all([ventaPorMarca(anio, meses), prisma.proveedorEstado.findMany()]);
  const em = new Map(estados.map((e) => [e.marca, e]));
  return marcas.map((m) => {
    const e = em.get(m.marca);
    return { marca: m.marca, valor: m.valor, costo: m.costo, estado: e?.estado ?? "Sin clasificar", motivo: e?.motivo ?? "" };
  });
}

export interface EstadoAgg { estado: string; valor: number; costo: number; proveedores: number }

/** Venta neta agrupada por estado del proveedor (para KPIs de riesgo). */
export async function ventaPorEstadoProveedor(anio: number, meses?: number[]): Promise<EstadoAgg[]> {
  const filas = await proveedoresConEstado(anio, meses);
  const map = new Map<string, EstadoAgg>();
  for (const f of filas) {
    const e = map.get(f.estado) ?? { estado: f.estado, valor: 0, costo: 0, proveedores: 0 };
    e.valor += f.valor; e.costo += f.costo; e.proveedores += 1;
    map.set(f.estado, e);
  }
  const orden = ["ACTIVO", "CON RESTRICCIÓN", "INACTIVO", "Sin clasificar"];
  return [...map.values()].sort((a, b) => (orden.indexOf(a.estado) - orden.indexOf(b.estado)) || (b.valor - a.valor));
}

/** Años con ventas cargadas, ascendente. */
export async function aniosConVenta(): Promise<number[]> {
  const grupos = await prisma.ventaLinea.groupBy({ by: ["anio"], _sum: { valor: true } });
  return grupos.map((g) => g.anio).sort((a, b) => a - b);
}

export interface VentaDiaFila { dia: number; valor: number; }

/** Venta neta por día del mes (desde VentaDia; misma fórmula que la mensual). */
export async function ventaNetaPorDia(anio: number, mes: number): Promise<VentaDiaFila[]> {
  const filas = await prisma.ventaDia.findMany({ where: { anio, mes }, orderBy: { dia: "asc" } });
  return filas.map((f) => ({ dia: f.dia, valor: f.valor.toNumber() }));
}

/** Meses (1–12) que tienen ventas cargadas. */
export async function mesesConVenta(anio: number): Promise<number[]> {
  const grupos = await prisma.ventaLinea.groupBy({ by: ["mes"], where: { anio }, _sum: { valor: true } });
  return grupos.map((g) => g.mes).sort((a, b) => a - b);
}

export interface FilaClienteVenta {
  clienteNombre: string;
  nit: string | null;
  valor: number; // venta neta
  costo: number;
}

/** Venta por cliente para el/los mes(es) dados, desc. */
export async function ventaPorCliente(anio: number, meses?: number[]): Promise<FilaClienteVenta[]> {
  const where: Prisma.VentaClienteWhereInput = { anio, ...(meses && meses.length ? { mes: { in: meses } } : {}) };
  const grupos = await prisma.ventaCliente.groupBy({ by: ["clienteNombre"], where, _sum: { valor: true, costo: true } });
  const conNit = await prisma.ventaCliente.groupBy({ by: ["clienteNombre", "nit"], where, _sum: { valor: true } });
  const nitPorNombre = new Map<string, string>();
  for (const g of conNit) if (g.nit && !nitPorNombre.has(g.clienteNombre)) nitPorNombre.set(g.clienteNombre, g.nit);

  return grupos
    .map((g) => ({ clienteNombre: g.clienteNombre, nit: nitPorNombre.get(g.clienteNombre) ?? null, valor: g._sum.valor?.toNumber() ?? 0, costo: g._sum.costo?.toNumber() ?? 0 }))
    .sort((a, b) => b.valor - a.valor);
}

export interface IpsVenta { nombre: string; valor: number; }
export interface FilaCiudadVenta { ciudad: string; valor: number; clientes: number; ips: IpsVenta[]; }

/**
 * Venta neta por ciudad (año, opcionalmente meses). Cruza el NIT de cada
 * cliente con Terceros para obtener la ciudad; los que no cruzan o no tienen
 * ciudad caen en "Sin ciudad". Incluye a todos (también las IPS internas).
 * Devuelve además el desglose de IPS por ciudad (para el tooltip).
 */
export async function ventaPorCiudad(anio: number, meses?: number[], clientes?: string[]): Promise<FilaCiudadVenta[]> {
  const where: Prisma.VentaClienteWhereInput = { anio, ...(meses && meses.length ? { mes: { in: meses } } : {}), ...(clientes && clientes.length ? { clienteNombre: { in: clientes } } : {}) };
  const grupos = await prisma.ventaCliente.groupBy({ by: ["clienteNombre", "nit"], where, _sum: { valor: true } });

  // Mapa NIT -> ciudad desde Terceros.
  const nits = [...new Set(grupos.map((g) => g.nit).filter((n): n is string => !!n))];
  const terceros = nits.length ? await prisma.tercero.findMany({ where: { nit: { in: nits } }, select: { nit: true, ciudad: true } }) : [];
  const ciudadPorNit = new Map<string, string>();
  for (const t of terceros) ciudadPorNit.set(t.nit, t.ciudad?.trim() || "Sin ciudad");

  const porCiudad = new Map<string, { valor: number; ips: Map<string, number> }>();
  for (const g of grupos) {
    const ciudad = (g.nit ? ciudadPorNit.get(g.nit) : undefined) ?? "Sin ciudad";
    const v = g._sum.valor?.toNumber() ?? 0;
    const c = porCiudad.get(ciudad) ?? { valor: 0, ips: new Map() };
    c.valor += v;
    c.ips.set(g.clienteNombre, (c.ips.get(g.clienteNombre) ?? 0) + v);
    porCiudad.set(ciudad, c);
  }

  return [...porCiudad.entries()]
    .map(([ciudad, c]) => ({
      ciudad,
      valor: c.valor,
      clientes: c.ips.size,
      ips: [...c.ips.entries()].map(([nombre, valor]) => ({ nombre, valor })).sort((a, b) => b.valor - a.valor),
    }))
    .sort((a, b) => b.valor - a.valor);
}

// ---------- Consumos filtrables por IPS / ciudad ----------

export interface OpcionIps { ips: string; nit: string | null; ciudad: string; valor: number }

/**
 * IPS con venta en el período, con su ciudad tomada de Terceros (cruce por
 * NIT). Las que no cruzan quedan sin ciudad: el filtro por ciudad no las
 * alcanza, y por eso la pantalla las nombra en vez de esconderlas.
 */
export async function ipsConVenta(anio: number, meses?: number[]): Promise<OpcionIps[]> {
  const where: Prisma.VentaItemIpsWhereInput = { anio, ...(meses && meses.length ? { mes: { in: meses } } : {}) };
  const grupos = await prisma.ventaItemIps.groupBy({ by: ["ips", "nit"], where, _sum: { valor: true } });
  const nits = [...new Set(grupos.map((g) => g.nit).filter((n): n is string => !!n))];
  const terceros = nits.length
    ? await prisma.tercero.findMany({ where: { nit: { in: nits } }, select: { nit: true, ciudad: true } })
    : [];
  const ciudadPorNit = new Map(terceros.map((t) => [t.nit, (t.ciudad ?? "").trim()]));

  const map = new Map<string, OpcionIps>();
  for (const g of grupos) {
    const e = map.get(g.ips) ?? { ips: g.ips, nit: g.nit, ciudad: "", valor: 0 };
    e.valor += g._sum.valor?.toNumber() ?? 0;
    if (!e.ciudad && g.nit) e.ciudad = ciudadPorNit.get(g.nit) ?? "";
    if (!e.nit && g.nit) e.nit = g.nit;
    map.set(g.ips, e);
  }
  return [...map.values()].sort((a, b) => b.valor - a.valor);
}

/** Ciudades con venta en el período (solo las que sí cruzaron contra Terceros). */
export function ciudadesDeIps(ips: OpcionIps[]): { ciudad: string; ips: number; valor: number }[] {
  const map = new Map<string, { ciudad: string; ips: number; valor: number }>();
  for (const i of ips) {
    if (!i.ciudad) continue;
    const e = map.get(i.ciudad) ?? { ciudad: i.ciudad, ips: 0, valor: 0 };
    e.ips++; e.valor += i.valor;
    map.set(i.ciudad, e);
  }
  return [...map.values()].sort((a, b) => b.valor - a.valor);
}

export interface FiltroConsumo {
  anio: number;
  meses?: number[];
  /** Selección múltiple: vacío o ausente = todas. */
  ips?: string[];
  ciudad?: string[];
  lista?: string[];
  /** Proveedor (columna MARCA del renglón). */
  marca?: string[];
  /** Instalación de la bodega que despachó (101/102/104/106). */
  instalacion?: number[];
  /** Línea de producto (VentaItemIps.linea). Selección múltiple. */
  linea?: string[];
}

/** Etiqueta de los renglones cuyo archivo de origen no traía lista de precios. */
export const SIN_LISTA = "(sin lista)";

/**
 * Listas de precios con venta en el año. Solo existen desde que el reporte se
 * cargó con la columna "Desc. lista de precios": los periodos cargados antes
 * quedan en "" y salen agrupados como (sin lista).
 */
export async function listasConVenta(anio: number): Promise<string[]> {
  const filas = await prisma.ventaItemIps.findMany({
    where: { anio, lista: { not: "" } },
    distinct: ["lista"],
    select: { lista: true },
    orderBy: { lista: "asc" },
  });
  return filas.map((f) => f.lista);
}

export interface FilaLista { lista: string; valor: number; costo: number }

/** Venta, costo y utilidad por lista de precios, con el filtro vigente. */
export async function utilidadPorLista(f: FiltroConsumo, opciones: OpcionIps[]): Promise<FilaLista[]> {
  const ips = ipsDelFiltro(opciones, f);
  const grupos = await prisma.ventaItemIps.groupBy({
    by: ["lista"],
    where: {
      anio: f.anio,
      ...(f.meses && f.meses.length ? { mes: { in: f.meses } } : {}),
      ...(ips ? { ips: { in: ips } } : {}),
      ...soloMarca(f),
      ...soloInstalacion(f),
      ...soloLinea(f),
    },
    _sum: { valor: true, costo: true },
  });
  return grupos
    .map((g) => ({
      lista: g.lista || SIN_LISTA,
      valor: g._sum.valor?.toNumber() ?? 0,
      costo: g._sum.costo?.toNumber() ?? 0,
    }))
    .sort((a, b) => b.valor - a.valor);
}

export interface FilaIpsLista { ips: string; valor: number; costo: number }

/** IPS a las que se vendió con cada lista de precios (para desplegar la lista).
 *  Ignora el propio filtro de lista, igual que utilidadPorLista. */
export async function ipsPorLista(f: FiltroConsumo, opciones: OpcionIps[]): Promise<Map<string, FilaIpsLista[]>> {
  const ips = ipsDelFiltro(opciones, f);
  const grupos = await prisma.ventaItemIps.groupBy({
    by: ["lista", "ips"],
    where: {
      anio: f.anio,
      ...(f.meses && f.meses.length ? { mes: { in: f.meses } } : {}),
      ...(ips ? { ips: { in: ips } } : {}),
      ...soloMarca(f),
      ...soloInstalacion(f),
      ...soloLinea(f),
    },
    _sum: { valor: true, costo: true },
  });
  const mapa = new Map<string, FilaIpsLista[]>();
  for (const g of grupos) {
    const key = g.lista || SIN_LISTA;
    if (!mapa.has(key)) mapa.set(key, []);
    mapa.get(key)!.push({ ips: g.ips || "(sin IPS)", valor: g._sum.valor?.toNumber() ?? 0, costo: g._sum.costo?.toNumber() ?? 0 });
  }
  for (const arr of mapa.values()) arr.sort((a, b) => b.valor - a.valor);
  return mapa;
}

export interface ItemLista { referencia: string; descripcion: string; cantidad: number; valor: number; costo: number }

/** Ítems (referencias) vendidos por lista × IPS. Mapa lista → ips → ítems.
 *  Para el tercer nivel de despliegue de "Utilidad por Lista de Precios". */
export async function itemsPorListaIps(f: FiltroConsumo, opciones: OpcionIps[]): Promise<Map<string, Map<string, ItemLista[]>>> {
  const ips = ipsDelFiltro(opciones, f);
  const grupos = await prisma.ventaItemIps.groupBy({
    by: ["lista", "ips", "referencia", "descripcion"],
    where: {
      anio: f.anio,
      ...(f.meses && f.meses.length ? { mes: { in: f.meses } } : {}),
      ...(ips ? { ips: { in: ips } } : {}),
      ...soloMarca(f),
      ...soloInstalacion(f),
      ...soloLinea(f),
    },
    _sum: { valor: true, costo: true, cantidad: true },
  });
  const mapa = new Map<string, Map<string, ItemLista[]>>();
  for (const g of grupos) {
    const lk = g.lista || SIN_LISTA;
    const ik = g.ips || "(sin IPS)";
    if (!mapa.has(lk)) mapa.set(lk, new Map());
    const inner = mapa.get(lk)!;
    if (!inner.has(ik)) inner.set(ik, []);
    inner.get(ik)!.push({
      referencia: g.referencia,
      descripcion: g.descripcion,
      cantidad: g._sum.cantidad?.toNumber() ?? 0,
      valor: g._sum.valor?.toNumber() ?? 0,
      costo: g._sum.costo?.toNumber() ?? 0,
    });
  }
  for (const inner of mapa.values()) for (const arr of inner.values()) arr.sort((a, b) => b.valor - a.valor);
  return mapa;
}

/** Recorte por lista(s) de precios; "(sin lista)" busca la cadena vacía. Selección múltiple. */
function soloLista(f: FiltroConsumo) {
  if (!f.lista || !f.lista.length) return {};
  return { lista: { in: f.lista.map((l) => (l === SIN_LISTA ? "" : l)) } };
}

/**
 * Recorte por proveedor(es) (MARCA). Se aplica a TODAS las consultas del
 * informe, incluido el desglose por lista de precios: el sentido del filtro
 * es ver la utilidad de uno o varios proveedores de punta a punta, no solo
 * en una tabla. Selección múltiple.
 */
function soloMarca(f: FiltroConsumo) {
  return f.marca && f.marca.length ? { marca: { in: f.marca } } : {};
}

/** Recorte por línea(s) de producto. Selección múltiple. */
function soloLinea(f: { linea?: string[] }) {
  return f.linea && f.linea.length ? { linea: { in: f.linea } } : {};
}

/**
 * Líneas con venta en el detalle por ítem (VentaItemIps), para los selectores de
 * Consumos y Por Cliente. Vacío hasta que se recalcula el detalle con la línea.
 */
export async function lineasConVentaItem(anio: number, meses?: number[]): Promise<string[]> {
  const filas = await prisma.ventaItemIps.findMany({
    where: { anio, ...(meses && meses.length ? { mes: { in: meses } } : {}), linea: { not: "" } },
    distinct: ["linea"],
    select: { linea: true },
    orderBy: { linea: "asc" },
  });
  return filas.map((f) => f.linea);
}

/** Venta por cliente restringida a una o varias líneas (desde el detalle por ítem × IPS). */
export async function ventaPorClienteLinea(anio: number, lineas: string[], meses?: number[]): Promise<FilaClienteVenta[]> {
  const where: Prisma.VentaItemIpsWhereInput = { anio, linea: { in: lineas }, ...(meses && meses.length ? { mes: { in: meses } } : {}) };
  const grupos = await prisma.ventaItemIps.groupBy({ by: ["ips", "nit"], where, _sum: { valor: true, costo: true } });
  const m = new Map<string, FilaClienteVenta>();
  for (const g of grupos) {
    const e = m.get(g.ips) ?? { clienteNombre: g.ips, nit: g.nit, valor: 0, costo: 0 };
    e.valor += g._sum.valor?.toNumber() ?? 0;
    e.costo += g._sum.costo?.toNumber() ?? 0;
    if (!e.nit && g.nit) e.nit = g.nit;
    m.set(g.ips, e);
  }
  return [...m.values()].sort((a, b) => b.valor - a.valor);
}

/** Recorte por instalación de la bodega que despachó. Selección múltiple. */
function soloInstalacion(f: FiltroConsumo) {
  return f.instalacion && f.instalacion.length ? { instalacion: { in: f.instalacion } } : {};
}

/**
 * Proveedores (MARCA) con venta en el periodo. Alimenta el selector, y se pide
 * SIN el filtro de marca para que el selector no se vacíe a sí mismo al elegir
 * uno (mismo criterio que las IPS y las listas de precios).
 */
export async function marcasConVenta(anio: number, meses?: number[]): Promise<string[]> {
  const filas = await prisma.ventaItemIps.findMany({
    where: { anio, ...(meses && meses.length ? { mes: { in: meses } } : {}), marca: { not: "" } },
    distinct: ["marca"],
    select: { marca: true },
    orderBy: { marca: "asc" },
  });
  return filas.map((f) => f.marca);
}

/**
 * Instalaciones (101/102/104/106) con venta en el periodo, con su etiqueta
 * lista para el selector. Sin filtrar, mismo criterio que los demás.
 */
export async function instalacionesConVenta(anio: number, meses?: number[]): Promise<{ valor: number; label: string }[]> {
  const filas = await prisma.ventaItemIps.findMany({
    where: { anio, ...(meses && meses.length ? { mes: { in: meses } } : {}), instalacion: { not: null } },
    distinct: ["instalacion"],
    select: { instalacion: true },
  });
  return filas
    .map((f) => f.instalacion!)
    .filter((i) => NOMBRE_INSTALACION[i])
    .sort((a, b) => a - b)
    .map((i) => ({ valor: i, label: `${i} · ${NOMBRE_INSTALACION[i]}` }));
}

/** Nombres de IPS que caen dentro del filtro (unas cuantas, una/varias ciudades, o todas). */
function ipsDelFiltro(opciones: OpcionIps[], f: FiltroConsumo): string[] | undefined {
  if (f.ips && f.ips.length) return f.ips;
  if (f.ciudad && f.ciudad.length) return opciones.filter((o) => f.ciudad!.includes(o.ciudad)).map((o) => o.ips);
  return undefined;
}

/** Venta por MARCA del período, acotada al filtro de IPS/ciudad. */
export async function marcasFiltradas(f: FiltroConsumo, opciones: OpcionIps[]): Promise<FilaMarcaVenta[]> {
  const lista = ipsDelFiltro(opciones, f);
  const where: Prisma.VentaItemIpsWhereInput = {
    anio: f.anio,
    ...(f.meses && f.meses.length ? { mes: { in: f.meses } } : {}),
    ...(lista ? { ips: { in: lista } } : {}),
    ...soloLista(f),
    ...soloMarca(f),
    ...soloInstalacion(f),
    ...soloLinea(f),
  };
  const grupos = await prisma.ventaItemIps.groupBy({ by: ["marca"], where, _sum: { valor: true, costo: true } });
  return grupos
    .map((g) => ({ marca: g.marca, valor: g._sum.valor?.toNumber() ?? 0, costo: g._sum.costo?.toNumber() ?? 0 }))
    .sort((a, b) => b.valor - a.valor);
}

/** IPS por marca del período, acotada al filtro (para el desglose "Por IPS"). */
export async function ipsPorMarcaFiltrado(f: FiltroConsumo, opciones: OpcionIps[]): Promise<Map<string, MarcaConIps["ips"]>> {
  const lista = ipsDelFiltro(opciones, f);
  const where: Prisma.VentaItemIpsWhereInput = {
    anio: f.anio,
    ...(f.meses && f.meses.length ? { mes: { in: f.meses } } : {}),
    ...(lista ? { ips: { in: lista } } : {}),
    ...soloLista(f),
    ...soloMarca(f),
    ...soloInstalacion(f),
    ...soloLinea(f),
  };
  const grupos = await prisma.ventaItemIps.groupBy({ by: ["marca", "ips"], where, _sum: { valor: true, costo: true } });
  const map = new Map<string, MarcaConIps["ips"]>();
  for (const g of grupos) {
    const arr = map.get(g.marca) ?? [];
    arr.push({ ips: g.ips, valor: g._sum.valor?.toNumber() ?? 0, costo: g._sum.costo?.toNumber() ?? 0 });
    map.set(g.marca, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => b.valor - a.valor);
  return map;
}

/** Ítems por marca del período, acotados al filtro de IPS/ciudad. */
export async function itemsPorMarcaFiltrado(f: FiltroConsumo, opciones: OpcionIps[]): Promise<Map<string, ItemFila[]>> {
  const lista = ipsDelFiltro(opciones, f);
  const where: Prisma.VentaItemIpsWhereInput = {
    anio: f.anio,
    ...(f.meses && f.meses.length ? { mes: { in: f.meses } } : {}),
    ...(lista ? { ips: { in: lista } } : {}),
    ...soloLista(f),
    ...soloMarca(f),
    ...soloInstalacion(f),
    ...soloLinea(f),
  };
  const grupos = await prisma.ventaItemIps.groupBy({
    by: ["marca", "referencia", "descripcion"], where,
    _sum: { cantidad: true, valor: true, costo: true },
  });
  const map = new Map<string, ItemFila[]>();
  for (const g of grupos) {
    const arr = map.get(g.marca) ?? [];
    arr.push({
      referencia: g.referencia, descripcion: g.descripcion,
      cantidad: g._sum.cantidad?.toNumber() ?? 0,
      valor: g._sum.valor?.toNumber() ?? 0,
      costo: g._sum.costo?.toNumber() ?? 0,
    });
    map.set(g.marca, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => b.valor - a.valor);
  return map;
}
