// ==========================================================
// Aviso por correo de un TRASLADO de equipo entre sedes, con la remisión
// (el soporte de la novedad) adjunta en PDF.
//
// Quién lo recibe: los usuarios activos de la sede de ORIGEN y de la de
// DESTINO (las sedes no tienen buzón propio), quien registró el traslado y los
// correos extra de INVENTARIO_NOTIF_EMAILS. Así avisa igual cuando la sede le
// envía un equipo a la oficina que cuando la oficina se lo envía a la sede.
//
// El PDF se arma con pdf-lib (JS puro): en Railway no hay navegador para
// "imprimir" la página del soporte. Nunca lanza: si el correo no está
// configurado o falla, el traslado ya quedó registrado y solo se deja el log.
// ==========================================================
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { formatFechaHoraSeg, formatFechaSello, formatNumero } from "@/lib/format";
import { estadoLabel, soporteNovedad, tipoLabel, type SoporteNovedad } from "@/lib/negocio/inventario";
import { correoConfigurado, enviarCorreo } from "./mailer";

const EMPRESA = "BioSteel de Colombia S.A.S";
const NIT = "900.230.040-6";
const LINK = env.APP_URL && !/localhost/i.test(env.APP_URL) ? env.APP_URL : "https://biosteel.up.railway.app";

const AZUL = rgb(0x2a / 255, 0x4f / 255, 0x98 / 255);
const AZUL_CLARO = rgb(0xea / 255, 0xf1 / 255, 0xf9 / 255);
const TINTA = rgb(0x1b / 255, 0x24 / 255, 0x30 / 255);
const GRIS = rgb(0x64 / 255, 0x74 / 255, 0x8b / 255);
const LINEA = rgb(0xd8 / 255, 0xe2 / 255, 0xef / 255);

/** Las fuentes estándar del PDF solo cubren Latin-1: lo demás (flechas, emojis) se cambia por "?". */
function limpio(t: string): string {
  return t.replace(/[^ -~ -ÿ]/g, "?");
}

/** Parte un texto en líneas que quepan en `ancho`. */
function envolver(texto: string, font: PDFFont, size: number, ancho: number): string[] {
  const out: string[] = [];
  let linea = "";
  for (const palabra of limpio(texto).split(/\s+/).filter(Boolean)) {
    const prueba = linea ? `${linea} ${palabra}` : palabra;
    if (font.widthOfTextAtSize(prueba, size) <= ancho) linea = prueba;
    else { if (linea) out.push(linea); linea = palabra; }
  }
  if (linea) out.push(linea);
  return out.length ? out : [""];
}

/** Remisión de traslado en PDF (A4). */
export async function remisionTrasladoPdf(s: SoporteNovedad): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);

  let logo: PDFImage | null = null;
  try {
    logo = await pdf.embedPng(fs.readFileSync(path.join(process.cwd(), "public", "BIOSTEEL.png")));
  } catch { /* sin logo: la remisión sale igual */ }

  const W = 595.28, H = 841.89, M = 42;
  let page!: PDFPage;
  let y = 0;
  const nuevaPagina = () => { page = pdf.addPage([W, H]); y = H - M; };
  const asegurar = (alto: number) => { if (y - alto < M + 40) nuevaPagina(); };
  const texto = (t: string, x: number, yy: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) =>
    page.drawText(limpio(t), { x, y: yy, size: o.size ?? 10, font: o.font ?? normal, color: o.color ?? TINTA });
  const derecha = (t: string, xFin: number, yy: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) => {
    const f = o.font ?? normal, sz = o.size ?? 10;
    texto(t, xFin - f.widthOfTextAtSize(limpio(t), sz), yy, o);
  };

  nuevaPagina();

  // ---- Encabezado ----
  if (logo) {
    const h = 38, w = (logo.width / logo.height) * h;
    page.drawImage(logo, { x: M, y: y - h, width: Math.min(w, 120), height: h });
  }
  texto(EMPRESA, M + 84, y - 12, { font: negrita, size: 11 });
  texto(`NIT ${NIT}`, M + 84, y - 25, { size: 9, color: GRIS });
  texto("Material de osteosintesis - Barranquilla, Colombia", M + 84, y - 37, { size: 9, color: GRIS });
  derecha("REMISION DE TRASLADO", W - M, y - 12, { font: negrita, size: 13, color: AZUL });
  derecha(s.consecutivo, W - M, y - 30, { font: negrita, size: 12 });
  y -= 56;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 2, color: AZUL });
  y -= 22;

  // ---- Bloque de datos ----
  const fila = (k: string, v: string, grande = false) => {
    const lineas = envolver(v || "-", grande ? negrita : normal, 10, W - 2 * M - 150);
    asegurar(lineas.length * 13 + 6);
    texto(k.toUpperCase(), M, y, { size: 8, font: negrita, color: GRIS });
    lineas.forEach((l, i) => texto(l, M + 150, y - i * 13, { font: grande ? negrita : normal }));
    y -= lineas.length * 13 + 6;
  };
  const seccion = (titulo: string) => {
    asegurar(40);
    page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 18, color: AZUL_CLARO });
    texto(titulo, M + 8, y, { font: negrita, size: 10, color: AZUL });
    y -= 26;
  };

  seccion("DATOS DEL TRASLADO");
  fila("Fecha del traslado", formatFechaSello(s.fecha), true);
  fila("Sede de origen", s.sedeOrigen ?? "-");
  fila("Sede de destino", s.sedeDestino ?? "-", true);
  fila("Motivo / descripcion", s.descripcion ?? "-");

  y -= 6;
  seccion("EQUIPO");
  fila("Codigo de inventario", s.equipoCodigo ?? "-", true);
  fila("Categoria", s.categoria);
  fila("Marca / modelo", s.marca);
  if (s.nombre) fila("Nombre", s.nombre);

  // ---- Ítems ----
  y -= 6;
  seccion(s.item ? "ITEM TRASLADADO" : "ITEMS DEL EQUIPO (TODO EL EQUIPO)");
  const items = s.item ? [s.item] : s.equipoItems;
  const cols = [
    { t: "Descripcion", x: M + 4, w: 200 },
    { t: "Tipo", x: M + 210, w: 60 },
    { t: "Lote / serial", x: M + 276, w: 100 },
    { t: "Cant.", x: M + 380, w: 40 },
    { t: "Estado", x: M + 426, w: 80 },
  ];
  const cabecera = () => {
    cols.forEach((c) => texto(c.t.toUpperCase(), c.x, y, { size: 8, font: negrita, color: GRIS }));
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: LINEA });
    y -= 13;
  };
  cabecera();
  for (const it of items) {
    const desc = envolver(it.descripcion, normal, 9, cols[0]!.w);
    const alto = desc.length * 12 + 4;
    if (y - alto < M + 40) { nuevaPagina(); cabecera(); }
    desc.forEach((l, i) => texto(l, cols[0]!.x, y - i * 12, { size: 9 }));
    texto(tipoLabel(it.tipo), cols[1]!.x, y, { size: 9 });
    texto(it.lote ?? "-", cols[2]!.x, y, { size: 9 });
    texto(formatNumero(it.cantidad), cols[3]!.x, y, { size: 9 });
    texto(estadoLabel(it.estado), cols[4]!.x, y, { size: 9 });
    y -= alto;
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.4, color: LINEA });
  }

  // ---- Firmas ----
  asegurar(110);
  y -= 50;
  const ancho = (W - 2 * M - 40) / 2;
  const firma = (x: number, nombre: string, rol: string) => {
    page.drawLine({ start: { x, y }, end: { x: x + ancho, y }, thickness: 0.8, color: TINTA });
    texto(nombre || " ", x, y - 13, { font: negrita, size: 10 });
    texto(rol, x, y - 26, { size: 8.5, color: GRIS });
  };
  firma(M, s.usuario ?? "", "Entrega (elaborado por, usuario del sistema)");
  firma(M + ancho + 40, "", "Recibe / Vo. Bo. de la sede destino");

  // ---- Pie en todas las páginas ----
  const paginas = pdf.getPages();
  paginas.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 38 }, end: { x: W - M, y: 38 }, thickness: 0.5, color: LINEA });
    p.drawText(limpio(`Registrado por ${s.usuario ?? "-"} el ${formatFechaHoraSeg(s.createdAt)} - ID interno ${s.id}`), { x: M, y: 26, size: 8, font: normal, color: GRIS });
    const pie = `Documento generado por el sistema BioSteel - pag. ${i + 1}/${paginas.length}`;
    p.drawText(pie, { x: W - M - normal.widthOfTextAtSize(pie, 8), y: 26, size: 8, font: normal, color: GRIS });
  });

  return Buffer.from(await pdf.save());
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function cuerpoHtml(s: SoporteNovedad): string {
  const fila = (label: string, valor: string) =>
    `<tr>
       <td style="padding:10px 14px;border-bottom:1px solid #EEF2F7;color:#5B6B82;font-size:13px;white-space:nowrap">${label}</td>
       <td style="padding:10px 14px;border-bottom:1px solid #EEF2F7;text-align:right;font-weight:700;color:#1B2434;font-size:14px">${esc(valor)}</td>
     </tr>`;
  const equipo = [s.equipoCodigo, s.categoria, s.marca].filter(Boolean).join(" · ");
  return `
  <div style="background:#EFF3F8;padding:24px 12px">
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;background:#FFFFFF;border:1px solid #E3E9F1;border-radius:14px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#2A4F98,#1E3A70);padding:26px 24px;text-align:center;color:#ffffff">
        <div style="font-size:38px;line-height:1">🚚</div>
        <div style="font-size:20px;font-weight:800;margin-top:8px">Traslado de equipo</div>
        <div style="font-size:13px;opacity:.85;margin-top:4px">${esc(s.consecutivo)}</div>
      </div>
      <div style="padding:24px">
        <p style="margin:0 0 16px;font-size:14.5px;line-height:1.55;color:#3a4657">
          Se registró el traslado de un equipo entre sedes. La <strong>remisión</strong> va adjunta en PDF.
        </p>
        <table style="width:100%;border-collapse:collapse;border:1px solid #EEF2F7;margin-bottom:20px">
          ${fila("📦 Equipo", equipo)}
          ${fila("📅 Fecha", formatFechaSello(s.fecha))}
          ${fila("🏢 Sede origen", s.sedeOrigen ?? "—")}
          ${fila("🏁 Sede destino", s.sedeDestino ?? "—")}
          ${fila("👤 Registrado por", s.usuario ?? "—")}
        </table>
        ${s.descripcion ? `<p style="margin:0 0 18px;font-size:13px;color:#5B6B82"><strong>Motivo:</strong> ${esc(s.descripcion)}</p>` : ""}
        <div style="text-align:center">
          <a href="${LINK}/inventario/novedades" style="display:inline-block;background:#2A4F98;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:10px">Ver en el sistema →</a>
        </div>
      </div>
      <div style="padding:14px 24px;background:#F6F8FC;font-size:11.5px;color:#8a97ab;text-align:center">
        ${EMPRESA} · Aviso automático, no respondas a este correo.
      </div>
    </div>
  </div>`;
}

/** Destinatarios: usuarios activos de las dos sedes + quien registró + extras del entorno. */
async function destinatarios(usuarioId: number | null, sedeIds: number[]): Promise<string[]> {
  const usuarios = await prisma.usuario.findMany({
    where: {
      activo: true,
      OR: [
        ...(sedeIds.length ? [{ sedeId: { in: sedeIds } }] : []),
        ...(usuarioId ? [{ id: usuarioId }] : []),
      ],
    },
    select: { email: true },
  });
  const extras = (env.INVENTARIO_NOTIF_EMAILS ?? "").split(/[,;\s]+/).filter((e) => e.includes("@"));
  return [...new Set([...usuarios.map((u) => u.email), ...extras].map((e) => e.trim().toLowerCase()))];
}

/**
 * Avisa por correo el traslado `novedadId` con la remisión adjunta. No lanza
 * nunca: devuelve cuántos destinatarios recibieron el aviso (0 si no se envió).
 */
export async function notificarTraslado(novedadId: number): Promise<number> {
  try {
    if (!correoConfigurado()) {
      console.warn(`[traslado] Correo no configurado: no se avisa del traslado ${novedadId}.`);
      return 0;
    }
    const s = await soporteNovedad(novedadId);
    if (!s || s.tipo !== "traslado") return 0;
    const n = await prisma.novedadInventario.findUnique({
      where: { id: novedadId },
      select: { usuarioId: true, sedeOrigenId: true, sedeDestinoId: true },
    });
    const sedeIds = [n?.sedeOrigenId, n?.sedeDestinoId].filter((x): x is number => x != null);
    const para = await destinatarios(n?.usuarioId ?? null, sedeIds);
    if (!para.length) {
      console.warn(`[traslado] Sin destinatarios para el traslado ${novedadId}.`);
      return 0;
    }
    const pdf = await remisionTrasladoPdf(s);
    await enviarCorreo(
      para,
      `Traslado de equipo ${s.consecutivo}: ${s.sedeOrigen ?? "—"} → ${s.sedeDestino ?? "—"}`,
      cuerpoHtml(s),
      [{ filename: `Remision-${s.consecutivo}.pdf`, content: pdf }],
    );
    return para.length;
  } catch (e) {
    console.error(`[traslado] No se pudo enviar el aviso del traslado ${novedadId}:`, e);
    return 0;
  }
}
