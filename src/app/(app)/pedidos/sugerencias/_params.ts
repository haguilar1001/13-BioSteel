// ==========================================================
// Resolución de los parámetros de la pantalla de Sugerencias de Compra.
// Vive aparte para que la ruta de exportación calcule exactamente lo mismo
// que la vista: un Excel que no coincida con la pantalla que lo generó es
// peor que no tener Excel.
// ==========================================================
import {
  calcularReposicion, ultimoPeriodoPedidos, modelosDeCompra,
  PARAMETROS_DEFECTO, ORDEN_ESTADO,
  type EstadoRepo, type FilaReposicion, type ResultadoReposicion,
  type ParametrosReposicion, type FiltroReposicion,
} from "@/lib/negocio/reposicion";
import { proveedoresConPedidos, marcasConPedidos, lineasConPedidos, ciudadesConPedidos } from "@/lib/negocio/pedidos";
import { INSTALACIONES_CON_MATERIAL } from "@/lib/negocio/inventario-osteo";
import { listaDe } from "../../_components/filtro-multi";

export interface ParamsSugerencias {
  prov?: string; marca?: string; linea?: string; ciudad?: string;
  modelo?: string; inst?: string; estado?: string;
  ventana?: string; lead?: string; seg?: string; cob?: string;
  /** "1" = mostrar también lo que no hay que comprar. */
  todo?: string;
}

/** Opciones ofrecidas en cada selector de parámetro. */
export const OPCIONES = {
  ventana: [3, 6, 9, 12],
  lead: [0.5, 1, 1.5, 2, 3],
  seguridad: [0, 0.25, 0.5, 1, 1.5],
  cobertura: [1, 1.5, 2, 3, 4],
};

export const ESTADOS: EstadoRepo[] = ["Agotado", "Crítico", "Bajo", "OK", "Exceso"];

/**
 * Modelo con el que arranca la pantalla. MAYORITARIO es el material que sí se
 * mantiene en bodega, o sea el único donde el punto de reorden produce una
 * orden de compra que se puede firmar; en PXP y consignación se compra por
 * procedimiento y una referencia en cero es lo normal.
 *
 * Es un valor por DEFECTO, no un recorte fijo: "Todos" llega como cadena
 * vacía en el querystring, y por eso se distingue de la primera visita, que
 * no trae el parámetro. Sin esa distinción no habría forma de quitar el
 * filtro: el selector volvería solo a MAYORITARIO.
 */
export const MODELO_DEFECTO = "MAYORITARIO";

export interface ContextoSugerencias {
  resultado: ResultadoReposicion;
  /** Filas ya recortadas por el filtro de estado y de "solo a comprar". */
  visibles: FilaReposicion[];
  parametros: ParametrosReposicion;
  filtro: FiltroReposicion;
  estados: EstadoRepo[];
  soloAComprar: boolean;
  /** true si el modelo vigente es el de defecto y el usuario no lo eligió. */
  modeloPorDefecto: boolean;
  opciones: {
    proveedores: string[]; marcas: string[]; lineas: string[];
    ciudades: string[]; modelos: string[];
  };
  /** Querystring vigente, para el enlace de exportación. */
  query: string;
}

/** Número del querystring si está entre las opciones; si no, el de defecto. */
function opcion(valor: string | undefined, permitidas: number[], porDefecto: number): number {
  const n = Number(valor);
  return valor != null && permitidas.includes(n) ? n : porDefecto;
}

/**
 * Arma el contexto completo. Devuelve null si no hay pedidos cargados: sin
 * demanda no hay nada que reponer, y una pantalla en ceros no lo explicaría.
 */
export async function resolverSugerencias(sp: ParamsSugerencias): Promise<ContextoSugerencias | null> {
  const hasta = await ultimoPeriodoPedidos();
  if (!hasta) return null;

  const parametros: ParametrosReposicion = {
    ventanaMeses: opcion(sp.ventana, OPCIONES.ventana, PARAMETROS_DEFECTO.ventanaMeses),
    leadTimeMeses: opcion(sp.lead, OPCIONES.lead, PARAMETROS_DEFECTO.leadTimeMeses),
    seguridadMeses: opcion(sp.seg, OPCIONES.seguridad, PARAMETROS_DEFECTO.seguridadMeses),
    coberturaMeses: opcion(sp.cob, OPCIONES.cobertura, PARAMETROS_DEFECTO.coberturaMeses),
  };

  // Las opciones de los selectores salen del año del último pedido: es el
  // universo con el que se va a trabajar y evita listas de años cerrados.
  const [proveedores, marcas, lineas, ciudades, modelos] = await Promise.all([
    proveedoresConPedidos(hasta.anio), marcasConPedidos(hasta.anio),
    lineasConPedidos(hasta.anio), ciudadesConPedidos(hasta.anio), modelosDeCompra(),
  ]);

  // Primera visita (sin el parámetro) → MAYORITARIO. Cadena vacía → "Todos",
  // que es una elección explícita del usuario y hay que respetarla.
  const modeloPorDefecto = sp.modelo === undefined && modelos.includes(MODELO_DEFECTO);
  const modeloCompra = modeloPorDefecto
    ? MODELO_DEFECTO
    : sp.modelo && modelos.includes(sp.modelo) ? sp.modelo : undefined;

  const filtro: FiltroReposicion = {
    proveedor: listaDe(sp.prov, new Set(proveedores)),
    marca: listaDe(sp.marca, new Set(marcas)),
    linea: listaDe(sp.linea, new Set(lineas)),
    ciudad: listaDe(sp.ciudad, new Set(ciudades)),
    modeloCompra,
    instalacion: (INSTALACIONES_CON_MATERIAL as readonly number[]).includes(Number(sp.inst)) ? Number(sp.inst) : undefined,
  };

  const resultado = await calcularReposicion(hasta, parametros, filtro);

  const estados = listaDe(sp.estado, new Set(ESTADOS)) as EstadoRepo[];
  const soloAComprar = sp.todo !== "1";
  const visibles = resultado.filas
    .filter((f) => (estados.length ? estados.includes(f.estado) : true))
    .filter((f) => (soloAComprar && !estados.length ? f.sugerido > 0 : true))
    .sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] || b.valorSugerido - a.valorSugerido);

  const qs = new URLSearchParams();
  if (filtro.proveedor?.length) qs.set("prov", filtro.proveedor.join(","));
  if (filtro.marca?.length) qs.set("marca", filtro.marca.join(","));
  if (filtro.linea?.length) qs.set("linea", filtro.linea.join(","));
  if (filtro.ciudad?.length) qs.set("ciudad", filtro.ciudad.join(","));
  // El modelo va SIEMPRE, incluso vacío: si no, el enlace de exportación y
  // cualquier vuelta a la pantalla reactivarían el defecto y el Excel no
  // coincidiría con lo que se está viendo.
  qs.set("modelo", filtro.modeloCompra ?? "");
  if (filtro.instalacion) qs.set("inst", String(filtro.instalacion));
  if (estados.length) qs.set("estado", estados.join(","));
  if (!soloAComprar) qs.set("todo", "1");
  qs.set("ventana", String(parametros.ventanaMeses));
  qs.set("lead", String(parametros.leadTimeMeses));
  qs.set("seg", String(parametros.seguridadMeses));
  qs.set("cob", String(parametros.coberturaMeses));

  return {
    resultado, visibles, parametros, filtro, estados, soloAComprar, modeloPorDefecto,
    opciones: { proveedores, marcas, lineas, ciudades, modelos },
    query: qs.toString(),
  };
}
