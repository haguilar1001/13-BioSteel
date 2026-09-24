// ==========================================================
// Barra de filtros común al Informe de Pedidos y a su detalle: Año · Mes ·
// Día · Ciudad · Cliente · Marca · Línea · Anatomía · Estado. Son los mismos
// segmentadores de la página PEDIDOS del tablero de Power BI, y viajan por
// querystring para que cualquier vista sea enlazable y compartible.
//
// Las Sugerencias de Compra NO usan esta barra: filtran por otra cosa
// (proveedor, modelo de compra, parámetros de reposición) y no tienen mes,
// porque miran una ventana de meses, no un periodo.
// ==========================================================
import {
  aniosConPedidos, mesesConPedidos, diasConPedidos,
  ciudadesConPedidos, clientesConPedidos, marcasConPedidos,
  lineasConPedidos, anatomiasConPedidos, estadosConPedidos,
  MES_LARGO, type FiltroPedidos,
} from "@/lib/negocio/pedidos";
import { listaDe } from "../_components/filtro-multi";

export interface ParamsPedidos {
  anio?: string; mes?: string; dia?: string;
  ciudad?: string; cliente?: string; marca?: string;
  linea?: string; anatomia?: string; estado?: string;
}

export interface ContextoFiltro {
  filtro: FiltroPedidos;
  anios: number[];
  meses: number[];
  dias: number[];
  ciudades: string[];
  clientes: string[];
  marcas: string[];
  lineas: string[];
  anatomias: string[];
  estados: string[];
  /** Texto del periodo para los encabezados ("11 de Agosto 2026"). */
  etiqueta: string;
  /** Querystring con el filtro vigente, para los enlaces de exportación. */
  query: string;
}

/**
 * Resuelve el filtro contra lo que realmente hay cargado: un año o un mes que
 * no existan se caen al último disponible en vez de mostrar una vista vacía.
 * Devuelve null si no hay nada cargado todavía.
 */
export async function resolverFiltro(sp: ParamsPedidos): Promise<ContextoFiltro | null> {
  const anios = await aniosConPedidos();
  if (!anios.length) return null;

  const anio = sp.anio && anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios[anios.length - 1]!;
  const meses = await mesesConPedidos(anio);
  const mes = sp.mes && meses.includes(Number(sp.mes)) ? Number(sp.mes) : undefined;
  const dias = mes ? await diasConPedidos(anio, mes) : [];
  const dia = mes && sp.dia && dias.includes(Number(sp.dia)) ? Number(sp.dia) : undefined;

  const [ciudades, clientes, marcas, lineas, anatomias, estados] = await Promise.all([
    ciudadesConPedidos(anio), clientesConPedidos(anio), marcasConPedidos(anio),
    lineasConPedidos(anio), anatomiasConPedidos(anio), estadosConPedidos(anio),
  ]);
  const ciudad = listaDe(sp.ciudad, new Set(ciudades));
  const cliente = listaDe(sp.cliente, new Set(clientes));
  const marca = listaDe(sp.marca, new Set(marcas));
  const linea = listaDe(sp.linea, new Set(lineas));
  const anatomia = listaDe(sp.anatomia, new Set(anatomias));
  const estado = listaDe(sp.estado, new Set(estados));

  const filtro: FiltroPedidos = { anio, mes, dia, ciudad, cliente, marca, linea, anatomia, estado };

  const partes = [String(anio)];
  if (mes) partes.unshift(MES_LARGO[mes]!);
  const etiqueta = dia ? `${dia} de ${MES_LARGO[mes!]} ${anio}` : partes.join(" ");

  const qs = new URLSearchParams({ anio: String(anio) });
  if (mes) qs.set("mes", String(mes));
  if (dia) qs.set("dia", String(dia));
  if (ciudad.length) qs.set("ciudad", ciudad.join(","));
  if (cliente.length) qs.set("cliente", cliente.join(","));
  if (marca.length) qs.set("marca", marca.join(","));
  if (linea.length) qs.set("linea", linea.join(","));
  if (anatomia.length) qs.set("anatomia", anatomia.join(","));
  if (estado.length) qs.set("estado", estado.join(","));

  return { filtro, anios, meses, dias, ciudades, clientes, marcas, lineas, anatomias, estados, etiqueta, query: qs.toString() };
}

/** Descripción corta de los filtros activos, bajo el título de cada pantalla. */
export function resumenFiltros(c: ContextoFiltro): string {
  const f = c.filtro;
  const partes: string[] = [f.ciudad?.length ? f.ciudad.join(", ") : "Todas las ciudades"];
  if (f.cliente?.length) partes.push(f.cliente.join(", "));
  if (f.marca?.length) partes.push(f.marca.join(", "));
  if (f.linea?.length) partes.push(f.linea.join(", "));
  if (f.anatomia?.length) partes.push(f.anatomia.join(", "));
  if (f.estado?.length) partes.push(f.estado.join(", "));
  return partes.join(" · ");
}

/** true si hay algún filtro más allá del año (para ofrecer "Limpiar"). */
export function hayFiltros(c: ContextoFiltro): boolean {
  const f = c.filtro;
  return Boolean(f.mes || f.dia || f.ciudad?.length || f.cliente?.length || f.marca?.length || f.linea?.length || f.anatomia?.length || f.estado?.length);
}
