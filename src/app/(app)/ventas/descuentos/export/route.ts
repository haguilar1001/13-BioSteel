// Exporta a Excel los Descuentos Financieros por Cliente del período vigente.
import type { NextRequest } from "next/server";
import { requireUsuario } from "@/server/auth-context";
import { puede } from "@/lib/rbac/authorize";
import { libroDescarga } from "@/lib/xlsx-export";
import { descuentosPorCliente } from "@/lib/negocio/descuentos";

const r1 = (v: number) => Number(v.toFixed(1));
const r0 = (v: number) => Math.round(v);

export async function GET(req: NextRequest) {
  const usuario = await requireUsuario();
  if (!(await puede(usuario, "cxp.view"))) return new Response("No autorizado", { status: 403 });

  const sp = req.nextUrl.searchParams;
  const anio = Number(sp.get("anio")) || new Date().getUTCFullYear();
  const mesNum = Number(sp.get("mes"));
  const mes = mesNum >= 1 && mesNum <= 12 ? mesNum : null;

  const r = await descuentosPorCliente(anio, mes ? [mes] : undefined);

  return libroDescarga({
    hoja: "Descuentos financieros",
    encabezado: ["Razón social cliente despacho", "Valor subtotal", "Nota crédito", "% descuento", "Venta neta"],
    filas: [
      ["TOTAL", r0(r.subtotal), r0(r.notaCredito), r1(r.pct), r0(r.neto)],
      ...r.filas.map((f) => [f.cliente, r0(f.subtotal), r0(f.notaCredito), r1(f.pct), r0(f.neto)]),
    ],
    anchos: [48, 18, 16, 12, 18],
    archivo: `descuentos-financieros-${anio}${mes ? `-${mes}` : ""}.xlsx`,
  });
}
