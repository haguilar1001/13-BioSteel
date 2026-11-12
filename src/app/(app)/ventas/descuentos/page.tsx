// ==========================================================
// Ventas · Descuentos Financieros por Cliente — réplica de la vista de Power
// BI. Subtotal, nota crédito (descuento reliquidado), % y venta neta por
// cliente. Sirve para comparar con PBI y detectar notas crédito sin calcular.
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { Monto } from "../../_components/Monto";
import { FiltroAuto } from "../../_components/FiltroAuto";
import { AccionesDescarga } from "../../_components/AccionesDescarga";
import { aniosConVenta, mesesConVenta } from "@/lib/negocio/ventas";
import { descuentosPorCliente } from "@/lib/negocio/descuentos";

const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const pct1 = (v: number) => `${v.toFixed(1).replace(".", ",")} %`;

export default async function DescuentosPage({
  searchParams,
}: {
  searchParams: Promise<{ anio?: string; mes?: string }>;
}) {
  await requirePermiso("cxp.view");
  const sp = await searchParams;

  const anios = await aniosConVenta();
  if (anios.length === 0) {
    return <div className="card"><div className="card-body"><div className="empty">Sin ventas cargadas. Corre <code>npm run db:ventas</code>.</div></div></div>;
  }
  const anio = sp.anio && anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios[anios.length - 1]!;
  const mesesDisp = await mesesConVenta(anio);
  const mesNum = Number(sp.mes);
  const mesSel = mesNum >= 1 && mesNum <= 12 ? mesNum : null;

  const r = await descuentosPorCliente(anio, mesSel ? [mesSel] : undefined);
  const periodo = mesSel ? `${MESES[mesSel]} ${anio}` : String(anio);
  const excelHref = `/ventas/descuentos/export?${new URLSearchParams({ anio: String(anio), ...(mesSel ? { mes: String(mesSel) } : {}) }).toString()}`;

  return (
    <>
      <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <AccionesDescarga excelHref={excelHref} />
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="eyebrow" style={{ fontSize: 15 }}>Descuentos Financieros por Cliente · {periodo}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              Venta neta = <b>subtotal − nota crédito</b> · la nota crédito se reliquida con el motor de descuentos (mismo del informe)
            </div>
          </div>
          <FiltroAuto className="toolbar">
            <label className="flag" style={{ alignSelf: "center" }}>Año:</label>
            <select name="anio" defaultValue={anio} className="select">
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <label className="flag" style={{ alignSelf: "center" }}>Mes:</label>
            <select name="mes" defaultValue={mesSel ?? ""} className="select">
              <option value="">Todos</option>
              {mesesDisp.map((m) => <option key={m} value={m}>{MESES[m]}</option>)}
            </select>
          </FiltroAuto>
        </div>
      </div>

      {r.sinColumnasNC > 0 && (
        <div className="card" style={{ marginBottom: 12, border: "1px solid var(--bad)" }}>
          <div className="card-body" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            ⚠️ <b>{r.sinColumnasNC.toLocaleString("es-CO")}</b> renglón(es) FET del período vienen <b>sin las columnas</b> que el
            motor de notas crédito necesita (sucursal, convenio, procedimiento y línea, todas vacías). A esos renglones
            <b> no se les calculó descuento</b>, así que la nota crédito queda corta y el <b>neto sale inflado</b>. Vuelve a
            exportar de SIESA el informe de ventas <b>con todas las columnas</b> y recarga el período.
          </div>
        </div>
      )}

      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi kc"><div className="klabel">Valor subtotal</div><div className="kval num"><Monto value={r.subtotal} /></div></div>
        <div className="kpi kc k-egreso"><div className="klabel">Nota crédito total</div><div className="kval num"><Monto value={r.notaCredito} /></div></div>
        <div className="kpi kc k-ingreso"><div className="klabel">Venta neta</div><div className="kval num"><Monto value={r.neto} /></div></div>
        <div className="kpi kc k-w"><div className="klabel">% descuento</div><div className="kval num">{pct1(r.pct)}</div></div>
      </div>

      <div className="card">
        <div className="chart-head">
          Descuentos Financieros por Cliente
          <span className="hact">{r.filas.length} cliente(s) · {periodo}</span>
        </div>
        <div className="tbl-wrap">
          <table className="tabla-fit">
            <thead>
              <tr>
                <th>Razón social cliente despacho</th>
                <th className="r">Valor subtotal</th>
                <th className="r">Nota crédito</th>
                <th className="r">% descuento</th>
                <th className="r">Venta neta</th>
              </tr>
            </thead>
            <tbody>
              <tr className="fila-total">
                <td style={{ fontWeight: 800 }}>Total · {periodo}</td>
                <td className="r num" style={{ fontWeight: 800 }}><Monto value={r.subtotal} /></td>
                <td className="r num" style={{ fontWeight: 800 }}><Monto value={r.notaCredito} /></td>
                <td className="r num" style={{ fontWeight: 800 }}>{pct1(r.pct)}</td>
                <td className="r num" style={{ fontWeight: 800 }}><Monto value={r.neto} /></td>
              </tr>
              {r.filas.length === 0 ? (
                <tr><td colSpan={5}><div className="empty">Sin ventas en el período.</div></td></tr>
              ) : r.filas.map((f) => (
                <tr key={f.cliente}>
                  <td style={{ fontWeight: 600 }} title={f.cliente}>{f.cliente}</td>
                  <td className="r num"><Monto value={f.subtotal} /></td>
                  <td className="r num" style={{ color: f.notaCredito > 0 ? "var(--bad)" : undefined }}><Monto value={f.notaCredito} /></td>
                  <td className="r num" data-orden={f.pct}>{pct1(f.pct)}</td>
                  <td className="r num" style={{ fontWeight: 600 }}><Monto value={f.neto} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ padding: "8px 14px", fontSize: 12, color: "var(--muted)" }}>
          La <b>nota crédito</b> es el descuento financiero reliquidado renglón por renglón (solo documentos FET) con los
          parámetros vigentes por IPS, concepto y fecha. El <b>neto</b> cuadra con la Venta Neta del informe. Compara el
          <b> % descuento</b> con tu Power BI: si en un cliente sale más bajo aquí, es que a esa venta no se le calculó la nota crédito.
        </div>
      </div>
    </>
  );
}
