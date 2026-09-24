// ==========================================================
// Barra de filtros común a las cuatro pantallas de Compras: Año · Mes · Día ·
// Proveedor · Línea · Tipo de compra · Instalación. Los seis primeros son los
// mismos segmentadores del tablero de Power BI; la instalación se añadió para
// poder mirar las compras con la misma lente que Osteosíntesis (101 propio ·
// 102 consignación · 106 aprovechamiento). Viajan por querystring para que
// cualquier vista sea enlazable y compartible.
// ==========================================================
import {
  aniosConCompras, mesesConCompras, diasConCompras,
  proveedoresConCompras, lineasConCompras, tiposDeCompra,
  instalacionesConCompras, etiquetaInstalacion,
  MES_LARGO, type FiltroCompras,
} from "@/lib/negocio/compras";
import { listaDe } from "../_components/filtro-multi";

export interface ParamsCompras {
  anio?: string; mes?: string; dia?: string;
  prov?: string; linea?: string; tipo?: string; inst?: string;
}

export interface ContextoFiltro {
  filtro: FiltroCompras;
  anios: number[];
  meses: number[];
  dias: number[];
  proveedores: string[];
  lineas: string[];
  tipos: string[];
  /** Instalaciones con compras en el año, ya etiquetadas para el selector. */
  instalaciones: { valor: number; label: string }[];
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
export async function resolverFiltro(sp: ParamsCompras): Promise<ContextoFiltro | null> {
  const anios = await aniosConCompras();
  if (!anios.length) return null;

  const anio = sp.anio && anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios[anios.length - 1]!;
  const meses = await mesesConCompras(anio);
  const mes = sp.mes && meses.includes(Number(sp.mes)) ? Number(sp.mes) : undefined;
  const dias = mes ? await diasConCompras(anio, mes) : [];
  const dia = mes && sp.dia && dias.includes(Number(sp.dia)) ? Number(sp.dia) : undefined;

  const [proveedores, lineas, tipos, insts] = await Promise.all([
    proveedoresConCompras(anio), lineasConCompras(anio), tiposDeCompra(),
    instalacionesConCompras(anio),
  ]);
  const proveedor = listaDe(sp.prov, new Set(proveedores));
  const linea = listaDe(sp.linea, new Set(lineas));
  const tipoCompra = listaDe(sp.tipo, new Set(tipos));
  const instalacion = listaDe(sp.inst, new Set(insts.map(String))).map(Number);
  const instalaciones = insts.map((i) => ({ valor: i, label: etiquetaInstalacion(i) }));

  const filtro: FiltroCompras = { anio, mes, dia, proveedor, linea, tipoCompra, instalacion };

  const partes = [String(anio)];
  if (mes) partes.unshift(MES_LARGO[mes]!);
  if (dia) partes.unshift(String(dia));
  const etiqueta = dia ? `${dia} de ${MES_LARGO[mes!]} ${anio}` : partes.join(" ");

  const qs = new URLSearchParams({ anio: String(anio) });
  if (mes) qs.set("mes", String(mes));
  if (dia) qs.set("dia", String(dia));
  if (proveedor.length) qs.set("prov", proveedor.join(","));
  if (linea.length) qs.set("linea", linea.join(","));
  if (tipoCompra.length) qs.set("tipo", tipoCompra.join(","));
  if (instalacion.length) qs.set("inst", instalacion.join(","));

  return { filtro, anios, meses, dias, proveedores, lineas, tipos, instalaciones, etiqueta, query: qs.toString() };
}

/** Descripción corta de los filtros activos, bajo el título de cada pantalla. */
export function resumenFiltros(c: ContextoFiltro): string {
  const f = c.filtro;
  const partes: string[] = [];
  partes.push(f.proveedor?.length ? f.proveedor.join(", ") : "Todos los proveedores");
  if (f.linea?.length) partes.push(f.linea.join(", "));
  if (f.tipoCompra?.length) partes.push(f.tipoCompra.join(", "));
  if (f.instalacion?.length) partes.push(f.instalacion.map(etiquetaInstalacion).join(", "));
  return partes.join(" · ");
}
