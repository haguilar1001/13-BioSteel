// ==========================================================
// Catálogo de permisos y matriz de roles base (paramétrico)
// Fuente única de verdad, usada por el seed y por la app.
// alcance: "todos" | "propio" | "ninguno"  (BIO-SEC-001)
// ==========================================================

export type Alcance = "todos" | "propio" | "ninguno";

export interface PermisoDef {
  clave: string;
  modulo: string;
  descripcion: string;
}

/** Todas las acciones controladas del sistema. */
export const PERMISOS = [
  { clave: "dashboard.view", modulo: "Inicio", descripcion: "Ver dashboard y KPIs" },
  { clave: "cartera.view", modulo: "Cartera", descripcion: "Consultar cuentas por cobrar" },
  { clave: "recaudo.create", modulo: "Tesorería", descripcion: "Registrar recaudos" },
  { clave: "cxp.view", modulo: "Cuentas por Pagar", descripcion: "Consultar cuentas por pagar" },
  { clave: "ventas.manage", modulo: "Comercial", descripcion: "Importar ventas y gestionar descuentos NC (parámetros/exclusiones)" },
  { clave: "flujo.manage", modulo: "Tesorería", descripcion: "Importar movimientos de flujo de caja (SIESA)" },
  { clave: "pago.create", modulo: "Tesorería", descripcion: "Registrar pagos a proveedores" },
  { clave: "nota.manage", modulo: "Cartera", descripcion: "Gestionar notas crédito/débito y glosas" },
  { clave: "reporte.view", modulo: "Reportes", descripcion: "Ver reportes y análisis" },
  { clave: "inventario.view", modulo: "Inventarios", descripcion: "Consultar el inventario de equipos" },
  { clave: "inventario.manage", modulo: "Inventarios", descripcion: "Gestionar equipos, ítems y novedades" },
  { clave: "osteo.view", modulo: "Inventarios", descripcion: "Consultar el inventario de material de osteosíntesis" },
  { clave: "recepcion.view", modulo: "Inventarios", descripcion: "Consultar recepciones técnicas (recibo a satisfacción)" },
  { clave: "recepcion.manage", modulo: "Inventarios", descripcion: "Registrar recepciones técnicas de material" },
  { clave: "compras.view", modulo: "Compras", descripcion: "Consultar el informe de compras (órdenes, pendientes y facturado)" },
  { clave: "pedidos.view", modulo: "Pedidos", descripcion: "Consultar el informe de pedidos y las sugerencias de compra" },
  { clave: "asistencia.manage", modulo: "Análisis", descripcion: "Registrar PQRS de Asistencia Técnica" },
  { clave: "capacitaciones.view", modulo: "Nómina", descripcion: "Consultar el indicador de capacitaciones (plan de formación)" },
  { clave: "capacitaciones.manage", modulo: "Nómina", descripcion: "Editar el plan de formación (capacitaciones planeadas por mes)" },
  { clave: "tercero.manage", modulo: "Administración", descripcion: "Crear y editar terceros" },
  { clave: "usuario.manage", modulo: "Administración", descripcion: "Gestionar usuarios" },
  { clave: "rol.manage", modulo: "Administración", descripcion: "Gestionar roles y permisos" },
  { clave: "parametro.manage", modulo: "Administración", descripcion: "Gestionar parámetros del sistema" },
  { clave: "auditoria.view", modulo: "Administración", descripcion: "Ver el registro de auditoría" },
  // --- Cargas de archivos (formulario /cargar). Un permiso por dataset. ---
  { clave: "carga.pendientes", modulo: "Cargas", descripcion: "Cargar Pedidos Pendientes Acumulados" },
  { clave: "carga.ventas", modulo: "Cargas", descripcion: "Cargar Ventas (facturas por ítem)" },
  { clave: "carga.facturacion", modulo: "Cargas", descripcion: "Cargar Datos Facturación" },
  { clave: "carga.gastos", modulo: "Cargas", descripcion: "Cargar Gastos" },
  { clave: "carga.anuladas", modulo: "Cargas", descripcion: "Cargar Motivo facturas anuladas" },
  { clave: "carga.pyg", modulo: "Cargas", descripcion: "Cargar Estado de Resultados" },
  { clave: "carga.flujo", modulo: "Cargas", descripcion: "Cargar Ingresos y Egresos" },
  { clave: "carga.presupuesto", modulo: "Cargas", descripcion: "Cargar Presupuesto de Egresos" },
  { clave: "carga.inv.bodegas", modulo: "Cargas", descripcion: "Cargar Tablas Auxiliares de inventario (bodegas)" },
  { clave: "carga.inv.balance", modulo: "Cargas", descripcion: "Cargar Balance de inventario mensual" },
  { clave: "carga.inv.movimientos", modulo: "Cargas", descripcion: "Cargar Movimientos de inventario" },
  { clave: "carga.compras.ordenes", modulo: "Cargas", descripcion: "Cargar Órdenes de compra generadas" },
  { clave: "carga.compras.pendientes", modulo: "Cargas", descripcion: "Cargar Pendientes por despacho" },
  { clave: "carga.compras.facturas", modulo: "Cargas", descripcion: "Cargar Facturas de proveedores" },
  { clave: "carga.compras.tipos", modulo: "Cargas", descripcion: "Cargar Tipos de proveedores (tipo de compra)" },
  { clave: "carga.compras.entradas", modulo: "Cargas", descripcion: "Cargar Entradas por compra (documento → proveedor)" },
  { clave: "carga.pedidos", modulo: "Cargas", descripcion: "Cargar Pedidos (detalle por ítem del bloque quirúrgico)" },
  { clave: "carga.indicador.compras", modulo: "Cargas", descripcion: "Cargar los indicadores de calidad de Compras (FOR-GC-011)" },
  { clave: "carga.encuestas", modulo: "Cargas", descripcion: "Cargar Encuestas de Satisfacción (institucional y ortopedistas)" },
  { clave: "carga.cirugias", modulo: "Cargas", descripcion: "Cargar Consulta de Cirugía Diaria" },
  { clave: "carga.capacitaciones", modulo: "Cargas", descripcion: "Cargar el Consolidado de Capacitaciones (Gestión Humana)" },
  { clave: "carga.nomina", modulo: "Cargas", descripcion: "Cargar la Nómina (costo de personal)" },
] as const satisfies readonly PermisoDef[];

export type PermisoClave = (typeof PERMISOS)[number]["clave"];

/** Roles base precargados (editables por el Administrador). */
export const ROLES_BASE = [
  { nombre: "Administrador", sistema: true },
  { nombre: "Gerente", sistema: true },
  { nombre: "Tesorería / Cartera", sistema: true },
  { nombre: "Vendedor", sistema: true },
] as const;

export type RolNombre = (typeof ROLES_BASE)[number]["nombre"];

const T: Alcance = "todos";
const P: Alcance = "propio";
const N: Alcance = "ninguno";

/**
 * Matriz de permisos por rol (alcance por defecto).
 * Deny-by-default: cualquier permiso no listado se asume "ninguno".
 */
export const MATRIZ_ROLES: Record<RolNombre, Partial<Record<PermisoClave, Alcance>>> = {
  Administrador: {
    "dashboard.view": T, "cartera.view": T, "recaudo.create": T, "cxp.view": T,
    "pago.create": T, "nota.manage": T, "reporte.view": T, "tercero.manage": T,
    "inventario.view": T, "inventario.manage": T, "osteo.view": T, "flujo.manage": T, "ventas.manage": T,
    "recepcion.view": T, "recepcion.manage": T,
    "compras.view": T, "pedidos.view": T,
    "carga.compras.ordenes": T, "carga.compras.pendientes": T, "carga.compras.facturas": T,
    "carga.compras.tipos": T, "carga.compras.entradas": T, "carga.pedidos": T,
    "carga.indicador.compras": T,
    "usuario.manage": T, "rol.manage": T, "parametro.manage": T, "auditoria.view": T,
    "carga.pendientes": T, "carga.ventas": T, "carga.facturacion": T, "carga.gastos": T,
    "carga.anuladas": T, "carga.pyg": T, "carga.flujo": T, "carga.presupuesto": T,
    "carga.inv.bodegas": T, "carga.inv.balance": T, "carga.inv.movimientos": T,
    "carga.encuestas": T, "carga.cirugias": T, "carga.capacitaciones": T, "carga.nomina": T,
    "asistencia.manage": T, "capacitaciones.view": T, "capacitaciones.manage": T,
  },
  Gerente: {
    "dashboard.view": T, "cartera.view": T, "recaudo.create": N, "cxp.view": T,
    "pago.create": N, "nota.manage": N, "reporte.view": T, "tercero.manage": N,
    "inventario.view": T, "inventario.manage": N, "osteo.view": T, "ventas.manage": T,
    "recepcion.view": T, "recepcion.manage": N,
    "compras.view": T, "pedidos.view": T,
    "asistencia.manage": T, "capacitaciones.view": T, "capacitaciones.manage": T,
    "usuario.manage": N, "rol.manage": N, "parametro.manage": N, "auditoria.view": T,
  },
  "Tesorería / Cartera": {
    "dashboard.view": T, "cartera.view": T, "recaudo.create": T, "cxp.view": T,
    "pago.create": T, "nota.manage": T, "reporte.view": T, "tercero.manage": T,
    "inventario.view": T, "inventario.manage": T, "osteo.view": T, "flujo.manage": T, "ventas.manage": T,
    "recepcion.view": T, "recepcion.manage": T,
    "compras.view": T, "pedidos.view": T, "capacitaciones.view": T,
    "usuario.manage": N, "rol.manage": N, "parametro.manage": N, "auditoria.view": N,
  },
  Vendedor: {
    "dashboard.view": T, "cartera.view": P, "recaudo.create": N, "cxp.view": N,
    "pago.create": N, "nota.manage": N, "reporte.view": P, "tercero.manage": N,
    "inventario.view": N, "inventario.manage": N, "osteo.view": N, "ventas.manage": N,
    "compras.view": N, "pedidos.view": N,
    "usuario.manage": N, "rol.manage": N, "parametro.manage": N, "auditoria.view": N,
  },
};
