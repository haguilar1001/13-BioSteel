"use server";
// ==========================================================
// Acciones del módulo Inventarios: alta/edición de equipos e ítems
// y registro de novedades (compra, baja, daño, reparación, retorno,
// traslado). Cada novedad deja bitácora y aplica su efecto al equipo/ítem.
// ==========================================================
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUsuario } from "@/server/auth-context";
import { exigirPermiso } from "@/lib/rbac/authorize";
import { prefijoCodigo, formatCodigo, siguienteNumero } from "@/lib/inventario-codigo";
import type { EstadoInventario, TipoNovedad, Prisma } from "@prisma/client";

/** Genera el siguiente código de inventario para una categoría (MOT-001…). */
async function generarCodigo(client: Prisma.TransactionClient, categoriaUpper: string): Promise<string> {
  const prefijo = prefijoCodigo(categoriaUpper);
  const existentes = await client.equipoInventario.findMany({
    where: { codigo: { startsWith: `${prefijo}-` } },
    select: { codigo: true },
  });
  return formatCodigo(prefijo, siguienteNumero(prefijo, existentes.map((e) => e.codigo)));
}

export interface AccionState {
  ok?: boolean;
  error?: string;
}

const ESTADOS = ["activo", "en_reparacion", "de_baja", "pendiente"] as const;
const TIPOS_ITEM = ["equipo", "accesorio"] as const;

function refresh() {
  revalidatePath("/inventario");
  revalidatePath("/inventario/ciudades");
  revalidatePath("/inventario/estados");
  revalidatePath("/inventario/novedades");
}

async function guard(): Promise<{ usuarioId: number } | { error: string }> {
  const usuario = await requireUsuario();
  try {
    await exigirPermiso(usuario, "inventario.manage");
  } catch {
    return { error: "No tienes permiso para gestionar el inventario." };
  }
  return { usuarioId: usuario.id };
}

// --- Crear equipo (con ítem inicial opcional) — registra 'compra' -----------
const equipoSchema = z.object({
  sedeId: z.coerce.number().int().positive("Selecciona una sede."),
  categoria: z.string().trim().min(1, "Indica la categoría."),
  marca: z.string().trim().min(1, "Indica la marca."),
  nombre: z.string().trim().optional(),
  observaciones: z.string().trim().optional(),
  esCompra: z.coerce.boolean().optional(),
});

export async function crearEquipoAction(_prev: AccionState, fd: FormData): Promise<AccionState> {
  const g = await guard();
  if ("error" in g) return g;
  const p = equipoSchema.safeParse({
    sedeId: fd.get("sedeId"),
    categoria: fd.get("categoria"),
    marca: fd.get("marca"),
    nombre: fd.get("nombre") || undefined,
    observaciones: fd.get("observaciones") || undefined,
    esCompra: fd.get("esCompra") === "on" || fd.get("esCompra") === "true",
  });
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Datos inválidos." };

  const categoriaUpper = p.data.categoria.toUpperCase();
  await prisma.$transaction(async (tx) => {
    const codigo = await generarCodigo(tx, categoriaUpper);
    const equipo = await tx.equipoInventario.create({
      data: {
        codigo,
        sedeId: p.data.sedeId,
        categoria: categoriaUpper,
        marca: p.data.marca.toUpperCase(),
        nombre: p.data.nombre || null,
        observaciones: p.data.observaciones || null,
      },
    });
    if (p.data.esCompra) {
      await tx.novedadInventario.create({
        data: {
          tipo: "compra", equipoId: equipo.id, sedeDestinoId: p.data.sedeId,
          estadoNuevo: "activo", descripcion: "Alta de equipo (compra)", usuarioId: g.usuarioId,
        },
      });
    }
  });
  refresh();
  return { ok: true };
}

export async function eliminarEquipoAction(_prev: AccionState, fd: FormData): Promise<AccionState> {
  const g = await guard();
  if ("error" in g) return g;
  const id = Number(fd.get("equipoId"));
  if (!Number.isInteger(id) || id <= 0) return { error: "Equipo inválido." };
  await prisma.equipoInventario.delete({ where: { id } });
  refresh();
  return { ok: true };
}

// --- Ítems ------------------------------------------------------------------
const itemSchema = z.object({
  equipoId: z.coerce.number().int().positive(),
  descripcion: z.string().trim().min(1, "Indica la descripción."),
  tipo: z.enum(TIPOS_ITEM),
  cantidad: z.coerce.number().int().min(1, "La cantidad debe ser 1 o más."),
  lote: z.string().trim().optional(),
  estado: z.enum(ESTADOS),
  observaciones: z.string().trim().optional(),
});

export async function crearItemAction(_prev: AccionState, fd: FormData): Promise<AccionState> {
  const g = await guard();
  if ("error" in g) return g;
  const p = itemSchema.safeParse({
    equipoId: fd.get("equipoId"), descripcion: fd.get("descripcion"), tipo: fd.get("tipo"),
    cantidad: fd.get("cantidad"), lote: fd.get("lote") || undefined, estado: fd.get("estado"),
    observaciones: fd.get("observaciones") || undefined,
  });
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Datos inválidos." };
  await prisma.itemInventario.create({
    data: {
      equipoId: p.data.equipoId, descripcion: p.data.descripcion.toUpperCase(), tipo: p.data.tipo,
      cantidad: p.data.cantidad, lote: p.data.lote || null, estado: p.data.estado,
      observaciones: p.data.observaciones || null,
    },
  });
  refresh();
  return { ok: true };
}

export async function actualizarItemAction(_prev: AccionState, fd: FormData): Promise<AccionState> {
  const g = await guard();
  if ("error" in g) return g;
  const id = Number(fd.get("itemId"));
  if (!Number.isInteger(id) || id <= 0) return { error: "Ítem inválido." };
  const p = itemSchema.omit({ equipoId: true }).safeParse({
    descripcion: fd.get("descripcion"), tipo: fd.get("tipo"), cantidad: fd.get("cantidad"),
    lote: fd.get("lote") || undefined, estado: fd.get("estado"), observaciones: fd.get("observaciones") || undefined,
  });
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Datos inválidos." };
  await prisma.itemInventario.update({
    where: { id },
    data: {
      descripcion: p.data.descripcion.toUpperCase(), tipo: p.data.tipo, cantidad: p.data.cantidad,
      lote: p.data.lote || null, estado: p.data.estado, observaciones: p.data.observaciones || null,
    },
  });
  refresh();
  return { ok: true };
}

export async function eliminarItemAction(_prev: AccionState, fd: FormData): Promise<AccionState> {
  const g = await guard();
  if ("error" in g) return g;
  const id = Number(fd.get("itemId"));
  if (!Number.isInteger(id) || id <= 0) return { error: "Ítem inválido." };
  await prisma.itemInventario.delete({ where: { id } });
  refresh();
  return { ok: true };
}

// --- Compra: crear equipo nuevo (con ítems) y registrar la novedad ----------
const compraItemSchema = z.object({
  descripcion: z.string().trim().min(1, "Cada ítem necesita descripción."),
  tipo: z.enum(TIPOS_ITEM),
  cantidad: z.coerce.number().int().min(1, "La cantidad debe ser 1 o más."),
  lote: z.string().trim().optional(),
  estado: z.enum(ESTADOS).default("activo"),
});
const compraSchema = z.object({
  sedeId: z.coerce.number().int().positive("Selecciona una sede."),
  categoria: z.string().trim().min(1, "Indica la categoría."),
  marca: z.string().trim().min(1, "Indica la marca."),
  nombre: z.string().trim().optional(),
  fecha: z.string().trim().optional(),
  descripcion: z.string().trim().optional(),
  items: z.array(compraItemSchema).min(1, "Agrega al menos un ítem."),
});

export async function crearEquipoCompraAction(_prev: AccionState, fd: FormData): Promise<AccionState> {
  const g = await guard();
  if ("error" in g) return g;

  let itemsRaw: unknown = [];
  try { itemsRaw = JSON.parse(String(fd.get("items") ?? "[]")); } catch { return { error: "Lista de ítems inválida." }; }

  const p = compraSchema.safeParse({
    sedeId: fd.get("sedeId"), categoria: fd.get("categoria"), marca: fd.get("marca"),
    nombre: fd.get("nombre") || undefined, fecha: fd.get("fecha") || undefined,
    descripcion: fd.get("descripcion") || undefined, items: itemsRaw,
  });
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Datos inválidos." };
  const { sedeId, categoria, marca, nombre, fecha, descripcion, items } = p.data;

  const categoriaUpper = categoria.toUpperCase();
  await prisma.$transaction(async (tx) => {
    const codigo = await generarCodigo(tx, categoriaUpper);
    const equipo = await tx.equipoInventario.create({
      data: {
        codigo,
        sedeId,
        categoria: categoriaUpper,
        marca: marca.toUpperCase(),
        nombre: nombre || null,
        items: {
          create: items.map((it) => ({
            descripcion: it.descripcion.toUpperCase(),
            tipo: it.tipo,
            cantidad: it.cantidad,
            lote: it.lote || null,
            estado: it.estado,
          })),
        },
      },
    });
    await tx.novedadInventario.create({
      data: {
        tipo: "compra",
        equipoId: equipo.id,
        sedeDestinoId: sedeId,
        estadoNuevo: "activo",
        descripcion: descripcion || "Compra de equipo nuevo",
        usuarioId: g.usuarioId,
        ...(fecha ? { fecha: new Date(fecha) } : {}),
      },
    });
  });

  refresh();
  return { ok: true };
}

// --- Ingreso de equipo existente: equipo que YA era de la empresa y estaba
// pendiente por ingresar al inventario (no es una compra nueva) ------------
const ingresoExistenteSchema = z.object({
  sedeId: z.coerce.number().int().positive("Selecciona una sede."),
  categoria: z.string().trim().min(1, "Indica la categoría."),
  marca: z.string().trim().min(1, "Indica la marca."),
  nombre: z.string().trim().optional(),
  fechaIngreso: z.string().trim().min(1, "Indica la fecha de ingreso al inventario."),
  fechaCompra: z.string().trim().optional(),
  descripcion: z.string().trim().optional(),
  items: z.array(compraItemSchema).min(1, "Agrega al menos un ítem."),
});

export async function crearEquipoIngresoExistenteAction(_prev: AccionState, fd: FormData): Promise<AccionState> {
  const g = await guard();
  if ("error" in g) return g;

  let itemsRaw: unknown = [];
  try { itemsRaw = JSON.parse(String(fd.get("items") ?? "[]")); } catch { return { error: "Lista de ítems inválida." }; }

  const p = ingresoExistenteSchema.safeParse({
    sedeId: fd.get("sedeId"), categoria: fd.get("categoria"), marca: fd.get("marca"),
    nombre: fd.get("nombre") || undefined,
    fechaIngreso: fd.get("fechaIngreso"),
    fechaCompra: fd.get("fechaCompra") || undefined,
    descripcion: fd.get("descripcion") || undefined, items: itemsRaw,
  });
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Datos inválidos." };
  const { sedeId, categoria, marca, nombre, fechaIngreso, fechaCompra, descripcion, items } = p.data;

  const categoriaUpper = categoria.toUpperCase();
  await prisma.$transaction(async (tx) => {
    const codigo = await generarCodigo(tx, categoriaUpper);
    const equipo = await tx.equipoInventario.create({
      data: {
        codigo,
        sedeId,
        categoria: categoriaUpper,
        marca: marca.toUpperCase(),
        nombre: nombre || null,
        items: {
          create: items.map((it) => ({
            descripcion: it.descripcion.toUpperCase(),
            tipo: it.tipo,
            cantidad: it.cantidad,
            lote: it.lote || null,
            estado: it.estado,
          })),
        },
      },
    });
    await tx.novedadInventario.create({
      data: {
        tipo: "ingreso_existente",
        equipoId: equipo.id,
        sedeDestinoId: sedeId,
        estadoNuevo: "activo",
        descripcion: descripcion || "Ingreso de equipo existente",
        usuarioId: g.usuarioId,
        fecha: new Date(fechaIngreso),
        fechaCompraOriginal: fechaCompra ? new Date(fechaCompra) : null,
      },
    });
  });

  refresh();
  return { ok: true };
}

// --- Novedades sobre equipos existentes (baja, daño, reparación, retorno, traslado) ---
const NOVEDADES_OP = ["baja", "dano", "reparacion", "retorno_reparacion", "traslado"] as const;

const novedadSchema = z.object({
  equipoId: z.coerce.number().int().positive("Selecciona un equipo."),
  tipo: z.enum(NOVEDADES_OP),
  itemId: z.coerce.number().int().positive().optional(),
  sedeDestinoId: z.coerce.number().int().positive().optional(),
  fecha: z.string().trim().optional(),
  descripcion: z.string().trim().optional(),
});

/** Estado resultante según el tipo de novedad (null = no cambia estado). */
function estadoDestino(tipo: TipoNovedad): EstadoInventario | null {
  switch (tipo) {
    case "baja": return "de_baja";
    case "dano":
    case "reparacion": return "en_reparacion";
    case "compra":
    case "retorno_reparacion": return "activo";
    default: return null; // traslado no cambia estado
  }
}

export async function registrarNovedadAction(_prev: AccionState, fd: FormData): Promise<AccionState> {
  const g = await guard();
  if ("error" in g) return g;
  const p = novedadSchema.safeParse({
    equipoId: fd.get("equipoId"), tipo: fd.get("tipo"),
    itemId: fd.get("itemId") || undefined, sedeDestinoId: fd.get("sedeDestinoId") || undefined,
    fecha: fd.get("fecha") || undefined, descripcion: fd.get("descripcion") || undefined,
  });
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Datos inválidos." };
  const { equipoId, tipo, itemId, sedeDestinoId, fecha, descripcion } = p.data;

  const equipo = await prisma.equipoInventario.findUnique({ where: { id: equipoId }, include: { items: true } });
  if (!equipo) return { error: "El equipo no existe." };

  if (tipo === "traslado" && !sedeDestinoId) return { error: "Indica la sede destino del traslado." };
  if (tipo === "traslado" && sedeDestinoId === equipo.sedeId) return { error: "La sede destino debe ser distinta a la actual." };

  const nuevoEstado = estadoDestino(tipo);
  const item = itemId ? equipo.items.find((i) => i.id === itemId) : null;
  if (itemId && !item) return { error: "El ítem no pertenece al equipo." };
  const estadoAnterior: EstadoInventario | null = item ? item.estado : null;

  await prisma.$transaction(async (tx) => {
    await tx.novedadInventario.create({
      data: {
        tipo,
        equipoId,
        itemId: itemId ?? null,
        sedeOrigenId: tipo === "traslado" ? equipo.sedeId : null,
        sedeDestinoId: tipo === "traslado" ? sedeDestinoId! : null,
        estadoAnterior,
        estadoNuevo: nuevoEstado,
        descripcion: descripcion || null,
        usuarioId: g.usuarioId,
        ...(fecha ? { fecha: new Date(fecha) } : {}),
      },
    });

    if (tipo === "traslado") {
      await tx.equipoInventario.update({ where: { id: equipoId }, data: { sedeId: sedeDestinoId! } });
    } else if (nuevoEstado) {
      if (itemId) {
        await tx.itemInventario.update({ where: { id: itemId }, data: { estado: nuevoEstado } });
      } else {
        await tx.itemInventario.updateMany({ where: { equipoId }, data: { estado: nuevoEstado } });
        if (tipo === "baja") await tx.equipoInventario.update({ where: { id: equipoId }, data: { activo: false } });
        if (tipo === "retorno_reparacion") await tx.equipoInventario.update({ where: { id: equipoId }, data: { activo: true } });
      }
    }
  });

  refresh();
  return { ok: true };
}
