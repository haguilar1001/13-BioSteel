// ==========================================================
// Compras por Proveedor × Mes — la matriz anual: cada proveedor, lo que se
// le facturó mes a mes. Es la vista que vivía en /ventas/compras.
//
// Cambió la fuente al traerla: allá salía de DocumentoCxp, que NO es un
// reporte de compras sino el saldo de cuentas por pagar (solo documentos con
// saldo abierto, notas crédito en negativo, y registros desde 2017). Daba
// $1.840M para 2025 cuando lo facturado ese año fueron $14.668M. Ahora sale
// de CompraFactura, igual que el KPI "Facturado Proveedor" del informe, así
// que las dos pantallas dicen lo mismo.
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { formatCOP, formatNumero } from "@/lib/format";
import { Monto } from "../../_components/Monto";
import { facturadoPorProveedorMes, MES_CORTO } from "@/lib/negocio/compras";
import { resolverFiltro, type ParamsCompras } from "../_filtro";
import { BarraFiltros } from "../_BarraFiltros";

/** La matriz va en millones: con 12 columnas el valor completo no cabe. */
const mill = (v: number) =>
  v === 0 ? "—" : new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(Math.round(v / 1e6));

export default async function ProveedoresPage({ searchParams }: { searchParams: Promise<ParamsCompras> }) {
  await requirePermiso("compras.view");
  const c = await resolverFiltro(await searchParams);

  if (!c) {
    return (
      <div className="card"><div className="card-body">
        <div className="empty">Sin compras cargadas. Súbelas desde <a href="/cargar">Cargar archivos</a>.</div>
      </div></div>
    );
  }

  const { filas, totalMes, total } = await facturadoPorProveedorMes(c.filtro);

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingBottom: 12 }}>
          <div style={{ marginBottom: 10 }}>
            <div className="eyebrow" style={{ fontSize: 15 }}>
              Compras por Proveedor × Mes · {c.filtro.anio} · {formatNumero(filas.length)} proveedores
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              Facturado por proveedor. La matriz es anual: el filtro de mes y día no aplica aquí.
              {c.filtro.instalacion?.length ? " El de instalación tampoco: el documento CCP no trae bodega." : ""}
            </div>
          </div>
          <BarraFiltros
            c={c}
            extra={<a href={`/compras/proveedores/export?${c.query}`} className="btn" title="Descargar la matriz en Excel">⬇️ Excel</a>}
          />
        </div>
      </div>

      <div className="card">
        <div className="chart-head">
          Facturado Proveedor · valores en millones COP
          <span className="hact">total <Monto value={total} /></span>
        </div>
        <div className="tbl-wrap">
          <table className="tabla-fit" style={{ fontSize: 12.5 }} data-noorden>
            <thead>
              <tr>
                <th style={{ minWidth: 240 }}>Proveedor</th>
                <th style={{ minWidth: 120 }}>Tipo de compra</th>
                {MES_CORTO.slice(1).map((m) => <th key={m} className="r" style={{ width: 60 }}>{m}</th>)}
                <th className="r" style={{ background: "var(--brand-tint)", width: 70 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className="fila-total">
                <td style={{ fontWeight: 800 }}>Total · {formatNumero(filas.length)} prov.</td>
                <td />
                {totalMes.map((v, i) => <td key={i} className="r num" style={{ fontWeight: 800 }}>{mill(v)}</td>)}
                <td className="r num" style={{ fontWeight: 800, background: "var(--brand-tint)" }}>{mill(total)}</td>
              </tr>
              {filas.length === 0 ? (
                <tr><td colSpan={15}><div className="empty">Sin facturas de proveedor en {c.filtro.anio}.</div></td></tr>
              ) : (
                filas.map((f) => (
                  <tr key={f.proveedor}>
                    <td style={{ fontWeight: 600 }} title={f.proveedor}>{f.proveedor}</td>
                    <td className="flag">{f.tipoCompra}</td>
                    {f.meses.map((v, i) => (
                      <td key={i} className="r num" style={{ color: v === 0 ? "var(--muted)" : undefined }} title={v ? formatCOP(v) : ""}>
                        {mill(v)}
                      </td>
                    ))}
                    <td className="r num" style={{ fontWeight: 700, background: "var(--brand-tint)" }}>{mill(f.total)}</td>
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
