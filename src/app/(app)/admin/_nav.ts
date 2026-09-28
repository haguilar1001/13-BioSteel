// Estructura de Administración (fuente única, usada por el menú principal
// y por las pestañas internas de cada sección).
//   Nivel 2 (submenú): las secciones -> Manejo de usuarios, Terceros, Configuración
//   Nivel 3 (pestañas dentro de la página): las páginas de cada sección
// Una sección se muestra si el usuario tiene permiso para al menos una de sus
// páginas; sus pestañas internas solo aparecen si hay más de una visible.
import type { PermisoClave } from "@/lib/rbac/permissions";

export interface AdminTab { href: string; label: string; permiso: PermisoClave; }
export interface AdminSeccion { id: string; label: string; tabs: AdminTab[]; }

export const ADMIN_SECCIONES: AdminSeccion[] = [
  { id: "usuarios", label: "👥 Manejo de usuarios", tabs: [
    { href: "/admin/usuarios", label: "👤 Usuarios", permiso: "usuario.manage" },
    { href: "/admin/roles", label: "🔐 Roles y permisos", permiso: "rol.manage" },
    { href: "/admin/auditoria", label: "📜 Auditoría", permiso: "auditoria.view" },
  ] },
  { id: "terceros", label: "🧑‍💼 Terceros", tabs: [
    { href: "/admin/terceros", label: "🧑‍💼 Terceros", permiso: "tercero.manage" },
  ] },
  { id: "config", label: "🎛️ Configuración", tabs: [
    { href: "/admin/parametrizacion", label: "🎨 Fuente y tamaño", permiso: "parametro.manage" },
    { href: "/admin/menu", label: "🧭 Editor de menú", permiso: "parametro.manage" },
    { href: "/admin/metas", label: "🎯 Metas de indicadores", permiso: "parametro.manage" },
  ] },
  { id: "varios", label: "🧰 Varios", tabs: [
    { href: "/admin/varios/exclusiones", label: "🚫 Exclusiones NC", permiso: "ventas.manage" },
    { href: "/admin/varios/parametros", label: "⚙️ Parámetros NC", permiso: "ventas.manage" },
    { href: "/admin/varios/ajustes", label: "➕ Ajustes de venta", permiso: "ventas.manage" },
  ] },
];
