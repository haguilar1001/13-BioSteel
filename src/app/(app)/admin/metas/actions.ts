"use server";
// Edición de Metas de Indicadores (valores hoy escritos a mano en el código).
import { revalidatePath } from "next/cache";
import { requireUsuario } from "@/server/auth-context";
import { exigirPermiso } from "@/lib/rbac/authorize";
import { auditar } from "@/lib/audit/log";
import { actualizarMeta, restablecerMeta, METAS_DEF, type ClaveMeta } from "@/lib/negocio/metas-indicador";

function esClaveValida(v: unknown): v is ClaveMeta {
  return typeof v === "string" && METAS_DEF.some((m) => m.clave === v);
}

export async function guardarMeta(fd: FormData): Promise<void> {
  const u = await requireUsuario();
  await exigirPermiso(u, "parametro.manage");
  const clave = fd.get("clave");
  const valor = Number(String(fd.get("valor") ?? "").replace(",", "."));
  if (!esClaveValida(clave) || !Number.isFinite(valor) || valor < 0) return;
  await actualizarMeta(clave, valor, u.nombre);
  await auditar({ usuarioId: u.id, accion: "meta.editar", entidad: "MetaIndicador", entidadId: clave });
  revalidatePath("/admin/metas");
}

export async function restablecerMetaAction(fd: FormData): Promise<void> {
  const u = await requireUsuario();
  await exigirPermiso(u, "parametro.manage");
  const clave = fd.get("clave");
  if (!esClaveValida(clave)) return;
  await restablecerMeta(clave);
  await auditar({ usuarioId: u.id, accion: "meta.restablecer", entidad: "MetaIndicador", entidadId: clave });
  revalidatePath("/admin/metas");
}
