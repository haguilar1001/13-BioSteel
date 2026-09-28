// ==========================================================
// Recepción Técnica — listado de recepciones (FOR-ALM-005).
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { puede } from "@/lib/rbac/authorize";
import { formatFecha, formatNumero } from "@/lib/format";
import { listarRecepciones, tipoRecepcionLabel, codigoFormato } from "@/lib/negocio/recepcion";
import type { TipoRecepcion } from "@prisma/client";

const fmtValor = (v: number, moneda: string) =>
  `${moneda} ${new Intl.NumberFormat("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;

export const metadata = { title: "Recepción Técnica · BioSteel" };

export default async function RecepcionPage({
  searchParams,
}: { searchParams: Promise<{ tipo?: string; q?: string; lote?: string; ref?: string }> }) {
  const { usuario } = await requirePermiso("recepcion.view");
  const puedeGestionar = await puede(usuario, "recepcion.manage");
  const sp = await searchParams;
  const tipo = sp.tipo === "importacion" || sp.tipo === "nacional" ? (sp.tipo as TipoRecepcion) : undefined;
  const q = sp.q;
  const lote = sp.lote;
  const referencia = sp.ref;

  const filas = await listarRecepciones({ tipo, q, lote, referencia });

  const linkTipo = (t?: string) => {
    const p = new URLSearchParams();
    if (t) p.set("tipo", t);
    if (q) p.set("q", q);
    if (lote) p.set("lote", lote);
    if (referencia) p.set("ref", referencia);
    return `/osteosintesis/recepcion${p.toString() ? `?${p}` : ""}`;
  };
  // Solo quita q/lote/referencia; conserva la pestaña de tipo elegida.
  const hrefLimpiar = tipo ? `/osteosintesis/recepcion?tipo=${tipo}` : "/osteosintesis/recepcion";
  const filtrosTexto = [q && `"${q}"`, lote && `lote "${lote}"`, referencia && `referencia "${referencia}"`].filter(Boolean);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Inventarios · Material</div>
          <h1>Recepción Técnica</h1>
          <p>
            Recibo a satisfacción de dispositivos médicos ({tipo ? codigoFormato(tipo) : "FOR-ALM-005 / FOR-ALM-008"})
            {" "}· {formatNumero(filas.length)} registros
          </p>
        </div>
        {puedeGestionar && (
          <div className="toolbar">
            {/* Sigue la pestaña activa: en Nacionales crea una recepción
                nacional, no una de importación por defecto. */}
            <a href={`/osteosintesis/recepcion/nueva?tipo=${tipo === "nacional" ? "nacional" : "importacion"}`} className="btn primary">
              ➕ Nueva · {tipoRecepcionLabel(tipo === "nacional" ? "nacional" : "importacion")}
            </a>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <form method="get" className="toolbar">
            <a href={linkTipo()} className={`btn${!tipo ? " primary" : ""}`}>Todas</a>
            <a href={linkTipo("importacion")} className={`btn${tipo === "importacion" ? " primary" : ""}`}>Importación</a>
            <a href={linkTipo("nacional")} className={`btn${tipo === "nacional" ? " primary" : ""}`}>Nacionales</a>
            {tipo && <input type="hidden" name="tipo" value={tipo} />}
            <span style={{ flex: 1 }} />
            <input type="search" name="q" defaultValue={q ?? ""} placeholder="Consecutivo, proveedor, factura, ODC…" className="select" style={{ minWidth: 220 }} />
            <input type="search" name="lote" defaultValue={lote ?? ""} placeholder="Lote…" className="select" style={{ minWidth: 140 }} />
            <input type="search" name="ref" defaultValue={referencia ?? ""} placeholder="Referencia…" className="select" style={{ minWidth: 140 }} />
            <button type="submit" className="btn primary">Buscar</button>
            {(q || lote || referencia) && <a href={hrefLimpiar} className="btn">Limpiar</a>}
          </form>
        </div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Consecutivo</th><th>Tipo</th><th>Fecha</th><th>Proveedor</th>
                <th>Factura/Rem.</th><th>ODC</th><th>Resultado</th>
                <th className="r">Ítems</th><th className="r">Valor factura</th><th>Soporte</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 ? (
                <tr><td colSpan={10} className="empty">
                  Sin recepciones{filtrosTexto.length ? ` para ${filtrosTexto.join(" · ")}` : ""}.
                </td></tr>
              ) : (
                filas.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 700 }}>{r.consecutivo}</td>
                    <td><span className={`tag ${r.tipo === "importacion" ? "t-blue" : "t-w1"}`}>{tipoRecepcionLabel(r.tipo)}</span></td>
                    <td className="flag">{formatFecha(r.fechaInspeccion)}</td>
                    <td style={{ fontWeight: 600 }} title={r.proveedorNombre}>{r.proveedorNombre || "—"}</td>
                    <td className="flag">{r.facturaRemision || "—"}</td>
                    <td className="flag">{r.odcPedido || "—"}</td>
                    <td className="flag">{r.resultado || "—"}</td>
                    <td className="r num">{formatNumero(r.items)}</td>
                    <td className="r num">{r.valorFactura ? fmtValor(r.valorFactura, r.monedaFactura) : "—"}</td>
                    <td>
                      <a className="tag t-blue" style={{ textDecoration: "none" }}
                         href={`/soporte/recepcion/${r.id}`} target="_blank" rel="noopener"
                         title="Ver / exportar a PDF el recibo a satisfacción">📄 PDF</a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
