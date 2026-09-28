// ==========================================================
// Menú de la aplicación: catálogo base (código) + personalización (BD).
// El código define qué ítems existen, su ruta y su permiso (no editables).
// La BD (MenuGrupoCfg / MenuItemCfg) solo sobreescribe nombre, orden, grupo y
// visibilidad. Campos nulos = usar el valor por defecto del código.
// ==========================================================
import "server-only";
import { prisma } from "@/lib/db";
import { puede } from "@/lib/rbac/authorize";
import type { UsuarioConRol } from "@/lib/auth/session";
import type { PermisoClave } from "@/lib/rbac/permissions";
import { ADMIN_SECCIONES } from "./admin/_nav";
import type { Grupo } from "./_components/GroupNav";

export interface MenuItemDef {
  href: string;
  label: string;
  permiso: PermisoClave;
  /** Visible si tiene CUALQUIERA de estos permisos (OR). Si se omite, usa `permiso`. */
  permisosOr?: PermisoClave[];
  /** Encabezado dentro del desplegable del grupo (agrupa ítems relacionados). */
  seccion?: string;
}
export interface MenuGrupoDef { id: string; label: string; icon: string; items: MenuItemDef[]; }

// Catálogo base (grupos de módulos). El grupo "Administración" se arma aparte.
export const MENU_BASE: MenuGrupoDef[] = [
  { id: "inicio", label: "Inicio", icon: "🏠", items: [
    { href: "/dashboard", label: "🏠 Inicio", permiso: "dashboard.view" },
    { href: "/consultas", label: "🤖 Asistente", permiso: "cxp.view" },
    { href: "/cargar", label: "⬆️ Cargar archivos", permiso: "carga.pendientes",
      permisosOr: ["carga.pendientes", "carga.ventas", "carga.facturacion", "carga.gastos", "carga.anuladas", "carga.pyg", "carga.flujo", "carga.presupuesto",
        "carga.compras.ordenes", "carga.compras.pendientes", "carga.compras.facturas", "carga.compras.tipos", "carga.compras.entradas",
        "carga.pedidos", "carga.indicador.compras"] },
  ] },
  { id: "tesoreria", label: "Tesorería", icon: "💰", items: [
    { href: "/flujo", label: "💵 Flujo de Caja", permiso: "cxp.view" },
    { href: "/cxp", label: "📤 Cuentas por Pagar", permiso: "cxp.view" },
    { href: "/obligaciones", label: "🏦 Obligaciones", permiso: "cxp.view" },
    { href: "/impuestos", label: "🧾 Impuestos", permiso: "cxp.view" },
  ] },
  { id: "comercial", label: "Comercial", icon: "🛒", items: [
    { href: "/ventas", label: "💹 Ventas", permiso: "cxp.view" },
    { href: "/facturacion", label: "🧾 Facturación", permiso: "cxp.view" },
    { href: "/cartera", label: "📥 Cartera", permiso: "cartera.view" },
  ] },
  { id: "nomina", label: "Nómina", icon: "👥", items: [
    { href: "/nomina", label: "👥 Resumen", permiso: "cxp.view" },
    { href: "/nomina/empleados", label: "🧑‍💼 Empleados", permiso: "cxp.view" },
    { href: "/nomina/capacitaciones", label: "🎓 Capacitaciones", permiso: "capacitaciones.view" },
  ] },
  { id: "asistec", label: "Asistencia Técnica", icon: "🩺", items: [
    { href: "/asistencia/cirugias", label: "🔪 Cirugías", permiso: "cxp.view" },
  ] },
  { id: "analisis", label: "Análisis", icon: "📊", items: [
    { href: "/indicadores", label: "📈 Indicadores Financieros", permiso: "cxp.view" },
    { href: "/indicadores/compras", label: "📐 Indicadores de Compras", permiso: "cxp.view" },
    { href: "/indicadores/almacen", label: "📦 Indicadores de Almacén", permiso: "recepcion.view" },
    { href: "/pyg", label: "📄 PyG", permiso: "cxp.view" },
    { href: "/asistencia", label: "🩺 Asistencia Técnica", permiso: "cxp.view" },
    { href: "/asistencia/pqrs", label: "📣 PQRS", permiso: "cxp.view" },
    { href: "/encuestas", label: "🙂 Encuestas de Satisfacción", permiso: "cxp.view" },
  ] },
  { id: "compras", label: "Compras", icon: "🛍️", items: [
    { href: "/compras", label: "🛍️ Informe de Compras", permiso: "compras.view" },
    { href: "/compras/ordenes", label: "📄 Órdenes de Compra", permiso: "compras.view" },
    { href: "/compras/pendientes", label: "⏳ Pendientes por Despacho", permiso: "compras.view" },
    { href: "/compras/facturado", label: "🧾 Facturado Proveedor", permiso: "compras.view" },
    { href: "/compras/proveedores", label: "🏭 Por Proveedor × Mes", permiso: "compras.view" },
  ] },
  { id: "pedidos", label: "Pedidos", icon: "📝", items: [
    { href: "/pedidos", label: "📝 Informe de Pedidos", permiso: "pedidos.view" },
    { href: "/pedidos/sugerencias", label: "🛒 Sugerencias de Compra", permiso: "pedidos.view" },
    { href: "/pedidos/detalle", label: "🔎 Detalle", permiso: "pedidos.view" },
  ] },
  { id: "inventarios", label: "Inventarios", icon: "📦", items: [
    { href: "/inventario", label: "📦 Resumen", permiso: "inventario.view", seccion: "Equipos" },
    { href: "/inventario/ciudades", label: "📍 Por Ciudad", permiso: "inventario.view", seccion: "Equipos" },
    { href: "/inventario/estados", label: "🔍 Por Estado", permiso: "inventario.view", seccion: "Equipos" },
    { href: "/inventario/novedades", label: "🔔 Novedades", permiso: "inventario.view", seccion: "Equipos" },
    { href: "/osteosintesis/valorizado", label: "💰 Valorizado", permiso: "osteo.view", seccion: "Material" },
    { href: "/osteosintesis/movimientos", label: "🔁 Movimientos", permiso: "osteo.view", seccion: "Material" },
    { href: "/osteosintesis/conciliacion", label: "⚖️ Conciliación", permiso: "osteo.view", seccion: "Material" },
    { href: "/osteosintesis/recepcion", label: "📋 Recepción Técnica", permiso: "recepcion.view", seccion: "Recepción Técnica" },
  ] },
];

export const ADMIN_GRUPO = { id: "admin", label: "Administración", icon: "⚙️" };

/** Grupos disponibles como destino al mover ítems (los de módulos, sin admin). */
export const GRUPOS_DESTINO = MENU_BASE.map((g) => ({ id: g.id, label: g.label }));

/** Construye el menú efectivo para el usuario (base + cfg + permisos). */
export async function construirMenu(usuario: UsuarioConRol): Promise<Grupo[]> {
  const [gruposCfg, itemsCfg] = await Promise.all([
    prisma.menuGrupoCfg.findMany(),
    prisma.menuItemCfg.findMany(),
  ]);
  const gCfg = new Map(gruposCfg.map((g) => [g.clave, g]));
  const iCfg = new Map(itemsCfg.map((i) => [i.href, i]));

  // Ítems efectivos con grupo y orden resueltos, filtrados por permiso y visible.
  interface Eff { href: string; label: string; grupo: string; orden: number; seccion?: string }
  const eff: Eff[] = [];
  for (let gi = 0; gi < MENU_BASE.length; gi++) {
    const g = MENU_BASE[gi]!;
    for (let ii = 0; ii < g.items.length; ii++) {
      const it = g.items[ii]!;
      const cfg = iCfg.get(it.href);
      if (cfg && !cfg.visible) continue;
      // Visible si tiene el permiso del ítem, o cualquiera de `permisosOr` (OR).
      const claves = it.permisosOr ?? [it.permiso];
      let visible = false;
      for (const clave of claves) { if (await puede(usuario, clave)) { visible = true; break; } }
      if (!visible) continue;
      eff.push({ href: it.href, label: cfg?.label || it.label, grupo: cfg?.grupoClave || g.id, orden: cfg?.orden ?? gi * 100 + ii, seccion: it.seccion });
    }
  }

  const out: (Grupo & { orden: number })[] = [];

  // Grupos de módulos.
  for (let gi = 0; gi < MENU_BASE.length; gi++) {
    const g = MENU_BASE[gi]!;
    const gc = gCfg.get(g.id);
    if (gc && !gc.visible) continue;
    const items = eff.filter((e) => e.grupo === g.id).sort((a, b) => a.orden - b.orden).map((e) => ({ href: e.href, label: e.label, seccion: e.seccion }));
    if (items.length) out.push({ id: g.id, label: gc?.label || g.label, icon: gc?.icon || g.icon, items, orden: gc?.orden ?? gi });
  }

  // Grupo Administración (secciones), con su cfg de grupo.
  const gcAdmin = gCfg.get("admin");
  if (!gcAdmin || gcAdmin.visible) {
    const itemsAdmin: { href: string; label: string; match: string[] }[] = [];
    for (const s of ADMIN_SECCIONES) {
      let primera: string | undefined;
      for (const t of s.tabs) { if (await puede(usuario, t.permiso)) { primera = t.href; break; } }
      if (primera) itemsAdmin.push({ href: primera, label: s.label, match: s.tabs.map((t) => t.href) });
    }
    if (itemsAdmin.length) out.push({ id: "admin", label: gcAdmin?.label || ADMIN_GRUPO.label, icon: gcAdmin?.icon || ADMIN_GRUPO.icon, items: itemsAdmin, orden: gcAdmin?.orden ?? MENU_BASE.length });
  }

  out.sort((a, b) => a.orden - b.orden);
  return out.map(({ orden: _o, ...g }) => g);
}
