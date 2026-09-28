// ==========================================================
// Metas de indicadores editables desde Administración → Metas de
// indicadores, en vez de quedar escritas a mano en el código (que era como
// vivía "meta ≥ 90 %" en Indicadores de Gastos).
//
// Cada meta se identifica por una CLAVE fija ("gastos.valor"). Si no hay fila
// en MetaIndicador para esa clave, la pantalla usa su valor POR DEFECTO (el
// que traía el código); así que agregar una meta nueva a este catálogo nunca
// rompe la pantalla que todavía no la usa.
// ==========================================================
import "server-only";
import { prisma } from "@/lib/db";

/** Catálogo de metas que se pueden editar desde Administración. Agregar una
 * meta nueva aquí es lo único que hace falta para que aparezca en la
 * pantalla de edición — la página no lista nada a mano. */
export const METAS_DEF = [
  {
    clave: "gastos.valor",
    label: "Gastos · Vr. facturado / Vr. gastos",
    descripcion: "% mínimo de Vr. facturado sobre Vr. gastos, en Facturación → Indicadores de Gastos.",
    porDefecto: 90,
    sufijo: "%",
  },
] as const;

export type ClaveMeta = (typeof METAS_DEF)[number]["clave"];

/** Valor vigente de una meta: el guardado en BD, o su valor por defecto si no se ha editado. */
export async function obtenerMeta(clave: ClaveMeta): Promise<number> {
  const def = METAS_DEF.find((m) => m.clave === clave)!;
  const fila = await prisma.metaIndicador.findUnique({ where: { clave } });
  return fila ? fila.valor.toNumber() : def.porDefecto;
}

/** Todas las metas del catálogo con su valor vigente, para la pantalla de edición. */
export async function listarMetas(): Promise<
  { clave: ClaveMeta; label: string; descripcion: string; sufijo: string; valor: number; porDefecto: number; editada: boolean; actualizadoEn: Date | null; actualizadoPor: string }[]
> {
  const filas = await prisma.metaIndicador.findMany({ where: { clave: { in: METAS_DEF.map((m) => m.clave) } } });
  const porClave = new Map(filas.map((f) => [f.clave, f]));
  return METAS_DEF.map((def) => {
    const f = porClave.get(def.clave);
    return {
      clave: def.clave, label: def.label, descripcion: def.descripcion, sufijo: def.sufijo,
      valor: f ? f.valor.toNumber() : def.porDefecto, porDefecto: def.porDefecto,
      editada: !!f, actualizadoEn: f?.actualizadoEn ?? null, actualizadoPor: f?.actualizadoPor ?? "",
    };
  });
}

export async function actualizarMeta(clave: ClaveMeta, valor: number, usuario: string): Promise<void> {
  const def = METAS_DEF.find((m) => m.clave === clave);
  if (!def) throw new Error(`Meta desconocida: ${clave}`);
  await prisma.metaIndicador.upsert({
    where: { clave },
    update: { valor, actualizadoPor: usuario },
    create: { clave, valor, descripcion: def.descripcion, actualizadoPor: usuario },
  });
}

/** Vuelve a su valor por defecto (borra el ajuste manual). */
export async function restablecerMeta(clave: ClaveMeta): Promise<void> {
  await prisma.metaIndicador.deleteMany({ where: { clave } });
}
