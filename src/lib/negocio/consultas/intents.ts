// ==========================================================
// Registro de intenciones del motor de consultas en lenguaje natural.
// Cada intención puntúa la pregunta (score) por palabras clave + señales de
// nlp.ts; el motor ejecuta la de mayor puntaje. run() llama a las funciones de
// negocio ya existentes y arma una Respuesta serializable.
// ==========================================================
import "server-only";
import type { UsuarioConRol } from "@/lib/auth/session";
import type { Alcance } from "@/lib/rbac/permissions";
import { alcanceDe } from "@/lib/rbac/authorize";
import { formatCOP, formatNumero, formatPorcentaje } from "@/lib/format";

import * as ventas from "@/lib/negocio/ventas";
import * as flujo from "@/lib/negocio/flujo";
import * as nomina from "@/lib/negocio/nomina";
import * as pyg from "@/lib/negocio/pyg";
import * as cxp from "@/lib/negocio/cxp";
import * as cartera from "@/lib/negocio/cartera";
import * as obligaciones from "@/lib/negocio/obligaciones";
import * as impuestos from "@/lib/negocio/impuestos";
import * as inventario from "@/lib/negocio/inventario";
import * as indicadores from "@/lib/negocio/indicadores";
import * as pendientes from "@/lib/negocio/pendientes";

import type { Metrica } from "./tipos";
import type { Respuesta } from "./tipos";
import {
  cMonto, cNum, cPct, cTxt, tabla, mesLabel, etiquetaPeriodo, elegirAnio,
  rankDesde, LABEL_METRICA, N_DEFECTO,
} from "./helpers";

// ---- Contexto que recibe cada intención ----
export interface Ctx {
  texto: string;      // pregunta normalizada (minúsculas, sin tildes)
  original: string;
  anios: number[];
  meses: number[];
  topN: number | null;
  metrica: Metrica;
  extremo: "mejor" | "peor" | null;
  ranking: boolean;
  anioActual: number;
  usuario: UsuarioConRol;
  alcance: Alcance;
}

export interface Intent {
  id: string;
  ejemplo: string;
  score(ctx: Ctx): number;
  run(ctx: Ctx): Promise<Respuesta>;
}

// ---- Utilidades de puntaje ----
const has = (c: Ctx, ...w: string[]) => w.some((x) => c.texto.includes(x));
const cuenta = (c: Ctx, w: string[]) => w.reduce((n, x) => (c.texto.includes(x) ? n + 1 : n), 0);
const N = (c: Ctx) => c.topN ?? N_DEFECTO;
const CAP = 15; // filas máximas en tablas de detalle

// Palabras de módulo (para desambiguar)
const K_VENTA = ["venta", "vend", "facturado", "consumo", "vendio", "vendido"];
const K_CXP = ["por pagar", "cxp", "cuentas por pagar", "debemos", "adeuda", "saldo proveedor", "pagar a"];

// ==========================================================
// VENTAS
// ==========================================================

const topClientes: Intent = {
  id: "ventas.top-clientes",
  ejemplo: "Dame el top 5 de clientes del año",
  score(c) {
    if (!has(c, "cliente", "ips")) return 0; // exige la dimensión
    let s = 3;
    if (c.ranking) s += 2;
    if (has(c, ...K_VENTA)) s += 1;
    if (has(c, "cartera", "debe", "por cobrar", "por pagar", "proveedor", "ciudad")) s -= 4;
    return s;
  },
  async run(c) {
    const anios = await ventas.aniosConVenta();
    const anio = elegirAnio(c.anios, anios, c.anioActual);
    const filas = await ventas.ventaPorCliente(anio, c.meses.length ? c.meses : undefined);
    if (!filas.length) return vacio("Clientes", `No hay ventas cargadas para ${etiquetaPeriodo(anio, c.meses)}.`);
    const items = rankDesde(filas, (f) => f.clienteNombre, c.metrica);
    const n = N(c);
    const top = items.slice(0, n);
    const detalle = filas.slice(0, Math.max(n, CAP));
    return {
      ok: true,
      titulo: `Top ${n} clientes · ${etiquetaPeriodo(anio, c.meses)}`,
      resumen: `El mayor cliente por ${LABEL_METRICA[c.metrica]} en ${etiquetaPeriodo(anio, c.meses)} es ${top[0]!.label} con ${fmtMetrica(top[0]!.valor, c.metrica)}. Hay ${formatNumero(filas.length)} clientes con ventas.`,
      ranking: { titulo: `Mayores clientes por ${LABEL_METRICA[c.metrica]}`, items, color: "var(--brand)", inicial: n },
      tabla: tablaVentas(detalle, (f) => f.clienteNombre, "Cliente"),
      nota: filas.length > detalle.length ? `Se listan ${detalle.length} de ${formatNumero(filas.length)} clientes.` : undefined,
      sugerencias: ["Top 5 proveedores del año", "¿Cuál es el mes que más se ha vendido?", "Ventas por ciudad"],
    };
  },
};

const topProveedores: Intent = {
  id: "ventas.top-proveedores",
  ejemplo: "¿Cuál es el top de proveedores?",
  score(c) {
    if (!has(c, "proveedor", "marca", "laboratorio", "casa")) return 0; // exige la dimensión
    let s = 3;
    if (c.ranking) s += 2;
    if (has(c, ...K_VENTA, "compra", "consumo")) s += 1;
    if (has(c, ...K_CXP)) s -= 5; // eso es CxP, no ventas por marca
    if (has(c, "cliente", "ciudad")) s -= 3;
    return s;
  },
  async run(c) {
    const anios = await ventas.aniosConVenta();
    const anio = elegirAnio(c.anios, anios, c.anioActual);
    const filas = await ventas.ventaPorMarca(anio, c.meses.length ? c.meses : undefined);
    if (!filas.length) return vacio("Proveedores", `No hay ventas por proveedor para ${etiquetaPeriodo(anio, c.meses)}.`);
    const items = rankDesde(filas, (f) => f.marca, c.metrica);
    const n = N(c);
    const top = items.slice(0, n);
    return {
      ok: true,
      titulo: `Top ${n} proveedores · ${etiquetaPeriodo(anio, c.meses)}`,
      resumen: `El mayor proveedor por ${LABEL_METRICA[c.metrica]} en ${etiquetaPeriodo(anio, c.meses)} es ${top[0]!.label} con ${fmtMetrica(top[0]!.valor, c.metrica)}. Hay ${formatNumero(filas.length)} proveedores con venta.`,
      ranking: { titulo: `Mayores proveedores por ${LABEL_METRICA[c.metrica]}`, items, color: "var(--brand)", inicial: n },
      tabla: tablaVentas(filas.slice(0, Math.max(n, CAP)), (f) => f.marca, "Proveedor"),
      sugerencias: ["Top 5 clientes del año", "Consumos por proveedor con % de utilidad", "Ventas por línea"],
    };
  },
};

const topLineas: Intent = {
  id: "ventas.top-lineas",
  ejemplo: "Top de líneas de negocio",
  score(c) {
    if (!has(c, "linea", "especialidad", "categoria de producto")) return 0; // exige la dimensión
    let s = 3;
    if (c.ranking) s += 1;
    if (has(c, ...K_VENTA)) s += 1;
    return s;
  },
  async run(c) {
    const anios = await ventas.aniosConVenta();
    const anio = elegirAnio(c.anios, anios, c.anioActual);
    const filas = await ventas.ventaPorLinea(anio, c.meses.length ? c.meses : undefined);
    if (!filas.length) return vacio("Líneas", `No hay ventas por línea para ${etiquetaPeriodo(anio, c.meses)}.`);
    const items = rankDesde(filas, (f) => f.linea, c.metrica);
    const n = N(c);
    return {
      ok: true,
      titulo: `Ventas por línea · ${etiquetaPeriodo(anio, c.meses)}`,
      resumen: `La línea líder por ${LABEL_METRICA[c.metrica]} es ${items[0]!.label} con ${fmtMetrica(items[0]!.valor, c.metrica)} (${formatNumero(filas.length)} líneas).`,
      ranking: { titulo: `Mayores líneas por ${LABEL_METRICA[c.metrica]}`, items, color: "var(--brand)", inicial: n },
      tabla: tablaVentas(filas.slice(0, Math.max(n, CAP)), (f) => f.linea, "Línea"),
      sugerencias: ["Top 5 clientes", "Top proveedores", "Resumen de ventas del año"],
    };
  },
};

const mejorMes: Intent = {
  id: "ventas.mejor-mes",
  ejemplo: "¿Cuál es el mes que más se ha vendido en 2026?",
  score(c) {
    const porMes = has(c, "mes", "mensual");
    if (!porMes) return 0; // exige hablar de meses
    let s = 2;
    if (c.extremo) s += 3;
    if (has(c, ...K_VENTA)) s += 1;
    if (has(c, "cliente", "proveedor", "linea", "ciudad")) s -= 3;
    return s;
  },
  async run(c) {
    const anios = await ventas.aniosConVenta();
    const anio = elegirAnio(c.anios, anios, c.anioActual);
    const detalle = await ventas.ventaMensualDetalle(anio);
    const conVenta = detalle.filter((m) => m.venta !== 0);
    if (!conVenta.length) return vacio("Ventas por mes", `No hay ventas cargadas en ${anio}.`);
    const orden = [...conVenta].sort((a, b) => b.venta - a.venta);
    const mejor = orden[0]!, peor = orden[orden.length - 1]!;
    const foco = c.extremo === "peor" ? peor : mejor;
    const total = conVenta.reduce((s, m) => s + m.venta, 0);
    return {
      ok: true,
      titulo: `Ventas por mes · ${anio}`,
      resumen: c.extremo === "peor"
        ? `El mes de menor venta en ${anio} es ${mesLabel(peor.mes)} con ${formatCOP(peor.venta)}.`
        : `El mes de mayor venta en ${anio} es ${mesLabel(mejor.mes)} con ${formatCOP(mejor.venta)}. Total del año: ${formatCOP(total)}.`,
      kpis: [
        { label: `Mejor mes (${mesLabel(mejor.mes)})`, valor: mejor.venta, tipo: "monto", tono: "ok" },
        { label: `Mes más flojo (${mesLabel(peor.mes)})`, valor: peor.venta, tipo: "monto" },
        { label: "Total año", valor: total, tipo: "monto" },
      ],
      ranking: {
        titulo: `Venta por mes · ${anio}`,
        items: conVenta.map((m) => ({ label: mesLabel(m.mes), valor: m.venta, sub: `util. ${formatPorcentaje(m.venta > 0 ? ((m.venta - m.costo) / m.venta) * 100 : 0)}` })),
        color: "var(--brand)", inicial: 12,
      },
      nota: `Mes destacado: ${mesLabel(foco.mes)}.`,
      sugerencias: ["Top 5 clientes del año", "Resumen de ventas del año", "Ventas por línea"],
    };
  },
};

const resumenVentas: Intent = {
  id: "ventas.resumen",
  ejemplo: "¿Cuánto hemos vendido este año?",
  score(c) {
    let s = 0;
    if (has(c, ...K_VENTA)) s += 2;
    if (has(c, "cuanto", "total", "resumen", "utilidad", "margen", "costo")) s += 1;
    // Pierde frente a intents más específicos (ranking, mes, ciudad).
    if (c.ranking) s -= 2;
    if (has(c, "cliente", "proveedor", "linea", "mes", "ciudad")) s -= 2;
    return s;
  },
  async run(c) {
    const anios = await ventas.aniosConVenta();
    const anio = elegirAnio(c.anios, anios, c.anioActual);
    const meses = c.meses.length ? c.meses : undefined;
    const k = await ventas.resumenAnual(anio, meses);
    if (k.venta === 0) return vacio("Ventas", `No hay ventas cargadas para ${etiquetaPeriodo(anio, c.meses)}.`);
    return {
      ok: true,
      titulo: `Resumen de ventas · ${etiquetaPeriodo(anio, c.meses)}`,
      resumen: `En ${etiquetaPeriodo(anio, c.meses)} la venta neta fue ${formatCOP(k.venta)}, con utilidad de ${formatCOP(k.utilidad)} (margen ${formatPorcentaje(k.margen)}).`,
      kpis: [
        { label: "Venta neta", valor: k.venta, tipo: "monto" },
        { label: "Costo", valor: k.costo, tipo: "monto" },
        { label: "Utilidad", valor: k.utilidad, tipo: "monto", tono: k.utilidad >= 0 ? "ok" : "bad" },
        { label: "Margen", valor: k.margen, tipo: "porcentaje" },
      ],
      sugerencias: ["Top 5 clientes del año", "¿Cuál es el mes que más se ha vendido?", "Top proveedores"],
    };
  },
};

const ventasCiudad: Intent = {
  id: "ventas.ciudad",
  ejemplo: "Ventas por ciudad",
  score(c) {
    if (!has(c, "ciudad", "region", "departamento")) return 0; // exige la dimensión
    let s = 3;
    if (has(c, ...K_VENTA)) s += 1;
    if (has(c, "cartera")) s -= 4;
    return s;
  },
  async run(c) {
    const anios = await ventas.aniosConVenta();
    const anio = elegirAnio(c.anios, anios, c.anioActual);
    const filas = await ventas.ventaPorCiudad(anio, c.meses.length ? c.meses : undefined);
    if (!filas.length) return vacio("Ciudades", `No hay ventas para ${etiquetaPeriodo(anio, c.meses)}.`);
    const n = N(c);
    return {
      ok: true,
      titulo: `Ventas por ciudad · ${etiquetaPeriodo(anio, c.meses)}`,
      resumen: `La ciudad con mayor venta es ${filas[0]!.ciudad} con ${formatCOP(filas[0]!.valor)} (${formatNumero(filas.length)} ciudades).`,
      ranking: { titulo: "Mayores ciudades por venta neta", items: filas.map((f) => ({ label: f.ciudad, valor: f.valor, sub: `${formatNumero(f.clientes)} clientes` })), color: "var(--brand)", inicial: n },
      tabla: tabla(
        [{ titulo: "Ciudad" }, { titulo: "Clientes", align: "r" }, { titulo: "Venta neta", align: "r" }],
        filas.slice(0, CAP).map((f) => [cTxt(f.ciudad), cNum(f.clientes), cMonto(f.valor)]),
      ),
      sugerencias: ["Top 5 clientes", "Resumen de ventas del año"],
    };
  },
};

// ==========================================================
// FLUJO DE CAJA
// ==========================================================

const flujoResumen: Intent = {
  id: "flujo.resumen",
  ejemplo: "¿Cómo va el flujo de caja este año?",
  score(c) {
    let s = 0;
    if (has(c, "flujo", "caja", "ingresos", "egresos", "recaudo", "neto de caja")) s += 3;
    if (has(c, "presupuesto", "ejecucion")) s -= 1; // hay intent específico
    if (has(c, "venta")) s -= 1;
    return s;
  },
  async run(c) {
    const anio = elegirAnio(c.anios, [], c.anioActual);
    const t = await flujo.totalesFlujo(anio);
    const mensual = await flujo.flujoMensual(anio);
    if (t.ingresos === 0 && t.egresos === 0) return vacio("Flujo de caja", `No hay movimientos de flujo cargados en ${anio}.`);
    return {
      ok: true,
      titulo: `Flujo de caja · ${anio}`,
      resumen: `En ${anio} los ingresos suman ${formatCOP(t.ingresos)} y los egresos ${formatCOP(t.egresos)}, con neto de ${formatCOP(t.neto)} (ejecución del presupuesto ${formatPorcentaje(t.ejecucion)}).`,
      kpis: [
        { label: "Ingresos", valor: t.ingresos, tipo: "monto", tono: "ok" },
        { label: "Egresos", valor: t.egresos, tipo: "monto", tono: "bad" },
        { label: "Neto", valor: t.neto, tipo: "monto", tono: t.neto >= 0 ? "ok" : "bad" },
        { label: "Ejecución ppto.", valor: t.ejecucion, tipo: "porcentaje" },
      ],
      tabla: tabla(
        [{ titulo: "Mes" }, { titulo: "Ingresos", align: "r" }, { titulo: "Egresos", align: "r" }, { titulo: "Neto", align: "r" }],
        mensual.filter((m) => m.ingresos || m.egresos).map((m) => [cTxt(mesLabel(m.mes)), cMonto(m.ingresos), cMonto(m.egresos), cMonto(m.neto, m.neto >= 0 ? "ok" : "bad")]),
        [cTxt("Total"), cMonto(t.ingresos), cMonto(t.egresos), cMonto(t.neto)],
      ),
      sugerencias: ["Presupuesto vs real", "Cartera por cobrar", "Cuentas por pagar"],
    };
  },
};

const presupuesto: Intent = {
  id: "flujo.presupuesto",
  ejemplo: "Presupuesto vs real por categoría",
  score(c) {
    let s = 0;
    if (has(c, "presupuesto", "ppto", "ejecucion", "desviacion", "vs real", "planeado")) s += 3;
    return s;
  },
  async run(c) {
    const anio = elegirAnio(c.anios, [], c.anioActual);
    const mes = c.meses.length === 1 ? c.meses[0] : undefined;
    const filas = await flujo.presupuestoVsReal(anio, mes !== undefined ? [mes] : undefined);
    if (!filas.length) return vacio("Presupuesto", `No hay presupuesto/ejecución para ${anio}.`);
    return {
      ok: true,
      titulo: `Presupuesto vs real · ${mes ? mesLabel(mes) + " " : ""}${anio}`,
      resumen: `Comparativo de presupuesto contra ejecución real por categoría en ${mes ? mesLabel(mes) + " " : ""}${anio}.`,
      tabla: tabla(
        [{ titulo: "Categoría" }, { titulo: "Presupuesto", align: "r" }, { titulo: "Real", align: "r" }, { titulo: "Desv.", align: "r" }, { titulo: "Ejec.", align: "r" }],
        filas.slice(0, 20).map((f) => [cTxt(f.categoria), cMonto(f.presupuesto), cMonto(f.real), cMonto(f.desviacion, f.desviacion >= 0 ? "ok" : "bad"), cPct(f.ejecucion)]),
      ),
      sugerencias: ["¿Cómo va el flujo de caja?", "Indicadores del período"],
    };
  },
};

// ==========================================================
// NÓMINA
// ==========================================================

const nominaResumen: Intent = {
  id: "nomina.resumen",
  ejemplo: "¿Cuánto cuesta la nómina este año?",
  score(c) {
    let s = 0;
    if (has(c, "nomina", "empleado", "personal", "headcount", "planta", "salario", "sueldo")) s += 3;
    return s;
  },
  async run(c) {
    const anios = await nomina.aniosConNomina();
    const anio = elegirAnio(c.anios, anios, c.anioActual);
    const k = await nomina.resumenAnual(anio);
    if (!k.headcount) return vacio("Nómina", `No hay nómina cargada para ${anio}.`);
    const empresa = await nomina.porProceso(anio);
    return {
      ok: true,
      titulo: `Nómina · ${anio}`,
      resumen: `En ${anio} la planta es de ${formatNumero(k.headcount)} empleados con un costo mensual de ${formatCOP(k.costoMensual)} (anual ${formatCOP(k.costoAnual)}). Salario promedio ${formatCOP(k.salarioPromedio)}.`,
      kpis: [
        { label: "Empleados", valor: k.headcount, tipo: "numero" },
        { label: "Costo mensual", valor: k.costoMensual, tipo: "monto" },
        { label: "Costo anual", valor: k.costoAnual, tipo: "monto" },
        { label: "Salario prom.", valor: k.salarioPromedio, tipo: "monto" },
      ],
      ranking: empresa.length ? { titulo: "Costo mensual por proceso", items: empresa.map((f) => ({ label: f.label, valor: f.costoMensual, sub: `${formatNumero(f.headcount)} pers.` })), color: "var(--brand)", inicial: N(c) } : undefined,
      sugerencias: ["Nómina por proceso", "Resumen de ventas del año"],
    };
  },
};

// ==========================================================
// PyG / ESTADO DE RESULTADOS
// ==========================================================

const pygResumen: Intent = {
  id: "pyg.resumen",
  ejemplo: "¿Cuál es la utilidad neta del año?",
  score(c) {
    let s = 0;
    if (has(c, "pyg", "estado de resultado", "utilidad neta", "margen neto", "utilidad operacional", "utilidad bruta", "ganancia neta", "p&g", "p y g")) s += 3;
    if (has(c, "utilidad", "margen") && !has(c, "cliente", "proveedor", "linea")) s += 1;
    return s;
  },
  async run(c) {
    const anio = elegirAnio(c.anios, [], c.anioActual);
    const meses = await pyg.listarPyg(anio);
    if (!meses.length) return vacio("PyG", `No hay Estados de Resultados cargados para ${anio}.`);
    const acc = pyg.acumuladoPyg(meses);
    const ultimo = meses[meses.length - 1]!;
    return {
      ok: true,
      titulo: `Estado de Resultados · ${anio} (acum. a ${mesLabel(ultimo.mes)})`,
      resumen: `Acumulado ${anio} (Ene–${mesLabel(ultimo.mes)}): venta neta ${formatCOP(acc.ventasNetas)}, utilidad neta ${formatCOP(acc.utilidadNeta)} (margen neto ${formatPorcentaje(acc.margenNeto)}).`,
      kpis: [
        { label: "Venta neta", valor: acc.ventasNetas, tipo: "monto" },
        { label: "Utilidad bruta", valor: acc.utilidadBruta, tipo: "monto" },
        { label: "Utilidad operacional", valor: acc.utilidadOperacional, tipo: "monto" },
        { label: "Utilidad neta", valor: acc.utilidadNeta, tipo: "monto", tono: acc.utilidadNeta >= 0 ? "ok" : "bad" },
        { label: "Margen neto", valor: acc.margenNeto, tipo: "porcentaje" },
      ],
      tabla: tabla(
        [{ titulo: "Mes" }, { titulo: "Venta neta", align: "r" }, { titulo: "Ut. bruta", align: "r" }, { titulo: "Ut. neta", align: "r" }, { titulo: "Mg. neto", align: "r" }],
        meses.map((m) => [cTxt(mesLabel(m.mes)), cMonto(m.ventasNetas), cMonto(m.utilidadBruta), cMonto(m.utilidadNeta, m.utilidadNeta >= 0 ? "ok" : "bad"), cPct(m.margenNeto)]),
      ),
      sugerencias: ["Resumen de ventas del año", "¿Cómo va el flujo de caja?", "Indicadores del período"],
    };
  },
};

// ==========================================================
// CARTERA (requiere usuario + alcance)
// ==========================================================

const carteraResumen: Intent = {
  id: "cartera.resumen",
  ejemplo: "¿Cuánta cartera tenemos por cobrar?",
  score(c) {
    let s = 0;
    if (has(c, "cartera", "por cobrar", "cobrar", "vencido", "recaudo pendiente")) s += 3;
    if (has(c, "pagar", "proveedor")) s -= 2;
    return s;
  },
  async run(c) {
    const alc = await alcanceDe(c.usuario, "cartera.view");
    if (alc === "ninguno") return vacio("Cartera", "No tienes permiso para consultar la cartera.");
    const r = await cartera.resumenCartera(c.usuario, alc);
    if (r.total === 0) return vacio("Cartera", "No hay cartera pendiente registrada.");
    const clientes = await cartera.carteraPorCliente(c.usuario, alc);
    return {
      ok: true,
      titulo: "Cartera por cobrar",
      resumen: `La cartera total es ${formatCOP(r.total)} en ${formatNumero(r.cantidadFacturas)} facturas; ${formatCOP(r.vencido)} está vencido y ${formatCOP(r.alDia)} al día.`,
      kpis: [
        { label: "Cartera total", valor: r.total, tipo: "monto" },
        { label: "Vencido", valor: r.vencido, tipo: "monto", tono: "bad" },
        { label: "Al día", valor: r.alDia, tipo: "monto", tono: "ok" },
        { label: "Facturas", valor: r.cantidadFacturas, tipo: "numero" },
      ],
      ranking: clientes.length ? { titulo: "Mayores saldos por cliente", items: clientes.slice(0, 50).map((f) => ({ label: f.cliente, valor: f.saldoNeto, sub: f.vencido > 0 ? `vencido ${formatCOP(f.vencido)}` : "al día" })), color: "var(--bad)", inicial: N(c) } : undefined,
      sugerencias: ["Cuentas por pagar", "Indicadores del período", "Cartera por ciudad"],
    };
  },
};

// ==========================================================
// CUENTAS POR PAGAR
// ==========================================================

const cxpResumen: Intent = {
  id: "cxp.resumen",
  ejemplo: "¿Cuánto debemos a proveedores?",
  score(c) {
    let s = 0;
    if (has(c, ...K_CXP) || has(c, "cuentas por pagar", "por pagar")) s += 3;
    if (has(c, "proveedor") && has(c, "pagar", "debemos", "saldo", "deuda")) s += 2;
    if (has(c, "cartera", "cobrar")) s -= 3;
    if (has(c, ...K_VENTA) && !has(c, "pagar")) s -= 2;
    return s;
  },
  async run(c) {
    const r = await cxp.resumenCxp();
    if (r.total === 0) return vacio("Cuentas por pagar", "No hay cuentas por pagar registradas.");
    const prov = await cxp.cxpPorProveedor();
    return {
      ok: true,
      titulo: "Cuentas por pagar",
      resumen: `Debemos ${formatCOP(r.total)} en ${formatNumero(r.cantidad)} documentos; ${formatCOP(r.vencido)} está vencido y ${formatCOP(r.alDia)} al día.`,
      kpis: [
        { label: "Total por pagar", valor: r.total, tipo: "monto" },
        { label: "Vencido", valor: r.vencido, tipo: "monto", tono: "bad" },
        { label: "Al día", valor: r.alDia, tipo: "monto", tono: "ok" },
        { label: "Documentos", valor: r.cantidad, tipo: "numero" },
      ],
      ranking: prov.length ? { titulo: "Mayores saldos por proveedor", items: prov.slice(0, 50).map((f) => ({ label: f.proveedor, valor: f.saldoNeto, sub: f.vencido > 0 ? `vencido ${formatCOP(f.vencido)}` : "al día" })), color: "var(--bad)", inicial: N(c) } : undefined,
      sugerencias: ["Cartera por cobrar", "Obligaciones financieras", "Impuestos pendientes"],
    };
  },
};

// ==========================================================
// OBLIGACIONES FINANCIERAS
// ==========================================================

const obligacionesResumen: Intent = {
  id: "obligaciones.resumen",
  ejemplo: "¿Cuánto debemos en obligaciones financieras?",
  score(c) {
    let s = 0;
    if (has(c, "obligacion", "credito bancario", "prestamo", "deuda bancaria", "banco", "leasing", "financiera")) s += 3;
    if (has(c, "cuota")) s += 1;
    return s;
  },
  async run() {
    const r = await obligaciones.resumenObligaciones();
    if (r.cantidad === 0) return vacio("Obligaciones", "No hay obligaciones financieras registradas.");
    const filas = await obligaciones.listarObligaciones();
    return {
      ok: true,
      titulo: "Obligaciones financieras",
      resumen: `Hay ${formatNumero(r.cantidad)} obligaciones con saldo total de ${formatCOP(r.totalSaldo)} y cuota mensual de ${formatCOP(r.totalCuotaMensual)}.${r.proximo ? ` Próximo pago: ${r.proximo.entidad} por ${formatCOP(r.proximo.valor ?? 0)}.` : ""}`,
      kpis: [
        { label: "Saldo total", valor: r.totalSaldo, tipo: "monto" },
        { label: "Cuota mensual", valor: r.totalCuotaMensual, tipo: "monto" },
        { label: "Obligaciones", valor: r.cantidad, tipo: "numero" },
      ],
      tabla: tabla(
        [{ titulo: "Entidad" }, { titulo: "Tipo" }, { titulo: "Saldo capital", align: "r" }, { titulo: "Cuota", align: "r" }],
        filas.slice(0, CAP).map((f) => [cTxt(f.entidad), cTxt(obligaciones.tipoLabel(f.tipo)), cMonto(f.saldoCapital), cMonto(f.cuotaMensual ?? 0)]),
      ),
      sugerencias: ["Cuentas por pagar", "Impuestos pendientes"],
    };
  },
};

// ==========================================================
// IMPUESTOS
// ==========================================================

const impuestosResumen: Intent = {
  id: "impuestos.resumen",
  ejemplo: "¿Cuánto tenemos pendiente de impuestos?",
  score(c) {
    let s = 0;
    if (has(c, "impuesto", "iva", "retencion", "reteica", "ica", "renta", "dian", "tributo")) s += 3;
    return s;
  },
  async run() {
    const r = await impuestos.resumenImpuestos();
    if (r.totalPendiente === 0) return vacio("Impuestos", "No hay impuestos pendientes registrados.");
    return {
      ok: true,
      titulo: "Impuestos pendientes",
      resumen: `Hay ${formatCOP(r.totalPendiente)} pendiente en impuestos${r.vencido ? `, de los cuales ${formatCOP(r.vencido)} está vencido` : ""}.${r.proximo ? ` Próximo vencimiento por ${formatCOP(r.proximo.total)}.` : ""}`,
      kpis: [
        { label: "Total pendiente", valor: r.totalPendiente, tipo: "monto" },
        { label: "Retención", valor: r.retencion, tipo: "monto" },
        { label: "IVA", valor: r.iva, tipo: "monto" },
        { label: "ICA", valor: r.ica, tipo: "monto" },
        { label: "Renta", valor: r.renta, tipo: "monto" },
      ],
      sugerencias: ["Obligaciones financieras", "Cuentas por pagar"],
    };
  },
};

// ==========================================================
// INDICADORES / METAS
// ==========================================================

const indicadoresResumen: Intent = {
  id: "indicadores.resumen",
  ejemplo: "¿Cómo vamos con los indicadores?",
  score(c) {
    let s = 0;
    if (has(c, "indicador", "kpi", "meta", "cumplimiento", "dso", "rotacion", "tablero")) s += 3;
    return s;
  },
  async run(c) {
    const alc = await alcanceDe(c.usuario, "cartera.view");
    if (alc === "ninguno") return vacio("Indicadores", "No tienes permiso para consultar los indicadores.");
    const inds = await indicadores.calcularIndicadores(c.usuario, alc, c.meses.length ? c.meses : undefined);
    if (!inds.length) return vacio("Indicadores", "No hay indicadores para calcular.");
    const cumplen = inds.filter((i) => i.cumple === true).length;
    const evaluables = inds.filter((i) => i.cumple !== null).length;
    return {
      ok: true,
      titulo: "Indicadores del período",
      resumen: `Se cumplen ${cumplen} de ${evaluables} indicadores evaluables.`,
      tabla: tabla(
        [{ titulo: "Indicador" }, { titulo: "Meta" }, { titulo: "Real", align: "r" }, { titulo: "Cumple", align: "r" }],
        inds.map((i) => [
          cTxt(i.nombre),
          cTxt(i.metaTexto),
          cTxt(i.real === null ? "—" : fmtUnidad(i.real, i.unidad)),
          cTxt(i.cumple === null ? "—" : i.cumple ? "✅" : "❌"),
        ]),
      ),
      sugerencias: ["¿Cómo va el flujo de caja?", "Cartera por cobrar", "Resumen de ventas del año"],
    };
  },
};

// ==========================================================
// INVENTARIO
// ==========================================================

const inventarioResumen: Intent = {
  id: "inventario.resumen",
  ejemplo: "Resumen del inventario de equipos",
  score(c) {
    let s = 0;
    if (has(c, "inventario", "equipo", "activo fijo", "instrumental")) s += 3;
    return s;
  },
  async run() {
    const r = await inventario.resumenInventario();
    if (!r.totalEquipos && !r.totalItems) return vacio("Inventario", "No hay inventario registrado.");
    const porEstado = Object.entries(r.porEstado ?? {});
    return {
      ok: true,
      titulo: "Inventario de equipos",
      resumen: `Hay ${formatNumero(r.totalEquipos)} equipos con ${formatNumero(r.totalItems)} ítems en ${formatNumero(r.ciudades)} ciudades.`,
      kpis: [
        { label: "Equipos", valor: r.totalEquipos, tipo: "numero" },
        { label: "Ítems", valor: r.totalItems, tipo: "numero" },
        { label: "Ciudades", valor: r.ciudades, tipo: "numero" },
      ],
      tabla: porEstado.length ? tabla(
        [{ titulo: "Estado" }, { titulo: "Ítems", align: "r" }],
        porEstado.map(([est, n]) => [cTxt(inventario.estadoLabel(est as Parameters<typeof inventario.estadoLabel>[0])), cNum(Number(n))]),
      ) : undefined,
      sugerencias: ["Inventario por ciudad", "Novedades de inventario"],
    };
  },
};

// ==========================================================
// PENDIENTES POR FACTURAR
// ==========================================================

const pendientesResumen: Intent = {
  id: "pendientes.resumen",
  ejemplo: "¿Qué pedidos están pendientes por facturar?",
  score(c) {
    let s = 0;
    if (has(c, "pendiente", "por facturar", "sin facturar", "pedido pendiente")) s += 3;
    return s;
  },
  async run(c) {
    const rows = await pendientes.listarPendientes();
    const r = pendientes.resumenPendientes(rows);
    if (!r.pedidos) return vacio("Pendientes", "No hay pedidos pendientes por facturar.");
    const porIps = pendientes.pendientesPorIps(rows);
    return {
      ok: true,
      titulo: "Pendientes por facturar",
      resumen: `Hay ${formatNumero(r.pedidos)} pedidos pendientes por ${formatCOP(r.total)} en ${formatNumero(r.ips)} IPS. Antigüedad promedio ${formatNumero(r.diasProm)} días (máx ${formatNumero(r.diasMax)}).`,
      kpis: [
        { label: "Pedidos", valor: r.pedidos, tipo: "numero" },
        { label: "Valor", valor: r.total, tipo: "monto" },
        { label: "Días prom.", valor: r.diasProm, tipo: "numero" },
        { label: "Días máx.", valor: r.diasMax, tipo: "numero" },
      ],
      ranking: porIps.length ? { titulo: "Mayores pendientes por IPS", items: porIps.map((g) => ({ label: g.ips, valor: g.valor, sub: `${formatNumero(g.pedidos)} pedidos` })), color: "var(--warn, #b8860b)", inicial: N(c) } : undefined,
      sugerencias: ["Cartera por cobrar", "Resumen de ventas del año"],
    };
  },
};

// ==========================================================
// Registro y utilidades locales
// ==========================================================

export const INTENTS: Intent[] = [
  topClientes, topProveedores, topLineas, mejorMes, resumenVentas, ventasCiudad,
  flujoResumen, presupuesto,
  nominaResumen,
  pygResumen,
  carteraResumen,
  cxpResumen,
  obligacionesResumen,
  impuestosResumen,
  indicadoresResumen,
  inventarioResumen,
  pendientesResumen,
];

function vacio(titulo: string, resumen: string): Respuesta {
  return { ok: false, titulo, resumen };
}

function fmtMetrica(v: number, m: Metrica): string {
  return m === "margen" ? formatPorcentaje(v) : formatCOP(v);
}

function fmtUnidad(v: number, u: "cop" | "dias" | "pct" | "veces"): string {
  if (u === "cop") return formatCOP(v);
  if (u === "pct") return formatPorcentaje(v);
  if (u === "veces") return `${formatNumero(v)}×`;
  return `${formatNumero(v)} días`;
}

/** Tabla estándar de ventas (etiqueta + venta/costo/utilidad/margen). */
function tablaVentas<T extends { valor: number; costo: number }>(filas: T[], label: (f: T) => string, tituloCol: string) {
  return tabla(
    [{ titulo: tituloCol }, { titulo: "Venta neta", align: "r" }, { titulo: "Costo", align: "r" }, { titulo: "Utilidad", align: "r" }, { titulo: "% Util.", align: "r" }],
    filas.map((f) => {
      const util = f.valor - f.costo;
      const margen = f.valor > 0 ? (util / f.valor) * 100 : 0;
      return [cTxt(label(f)), cMonto(f.valor), cMonto(f.costo), cMonto(util, util >= 0 ? "ok" : "bad"), cPct(margen)];
    }),
  );
}
