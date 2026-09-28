// ==========================================================
// Recepción Técnica (FOR-ALM-005 · Recibo a Satisfacción de Dispositivos
// Médicos). Solo registro + soporte PDF; no toca inventario.
// ==========================================================
import "server-only";
import { prisma } from "@/lib/db";
import type { TipoRecepcion, VerifDoc } from "@prisma/client";

// --- Constantes del formato (importación) ---

export interface CriterioDef {
  nombre: string;
  /** Texto de referencia "Especificación requerida" (columna del formato). */
  especificacion: string;
  /** Opciones del desplegable: "Conforme" + causales de no conformidad. */
  opciones: string[];
}

/**
 * Los 8 criterios de inspección física (C1–C8), con su especificación
 * requerida y su propia lista desplegable de resultados.
 */
export const CRITERIOS_IMPORTACION: CriterioDef[] = [
  {
    nombre: "Integridad embalaje externo",
    especificacion: "Sin golpes, humedad ni rasgaduras. Sin signos de manipulación indebida.",
    opciones: ["Conforme", "Golpes / deformación", "Humedad / mojado", "Rasgadura / rotura", "Signos de manipulación indebida"],
  },
  {
    nombre: "Integridad empaque primario / secundario",
    especificacion: "Sellado íntegro, sin perforaciones ni apertura previa. Barrera estéril intacta.",
    opciones: ["Conforme", "Sellado abierto o roto", "Perforación en empaque", "Empaque sin sellar", "Barrera estéril comprometida"],
  },
  {
    nombre: "Etiquetado (idioma / datos mínimos)",
    especificacion: "Datos mínimos disponibles en español (etiqueta original o complementaria): nombre, referencia, lote, fecha de vencimiento, fabricante, importador, RS INVIMA, condiciones de almacenamiento.",
    opciones: ["Conforme", "Información mínima no disponible en español", "Falta nombre del producto", "Falta número de lote", "Falta fecha de vencimiento", "Falta datos del fabricante", "Falta RS INVIMA", "Falta nombre del importador", "Etiqueta ilegible o deteriorada"],
  },
  {
    nombre: "Fecha de vencimiento (mín. 6 meses)",
    especificacion: "Vigente al momento de la recepción. Se rechaza si vence en menos de 6 meses, salvo acuerdo escrito con el Director Técnico.",
    opciones: ["Conforme", "Producto vencido", "Vence en menos de 6 meses", "Fecha ilegible", "Sin fecha de vencimiento", "No Aplica"],
  },
  {
    nombre: "N° de lote legible / coincide con documentos",
    especificacion: "Número de lote legible en el empaque. Coincide exactamente con el packing list y el certificado de calidad del fabricante.",
    opciones: ["Conforme", "Lote ilegible", "Lote no coincide con packing list", "Sin número de lote", "Lote diferente al certificado del fabricante"],
  },
  {
    nombre: "Referencia = ODC y RS INVIMA",
    especificacion: "La referencia y modelo recibidos coinciden con la orden de compra y con el Registro Sanitario INVIMA vigente.",
    opciones: ["Conforme", "Referencia no coincide con ODC", "Referencia no está en el RS INVIMA", "Modelo diferente al autorizado", "Referencia no solicitada"],
  },
  {
    nombre: "Condiciones especiales de almacenamiento",
    especificacion: "Condiciones de transporte (T°, humedad) compatibles con las del fabricante. Para implantes ortopédicos: temperatura ambiente, sin cadena de frío.",
    opciones: ["Conforme", "Temperatura fuera de rango en transporte", "Sin evidencia de control de temperatura", "Humedad fuera de especificación"],
  },
  {
    nombre: "Especificación técnica (Ø y longitud)",
    especificacion: "El diámetro y la longitud del implante coinciden con la referencia indicada en la factura comercial y en el RS INVIMA.",
    opciones: ["Conforme", "Diámetro no coincide con referencia", "Longitud no coincide con referencia", "Producto diferente al solicitado", "Sin especificación técnica visible"],
  },
];

/** Documentos de la verificación documental previa (sección 2). */
export const DOCS_IMPORTACION = [
  { campo: "docFacturaComercial", label: "Factura comercial" },
  { campo: "docPackingList", label: "Packing list" },
  { campo: "docImportacion", label: "Documentos importación (DIM/DEX/BL)" },
  { campo: "docRsInvima", label: "RS INVIMA vigente" },
  { campo: "docCertCalidad", label: "Certificado calidad / conformidad fabricante" },
  { campo: "docInstruccionesEsp", label: "Instrucciones de uso en español" },
  { campo: "docCertEsterilidad", label: "Certificado esterilidad (si aplica)" },
] as const;
export type CampoDoc = (typeof DOCS_IMPORTACION)[number]["campo"];

// --- Etiquetas ---
export function tipoRecepcionLabel(t: TipoRecepcion): string {
  return { importacion: "Importación", nacional: "Compras Nacionales" }[t];
}
/**
 * Código del formato controlado: FOR-ALM-005 para importación (el
 * histórico), FOR-ALM-008 para nacional (solicitado por Compras el
 * 2026-09-07: mismo formato base, menos campos, consecutivo propio).
 */
export function codigoFormato(t: TipoRecepcion): string {
  return t === "importacion" ? "FOR-ALM-005" : "FOR-ALM-008";
}
/**
 * Numeración de las secciones del formulario: en nacional la sección 2
 * (Verificación documental de importación) no existe, así que 3 y 4 se
 * corren a 2 y 3 para no dejar un hueco en el consecutivo de secciones.
 */
export function numeroSeccion(t: TipoRecepcion, seccionImportacion: 3 | 4): number {
  return t === "importacion" ? seccionImportacion : seccionImportacion - 1;
}
export function verifDocLabel(v: VerifDoc): string {
  return { si: "Sí", no: "No", na: "N/A" }[v];
}
/** Clase de badge según la opción elegida en un criterio. */
export function claseOpcion(opcion: string): string {
  const o = opcion.trim().toLowerCase();
  if (o === "conforme") return "t-ok";
  if (o === "no aplica" || o === "n/a") return "t-blue";
  return "t-bad";
}

/** Siguiente consecutivo por tipo (RT-IMP-000001 / RT-NAC-000001). */
export async function siguienteConsecutivo(tipo: TipoRecepcion): Promise<string> {
  const pref = tipo === "importacion" ? "RT-IMP-" : "RT-NAC-";
  const ult = await prisma.recepcionTecnica.findFirst({
    where: { consecutivo: { startsWith: pref } },
    orderBy: { consecutivo: "desc" },
    select: { consecutivo: true },
  });
  const n = ult ? parseInt(ult.consecutivo.slice(pref.length), 10) + 1 : 1;
  return pref + String(n).padStart(6, "0");
}

/** Nombres de proveedores para el datalist del formulario. */
export async function proveedoresSugeridos(): Promise<string[]> {
  const t = await prisma.tercero.findMany({
    where: { esProveedor: true }, select: { nombre: true }, orderBy: { nombre: "asc" },
  });
  return t.map((x) => x.nombre);
}

/** Catálogo de monedas para el selector (COP/USD/EUR…). */
export async function monedas(): Promise<{ codigo: string; nombre: string; simbolo: string }[]> {
  return prisma.moneda.findMany({ select: { codigo: true, nombre: true, simbolo: true }, orderBy: { codigo: "asc" } });
}

// --- Listado ---
export interface FiltroRecepcion {
  tipo?: TipoRecepcion; q?: string;
  /** Lote y referencia viven en el ítem, no en la recepción: se filtra por
   * recepciones que tengan AL MENOS UN ítem que coincida. */
  lote?: string; referencia?: string;
}
export interface FilaRecepcion {
  id: number;
  consecutivo: string;
  tipo: TipoRecepcion;
  fechaInspeccion: Date;
  proveedorNombre: string;
  facturaRemision: string;
  odcPedido: string;
  resultado: string;
  valorFactura: number;
  monedaFactura: string;
  items: number;
}

export async function listarRecepciones(f: FiltroRecepcion = {}): Promise<FilaRecepcion[]> {
  const q = f.q?.trim();
  const lote = f.lote?.trim();
  const referencia = f.referencia?.trim();
  const filas = await prisma.recepcionTecnica.findMany({
    where: {
      ...(f.tipo ? { tipo: f.tipo } : {}),
      ...(q
        ? { OR: [
            { consecutivo: { contains: q, mode: "insensitive" } },
            { proveedorNombre: { contains: q, mode: "insensitive" } },
            { facturaRemision: { contains: q, mode: "insensitive" } },
            { odcPedido: { contains: q, mode: "insensitive" } },
          ] }
        : {}),
      ...(lote ? { items: { some: { lote: { contains: lote, mode: "insensitive" } } } } : {}),
      ...(referencia ? { items: { some: { codigo: { contains: referencia, mode: "insensitive" } } } } : {}),
    },
    orderBy: [{ fechaInspeccion: "desc" }, { id: "desc" }],
    take: 300,
    select: {
      id: true, consecutivo: true, tipo: true, fechaInspeccion: true, proveedorNombre: true,
      facturaRemision: true, odcPedido: true, resultado: true, valorFactura: true, monedaFactura: true,
      _count: { select: { items: true } },
    },
  });
  return filas.map((r) => ({
    id: r.id, consecutivo: r.consecutivo, tipo: r.tipo, fechaInspeccion: r.fechaInspeccion,
    proveedorNombre: r.proveedorNombre, facturaRemision: r.facturaRemision, odcPedido: r.odcPedido,
    resultado: r.resultado, valorFactura: r.valorFactura.toNumber(), monedaFactura: r.monedaFactura,
    items: r._count.items,
  }));
}

// --- Detalle (para el soporte PDF) ---
export type RecepcionDetalle = Awaited<ReturnType<typeof obtenerRecepcion>>;

export async function obtenerRecepcion(id: number) {
  const r = await prisma.recepcionTecnica.findUnique({
    where: { id },
    include: { items: { orderBy: { orden: "asc" }, include: { criterios: { orderBy: { orden: "asc" } } } } },
  });
  if (!r) return null;
  return {
    ...r,
    valorFactura: r.valorFactura.toNumber(),
    items: r.items.map((it) => ({
      ...it,
      cantPedida: it.cantPedida.toNumber(),
      cantRecibida: it.cantRecibida.toNumber(),
    })),
  };
}
