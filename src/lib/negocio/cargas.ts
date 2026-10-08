// ==========================================================
// Registro UNIFICADO de cargas de archivos (formulario in-app /cargar).
// Cada dataset tiene: clave, título, PERMISO (uno por archivo) y un procesador
// que recibe el buffer y devuelve un ResultadoDataset normalizado.
// Delega en los motores existentes:
//   · SIESA (pendientes/ventas/facturacion/gastos/anuladas) → procesarCarga
//   · Estado de Resultados (pyg) → parsePygExcel / persistirPyg
//   · Ingresos y Egresos (flujo) → sincronizarFlujoDesdeBuffer
// El control de acceso (sesión + permiso por dataset) vive en la API/página.
// ==========================================================
import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { PermisoClave } from "@/lib/rbac/permissions";
import { procesarCarga, type ResultadoDataset, type DatasetKey } from "./carga-siesa";
import { parsePygExcel, persistirPyg } from "./importar-pyg-excel";
import { sincronizarFlujoDesdeBuffer } from "./sync-flujo";
import { parsePresupuesto, persistirPresupuesto } from "./importar-presupuesto";
import {
  INSTALACIONES, parseTablasAuxiliares, persistirBodegas,
  parseBalance, persistirBalance, loQuePerderiaElBalance,
  parseMovimientos, persistirMovimientos, diasQueBorrariaMovimientos,
} from "./importar-inventario";
import { CargaRequiereConfirmacion } from "./carga-confirmacion";
import {
  parseOrdenes, persistirOrdenes,
  parsePendientesDespacho, persistirPendientesDespacho,
  parseFacturasProveedor, persistirFacturasProveedor,
  parseTiposProveedor, persistirTiposProveedor,
  parseEntradasProveedor, persistirEntradasProveedor,
} from "./importar-compras";
import { parseInstitucional, parseOrtopedistas, persistirEncuestas } from "./importar-encuestas";
import { parseCirugias, persistirCirugias } from "./importar-cirugias";
import { parseCapacitaciones, persistirCapacitaciones } from "./importar-capacitaciones";
import { parseNomina, persistirNomina } from "./importar-nomina";
import { parsePedidos, persistirPedidos } from "./importar-pedidos";
import {
  parseIndicadorCompras, persistirIndicadorCompras,
  parseEvaluacionProveedores, persistirEvaluacionProveedores,
} from "./importar-indicador-compras";

export type CargaClave = DatasetKey | "pyg" | "flujo" | "presupuesto"
  | "inv-bodegas" | "inv-balance" | "inv-movimientos"
  | "compras-tipos" | "compras-ordenes" | "compras-pendientes" | "compras-facturas"
  | "compras-entradas" | "pedidos"
  | "ind-compras" | "ind-proveedores"
  | "encuestas-inst" | "encuestas-ortho" | "cirugias" | "capacitaciones" | "nomina";

/** Módulo al que pertenece el archivo; solo sirve para agrupar /cargar. */
export type GrupoCarga = "Comercial" | "Financiero" | "Inventario" | "Compras" | "Pedidos" | "Calidad" | "Gestión Humana";

/** Orden en que se muestran los grupos en la pantalla de carga. */
export const GRUPOS_CARGA: GrupoCarga[] = ["Comercial", "Financiero", "Inventario", "Compras", "Pedidos", "Calidad", "Gestión Humana"];

export interface CargaDef {
  clave: CargaClave;
  titulo: string;
  grupo: GrupoCarga;
  permiso: PermisoClave;
  archivoSugerido: string;
  /**
   * `confirmado` = el usuario ya dijo que sí a un reemplazo que iba a borrar
   * datos. Solo lo miran las cargas que reemplazan un periodo entero
   * (inventario); las demás lo ignoran. Ver carga-confirmacion.ts.
   */
  procesar(buffer: Buffer, nombre: string, ip?: string, confirmado?: boolean): Promise<ResultadoDataset>;
}

const nf = new Intl.NumberFormat("es-CO");

/** Procesa un dataset SIESA reutilizando procesarCarga (un archivo a la vez). */
async function procesarSiesa(clave: DatasetKey, titulo: string, buffer: Buffer, nombre: string, ip?: string, confirmado?: boolean): Promise<ResultadoDataset> {
  const res = await procesarCarga([{ clave, nombre, buffer }], ip, false, confirmado);
  const d = res.datasets[clave];
  if (!d) throw new Error(res.errores[0] ?? "No se pudo procesar el archivo.");
  return { ...d, titulo };
}

export const CARGAS: CargaDef[] = [
  {
    // El nombre lleva "por Facturar" y el módulo entre paréntesis a propósito:
    // se confundió en producción con "Pendientes por Despacho" del módulo de
    // Compras y se estuvo subiendo este archivo creyendo que actualizaba aquel,
    // con el informe de compras cinco días desactualizado sin que nadie lo
    // notara. Son dos reportes distintos y dos tablas distintas.
    clave: "pendientes", titulo: "🧾 Pedidos pendientes por FACTURAR · Comercial (NO es despacho)", grupo: "Comercial", permiso: "carga.pendientes",
    archivoSugerido: "PEDIDOS PENDIENTES ACUMULADOS.xlsx",
    procesar: (b, n, ip) => procesarSiesa("pendientes", "Pedidos Pendientes por Facturar", b, n, ip),
  },
  {
    clave: "ventas", titulo: "Ventas x Item", grupo: "Comercial", permiso: "carga.ventas",
    archivoSugerido: "2026.xlsx",
    procesar: (b, n, ip, confirmado) => procesarSiesa("ventas", "Ventas x Item", b, n, ip, confirmado),
  },
  {
    clave: "facturacion", titulo: "Facturación por Usuario", grupo: "Comercial", permiso: "carga.facturacion",
    archivoSugerido: "DATOS FACTURACIÓN.xlsx",
    procesar: (b, n, ip) => procesarSiesa("facturacion", "Facturación por Usuario", b, n, ip),
  },
  {
    clave: "gastos", titulo: "Gastos", grupo: "Financiero", permiso: "carga.gastos",
    archivoSugerido: "GASTOS.xlsx",
    procesar: (b, n, ip) => procesarSiesa("gastos", "Gastos", b, n, ip),
  },
  {
    clave: "anuladas", titulo: "Facturas Anuladas", grupo: "Comercial", permiso: "carga.anuladas",
    archivoSugerido: "MOTIVO FACTURAS ANULADAS.xlsx",
    procesar: (b, n, ip) => procesarSiesa("anuladas", "Facturas Anuladas", b, n, ip),
  },
  {
    clave: "pyg", titulo: "Estado de Resultados", grupo: "Financiero", permiso: "carga.pyg",
    archivoSugerido: "E.R. Consolidado 2026.xlsx",
    async procesar(buffer, nombre) {
      const anio = new Date().getFullYear();
      const { hoja, meses, omitidas } = parsePygExcel(buffer);
      if (!meses.length) throw new Error("No se encontró ninguna hoja-mes válida (ENERO…DICIEMBRE) con los totales del Estado de Resultados.");
      const cargadas = await persistirPyg(prisma, Prisma, anio, meses);
      const etiquetaMeses = meses.map((m) => m.mes).sort((a, b) => a - b);
      return {
        titulo: "Estado de Resultados", archivo: nombre, hoja,
        filas: meses.length, cargadas, omitidas,
        estrategia: `upsert ${anio}: ${cargadas} mes(es) [${etiquetaMeses.join(", ")}] agregados/actualizados`,
      };
    },
  },
  {
    clave: "flujo", titulo: "Ingresos y Egresos", grupo: "Financiero", permiso: "carga.flujo",
    archivoSugerido: "Flujo de Caja Diario.xlsx",
    async procesar(buffer, nombre, ip) {
      const r = await sincronizarFlujoDesdeBuffer(buffer, ip, false);
      if (!r.ok) throw new Error(r.error ?? "No se pudo procesar el flujo de caja.");
      const cats = r.categoriasCreadas.length ? ` · ${r.categoriasCreadas.length} categoría(s) nueva(s)` : "";
      return {
        titulo: "Ingresos y Egresos", archivo: nombre, hoja: "Flujo Caja",
        filas: r.movimientos + r.omitidas, cargadas: r.movimientos, omitidas: r.omitidas,
        estrategia: `reemplaza año(s) ${r.anios.join(", ")}: ${nf.format(r.movimientos)} movimientos (ing. ${nf.format(r.ingresos)} / egr. ${nf.format(r.egresos)})${cats}`,
      };
    },
  },
  {
    clave: "presupuesto", titulo: "Presupuesto de Egresos", grupo: "Financiero", permiso: "carga.presupuesto",
    archivoSugerido: "PRESUPUESTO BIO STEEL PROYECTADO 2026.xlsx",
    async procesar(buffer, nombre) {
      const anio = new Date().getFullYear();
      const parse = parsePresupuesto(buffer);
      if (!parse.filas.length) throw new Error("No se encontraron valores de presupuesto (hoja Presupuesto_Terceros, columnas ENE..DIC).");
      const { cargadas, meses } = await persistirPresupuesto(prisma, anio, parse);
      const ignoradas = parse.columnasIgnoradas.length
        ? ` · ⚠️ columna(s) sin reconocer, revisa el encabezado: ${parse.columnasIgnoradas.join(", ")}`
        : "";
      return {
        titulo: "Presupuesto de Egresos", archivo: nombre, hoja: parse.hoja,
        filas: parse.filas.length, cargadas, omitidas: parse.omitidas,
        estrategia: `reemplaza ${anio} meses [${meses.join(", ")}]: ${nf.format(cargadas)} renglones de presupuesto${ignoradas}`,
      };
    },
  },
  // --- Inventario de material de osteosíntesis ---
  // El orden importa: los movimientos se rechazan si su bodega no está en el
  // catálogo, así que las Tablas Auxiliares se cargan primero.
  {
    clave: "inv-bodegas", titulo: "Inventario · Tablas Auxiliares", grupo: "Inventario", permiso: "carga.inv.bodegas",
    archivoSugerido: "TABLAS AUXILIARES.xlsx",
    async procesar(buffer, nombre) {
      const bodegas = parseTablasAuxiliares(buffer);
      const cargadas = await persistirBodegas(bodegas);
      const inferidas = bodegas.filter((b) => b.inferida).length;
      const porInst = Object.keys(INSTALACIONES).map(Number).map((i) => `${i}: ${bodegas.filter((b) => b.instalacion === i).length}`).join(" · ");
      return {
        titulo: "Inventario · Tablas Auxiliares", archivo: nombre, hoja: "CÓDIGOS DE BODEGA",
        filas: bodegas.length, cargadas, omitidas: 0,
        estrategia: `upsert de ${cargadas} bodega(s) [${porInst}]${inferidas ? ` · ${inferidas} con instalación inferida (no venían en el catálogo)` : ""}`,
      };
    },
  },
  {
    clave: "inv-balance", titulo: "Inventario · Balance mensual", grupo: "Inventario", permiso: "carga.inv.balance",
    archivoSugerido: "1. BALANCE ENERO.xlsx",
    async procesar(buffer, nombre, _ip, confirmado) {
      const b = await parseBalance(buffer, nombre);
      if (!b.datos.length) throw new Error("El balance no trae ninguna fila con saldo o movimiento.");
      if (!confirmado) {
        const perdida = await loQuePerderiaElBalance(b);
        if (perdida) throw new CargaRequiereConfirmacion(perdida);
      }
      const cargadas = await persistirBalance(b);
      const detalle = b.porBodega ? "por bodega" : "solo por instalación (export viejo, sin columna Bodega)";
      const desc = b.descRellenadas || b.descFaltantes
        ? ` · el archivo no trae "Desc. item": ${nf.format(b.descRellenadas)} descripciones rellenadas desde lo ya cargado${b.descFaltantes ? `, ${nf.format(b.descFaltantes)} sin fuente` : ""}`
        : "";
      const nuevas = b.bodegasNuevas.size ? ` · ${b.bodegasNuevas.size} bodega(s) dadas de alta: ${[...b.bodegasNuevas.keys()].join(", ")}` : "";
      const choques = b.choques.size
        ? ` · ${b.choques.size} bodega(s) donde manda el balance sobre el catálogo: ${[...b.choques].map(([c, x]) => `${c} (${x.catalogo}→${x.archivo})`).join(", ")}`
        : "";
      return {
        titulo: "Inventario · Balance mensual", archivo: nombre, hoja: b.hoja,
        filas: b.filas, cargadas, omitidas: b.filas - cargadas,
        estrategia: `reemplaza ${b.mes}/${b.anio} ${detalle}: ${nf.format(cargadas)} fila(s) con saldo o movimiento (se descartan las que están en cero)${desc}${nuevas}${choques}`,
      };
    },
  },
  {
    clave: "inv-movimientos", titulo: "Inventario · Movimientos", grupo: "Inventario", permiso: "carga.inv.movimientos",
    archivoSugerido: "MOVIMIENTOS DE INVENTARIO.xlsx",
    async procesar(buffer, nombre, _ip, confirmado) {
      const catalogo = new Map((await prisma.invBodega.findMany({ select: { codigo: true, instalacion: true } })).map((b) => [b.codigo, b.instalacion]));
      const m = parseMovimientos(buffer, catalogo);
      if (!m.datos.length) throw new Error("El archivo no trae movimientos con instalación identificable.");
      if (!confirmado) {
        const perdida = await diasQueBorrariaMovimientos(m);
        if (perdida) throw new CargaRequiereConfirmacion(perdida);
      }
      const cargadas = await persistirMovimientos(m);
      const nuevas = m.bodegasNuevas.size ? ` · ${m.bodegasNuevas.size} bodega(s) dadas de alta desde el archivo [${[...m.bodegasNuevas.keys()].join(", ")}]` : "";
      const choque = m.choques.size ? ` · ${m.choques.size} bodega(s) donde el catálogo dice otra instalación (manda el archivo): ${[...m.choques].map(([k, v]) => `${k} ${v.catalogo}→${v.archivo}`).join(", ")}` : "";
      const sinBodega = m.bodegasDesconocidas.size
        ? ` · OJO: ${m.bodegasDesconocidas.size} bodega(s) sin instalación quedaron fuera [${[...m.bodegasDesconocidas.keys()].join(", ")}]`
        : "";
      return {
        titulo: "Inventario · Movimientos", archivo: nombre, hoja: m.hoja,
        filas: m.filas, cargadas, omitidas: m.filas - cargadas,
        estrategia: `reemplaza ${m.periodos.length} periodo(s) [${m.periodos[0]} … ${m.periodos[m.periodos.length - 1]}]: ${nf.format(cargadas)} movimientos${nuevas}${choque}${sinBodega}`,
      };
    },
  },
  // --- Compras ---
  // El catálogo de tipos va primero: es el que alimenta el filtro "tipo de
  // compra" del informe. Los otros tres son independientes entre sí.
  {
    clave: "compras-tipos", titulo: "Compras · Tipos de Proveedores", grupo: "Compras", permiso: "carga.compras.tipos",
    // Es una HOJA del libro de Tablas Auxiliares, el mismo de las bodegas:
    // el parser la localiza por sus columnas, no por el nombre del archivo.
    archivoSugerido: "TABLAS AUXILIARES.xlsx (hoja TIPOS DE PROVEEDORES)",
    async procesar(buffer, nombre) {
      const lista = parseTiposProveedor(buffer);
      if (!lista.length) throw new Error("El archivo no trae ningún proveedor con tipo de compra.");
      const cargadas = await persistirTiposProveedor(lista);
      const tipos = [...new Set(lista.map((p) => p.tipoCompra))].filter(Boolean);
      return {
        titulo: "Compras · Tipos de Proveedores", archivo: nombre, hoja: "TIPOS DE PROVEEDORES",
        filas: lista.length, cargadas, omitidas: 0,
        estrategia: `upsert de ${nf.format(cargadas)} proveedor(es) · tipos: ${tipos.join(", ")}`,
      };
    },
  },
  {
    clave: "compras-ordenes", titulo: "Compras · Órdenes de Compra", grupo: "Compras", permiso: "carga.compras.ordenes",
    archivoSugerido: "ORDENES DE COMPRA.xlsx",
    async procesar(buffer, nombre) {
      const p = parseOrdenes(buffer);
      if (!p.datos.length) throw new Error("El archivo no trae órdenes con fecha válida.");
      const cargadas = await persistirOrdenes(p);
      const ordenes = new Set(p.datos.map((d) => d.nroOrden)).size;
      const total = p.datos.reduce((a, d) => a + Number(d.valorNeto), 0);
      return {
        titulo: "Compras · Órdenes de Compra", archivo: nombre, hoja: p.hoja,
        filas: p.filas, cargadas, omitidas: p.omitidas,
        estrategia: `reemplaza ${p.periodos.length} periodo(s) [${p.periodos[0]} … ${p.periodos[p.periodos.length - 1]}]: ${nf.format(cargadas)} renglones · ${nf.format(ordenes)} órdenes · ${nf.format(Math.round(total))}`,
      };
    },
  },
  {
    clave: "compras-pendientes", titulo: "🚚 Pendientes por DESPACHO del proveedor · Compras (NO es facturación)", grupo: "Compras", permiso: "carga.compras.pendientes",
    archivoSugerido: "PENDIENTES POR DESPACHO.xlsx",
    async procesar(buffer, nombre) {
      const p = parsePendientesDespacho(buffer);
      if (!p.datos.length) throw new Error("El archivo no trae pendientes con fecha válida.");
      const cargadas = await persistirPendientesDespacho(p);
      const ordenes = new Set(p.datos.map((d) => d.nroOrden)).size;
      const total = p.datos.reduce((a, d) => a + Number(d.valorPendiente), 0);
      return {
        titulo: "Compras · Pendientes por Despacho del Proveedor", archivo: nombre, hoja: p.hoja,
        filas: p.filas, cargadas, omitidas: p.omitidas,
        estrategia: `reemplaza TODA la foto anterior: ${nf.format(cargadas)} renglones · ${nf.format(ordenes)} órdenes pendientes · ${nf.format(Math.round(total))}`,
      };
    },
  },
  // --- Pedidos del bloque quirúrgico ---
  // OJO: no confundir con "Pedidos Pendientes" (grupo Comercial), que es el
  // reporte de pendientes por facturar y va a otra tabla.
  {
    clave: "pedidos", titulo: "Pedidos · Detalle por ítem", grupo: "Pedidos", permiso: "carga.pedidos",
    archivoSugerido: "PEDIDOS 2026.xlsx",
    async procesar(buffer, nombre) {
      const p = parsePedidos(buffer);
      if (!p.datos.length) throw new Error("El archivo no trae pedidos con fecha válida.");
      const cargadas = await persistirPedidos(p);
      const docs = new Set(p.datos.map((d) => d.nroDocumento)).size;
      const refs = new Set(p.datos.map((d) => d.referencia)).size;
      const costo = p.datos.reduce((a, d) => a + Number(d.costoProm), 0);
      return {
        titulo: "Pedidos · Detalle por ítem", archivo: nombre, hoja: p.hoja,
        filas: p.filas, cargadas, omitidas: p.omitidas,
        estrategia: `reemplaza ${p.periodos.length} periodo(s) [${p.periodos[0]} … ${p.periodos[p.periodos.length - 1]}]: ${nf.format(cargadas)} renglones · ${nf.format(docs)} pedidos · ${nf.format(refs)} referencias · costo ${nf.format(Math.round(costo))}`,
      };
    },
  },
  // --- Indicadores de calidad de Compras (FOR-GC-011) ---
  // Los lleva a mano el Líder de Compras; no salen de SIESA.
  {
    clave: "ind-compras", titulo: "Indicadores · Órdenes recibidas completas", grupo: "Compras", permiso: "carga.indicador.compras",
    archivoSugerido: "indicador de compra.xlsx",
    async procesar(buffer, nombre) {
      const p = parseIndicadorCompras(buffer);
      if (!p.datos.length) throw new Error("El archivo no trae ningún mes con órdenes totales.");
      const cargadas = await persistirIndicadorCompras(p);
      const completas = p.datos.reduce((a, d) => a + d.ordenesCompletas, 0);
      const totales = p.datos.reduce((a, d) => a + d.ordenesTotales, 0);
      const pct = totales > 0 ? (completas / totales) * 100 : 0;
      const sinDato = p.omitidas ? ` · ${p.omitidas} mes(es) todavía sin diligenciar` : "";
      return {
        titulo: "Indicadores · Órdenes recibidas completas", archivo: nombre, hoja: p.hoja,
        filas: p.filas, cargadas, omitidas: p.omitidas,
        estrategia: `upsert ${p.anio}: ${cargadas} mes(es) · ${nf.format(completas)} de ${nf.format(totales)} órdenes completas (${pct.toFixed(1)} %)${sinDato}`,
      };
    },
  },
  {
    clave: "ind-proveedores", titulo: "Indicadores · Evaluación de Proveedores", grupo: "Compras", permiso: "carga.indicador.compras",
    archivoSugerido: "RELACION PROVEEDORES.xlsx",
    async procesar(buffer, nombre) {
      const p = parseEvaluacionProveedores(buffer);
      if (!p.evaluaciones.length) throw new Error("El archivo no trae ninguna hoja-mes con calificaciones.");
      const cargadas = await persistirEvaluacionProveedores(p);
      // Los avisos van en la misma línea del resultado, no en un log que nadie
      // lee: son errores del archivo que alguien tiene que corregir en la fuente.
      const avisos: string[] = [];
      if (p.pctCorregidos.length) avisos.push(`${p.pctCorregidos.length} % recalculado(s) porque no era total/5 [${p.pctCorregidos.slice(0, 3).join("; ")}${p.pctCorregidos.length > 3 ? "; …" : ""}]`);
      if (p.totalesRaros.length) avisos.push(`OJO: ${p.totalesRaros.length} TOTAL que no es la suma de sus criterios [${p.totalesRaros.slice(0, 3).join("; ")}]`);
      if (p.fueraDeCatalogo.length) avisos.push(`${p.fueraDeCatalogo.length} proveedor(es) evaluados que no están en PROVEEDORES ACTIVOS: ${p.fueraDeCatalogo.join(", ")}`);
      return {
        titulo: "Indicadores · Evaluación de Proveedores", archivo: nombre, hoja: "PROVEEDORES ACTIVOS + hojas-mes",
        filas: p.evaluaciones.length, cargadas, omitidas: 0,
        estrategia: `reemplaza ${p.anio} meses [${p.meses.join(", ")}]: ${nf.format(cargadas)} calificaciones · ${p.activos.length} proveedores en el catálogo${avisos.length ? ` · ${avisos.join(" · ")}` : ""}`,
      };
    },
  },
  {
    clave: "cirugias", titulo: "Cirugías · Consulta diaria", grupo: "Calidad", permiso: "carga.cirugias",
    archivoSugerido: "Consulta Cirugía Diaria.xlsx",
    async procesar(buffer, nombre) {
      const parse = parseCirugias(buffer);
      if (!parse.filas.length) throw new Error("No se encontraron cirugías (hoja 'Consulta Cirugía Diaria').");
      const cargadas = await persistirCirugias(prisma, parse.filas);
      return {
        titulo: "Cirugías · Consulta diaria", archivo: nombre, hoja: parse.hoja,
        filas: parse.filas.length + parse.omitidas, cargadas, omitidas: parse.omitidas,
        estrategia: `reemplaza todas las cirugías: ${nf.format(cargadas)} registros (dedup por documento)`,
      };
    },
  },
  {
    // Gestión Humana lleva el consolidado en un libro con una hoja por
    // capacitación; la app lee la hoja GENERAL, que es el resumen firmado.
    clave: "capacitaciones", titulo: "Capacitaciones · Consolidado", grupo: "Gestión Humana", permiso: "carga.capacitaciones",
    archivoSugerido: "CONSOLIDADO DE CAPACITACIONES I SEMESTRE 2026.xlsx",
    async procesar(buffer, nombre) {
      const p = parseCapacitaciones(buffer, nombre);
      const cargadas = await persistirCapacitaciones(p);
      const colaboradores = new Set(p.datos.map((d) => d.colaborador)).size;
      return {
        titulo: "Capacitaciones · Consolidado", archivo: nombre, hoja: p.hoja,
        filas: p.filas, cargadas, omitidas: p.omitidas,
        estrategia: `reemplaza ${p.periodos.length} periodo(s) [${p.periodos[0]} … ${p.periodos[p.periodos.length - 1]}]: ` +
          `${nf.format(cargadas)} registro(s) · ${p.capacitaciones} capacitación(es) · ${colaboradores} colaborador(es)` +
          (p.cronograma.length ? ` · cronograma: ${p.cronograma.length} capacitación(es) con su detalle` : ""),
      };
    },
  },
  {
    clave: "encuestas-inst", titulo: "Encuestas · Clientes institucionales", grupo: "Calidad", permiso: "carga.encuestas",
    archivoSugerido: "Consolidado_Completo_Encuestas_Satisfaccion.xlsx",
    async procesar(buffer, nombre) {
      const parse = parseInstitucional(buffer);
      if (!parse.filas.length) throw new Error("No se encontraron respuestas (hoja 'Respuestas detalladas').");
      const cargadas = await persistirEncuestas(prisma, "institucional", parse.filas);
      return {
        titulo: "Encuestas · Clientes institucionales", archivo: nombre, hoja: parse.hoja,
        filas: parse.filas.length, cargadas, omitidas: parse.omitidas,
        estrategia: `reemplaza las encuestas institucionales: ${nf.format(cargadas)} respuestas`,
      };
    },
  },
  {
    clave: "encuestas-ortho", titulo: "Encuestas · Ortopedistas", grupo: "Calidad", permiso: "carga.encuestas",
    archivoSugerido: "Encuesta de Satisfacción del Cliente – Ortopedistas.xlsx",
    async procesar(buffer, nombre) {
      const parse = parseOrtopedistas(buffer);
      if (!parse.filas.length) throw new Error("No se encontraron respuestas de ortopedistas en el formulario.");
      const cargadas = await persistirEncuestas(prisma, "ortopedista", parse.filas);
      return {
        titulo: "Encuestas · Ortopedistas", archivo: nombre, hoja: parse.hoja,
        filas: parse.filas.length, cargadas, omitidas: parse.omitidas,
        estrategia: `reemplaza las encuestas de ortopedistas: ${nf.format(cargadas)} respuestas`,
      };
    },
  },
  {
    clave: "compras-entradas", titulo: "Compras · Entradas por Compra", grupo: "Compras", permiso: "carga.compras.entradas",
    archivoSugerido: "ENTRADAS POR COMPRAS.xlsx",
    async procesar(buffer, nombre) {
      const p = parseEntradasProveedor(buffer);
      if (!p.datos.length) throw new Error("El archivo no trae entradas con fecha y proveedor.");
      const cargadas = await persistirEntradasProveedor(p);
      const amb = p.ambiguos.length
        ? ` · OJO: ${p.ambiguos.length} documento(s) con más de un proveedor, manda el primero [${p.ambiguos.slice(0, 5).join(", ")}]`
        : "";
      return {
        titulo: "Compras · Entradas por Compra", archivo: nombre, hoja: p.hoja,
        filas: p.filas, cargadas, omitidas: p.omitidas,
        estrategia: `reemplaza ${p.periodos.length} periodo(s) [${p.periodos[0]} … ${p.periodos[p.periodos.length - 1]}]: ${nf.format(cargadas)} documentos con proveedor (de ${nf.format(p.filas)} renglones). El valor sigue saliendo del movimiento de inventario.${amb}`,
      };
    },
  },
  {
    clave: "compras-facturas", titulo: "Compras · Facturas de Proveedores", grupo: "Compras", permiso: "carga.compras.facturas",
    archivoSugerido: "FACTURAS PROVEEDORES.xlsx",
    async procesar(buffer, nombre) {
      const p = parseFacturasProveedor(buffer);
      if (!p.datos.length) throw new Error("El archivo no trae documentos con fecha válida.");
      const cargadas = await persistirFacturasProveedor(p);
      const total = p.datos.reduce((a, d) => a + Number(d.valorNeto), 0);
      return {
        titulo: "Compras · Facturas de Proveedores", archivo: nombre, hoja: p.hoja,
        filas: p.filas, cargadas, omitidas: p.omitidas,
        estrategia: `reemplaza ${p.periodos.length} periodo(s) [${p.periodos[0]} … ${p.periodos[p.periodos.length - 1]}]: ${nf.format(cargadas)} documentos · ${nf.format(Math.round(total))}`,
      };
    },
  },
  {
    // Un libro con una hoja por año ("SALARIOS 2025", "SALARIOS 2026"); el
    // año sale del nombre de la hoja. Se guarda por (año, cédula): actualiza
    // y agrega, pero no borra a quien ya no aparezca en el archivo.
    clave: "nomina", titulo: "Nómina · Costo de Personal", grupo: "Gestión Humana", permiso: "carga.nomina",
    archivoSugerido: "Nomina.xlsx",
    async procesar(buffer, nombre) {
      const p = parseNomina(buffer);
      const cargadas = await persistirNomina(p);
      const porHoja = p.hojas.map((h) => `${h.hoja}: ${nf.format(h.empleados)} empl. · ${nf.format(Math.round(h.costoMensual))}/mes`).join(" · ");
      const omitidas = p.hojasOmitidas.length ? ` · hoja(s) sin año en el nombre, omitidas: ${p.hojasOmitidas.join(", ")}` : "";
      return {
        titulo: "Nómina · Costo de Personal", archivo: nombre, hoja: p.hojas.map((h) => h.hoja).join(", "),
        filas: p.datos.length + p.hojas.reduce((a, h) => a + h.omitidas, 0), cargadas, omitidas: p.hojas.reduce((a, h) => a + h.omitidas, 0),
        estrategia: `upsert por año/cédula [${porHoja}]${omitidas}`,
      };
    },
  },
];

export function cargaDef(clave: string): CargaDef | undefined {
  return CARGAS.find((c) => c.clave === clave);
}
