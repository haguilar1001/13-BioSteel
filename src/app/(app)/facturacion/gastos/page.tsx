// Gastos: indicadores mensuales (según medidas DAX):
//  · VR facturado / VR gastos
//  · Tiempo de facturación 0–5 días
//  · Facturas anuladas
//
// Las tres metas son editables desde Administración → Configuración → Metas
// de indicadores (metas-indicador.ts); si nadie las ha tocado, usan su valor
// por defecto. Antes estaban escritas a mano aquí mismo.
import { requirePermiso } from "@/server/auth-context";
import { formatPorcentaje } from "@/lib/format";
import { Monto } from "../../_components/Monto";
import { FiltroAuto } from "../../_components/FiltroAuto";
import { aniosFacturacion, gastosPorMes, type GastoMes } from "@/lib/negocio/facturacion";
import { obtenerMeta } from "@/lib/negocio/metas-indicador";

const MES_ABBR = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const nf = new Intl.NumberFormat("es-CO");

function marca(ok: boolean) {
  return <span style={{ color: ok ? "var(--ok)" : "var(--bad)", fontWeight: 700 }}>{ok ? " ✔" : " ✘"}</span>;
}

export default async function GastosPage({ searchParams }: { searchParams: Promise<{ anio?: string }> }) {
  await requirePermiso("cxp.view");
  const sp = await searchParams;
  const anios = await aniosFacturacion();
  if (anios.length === 0) {
    return <div className="card"><div className="card-body"><div className="empty">Sin gastos cargados. Sube los archivos en <code>/cargar</code>.</div></div></div>;
  }
  const anio = sp.anio && anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios[anios.length - 1]!;
  const [meses, metaValor, metaTiempo, metaAnuladas] = await Promise.all([
    gastosPorMes(anio), obtenerMeta("gastos.valor"), obtenerMeta("gastos.tiempo"), obtenerMeta("gastos.anuladas"),
  ]);

  // Totales del año.
  const t = meses.reduce((a, m) => ({
    nGastos: a.nGastos + m.nGastos, vrGastos: a.vrGastos + m.vrGastos,
    nFacturasMes: a.nFacturasMes + m.nFacturasMes, vrFacturaMes: a.vrFacturaMes + m.vrFacturaMes,
    cumpl05: a.cumpl05 + m.cumpl05, cumpl68: a.cumpl68 + m.cumpl68, cumpl9: a.cumpl9 + m.cumpl9,
    pendientes: a.pendientes + m.pendientes, vrPendientes: a.vrPendientes + m.vrPendientes,
    notasAnulacion: a.notasAnulacion + m.notasAnulacion,
  }), { nGastos: 0, vrGastos: 0, nFacturasMes: 0, vrFacturaMes: 0, cumpl05: 0, cumpl68: 0, cumpl9: 0, pendientes: 0, vrPendientes: 0, notasAnulacion: 0 });
  const tPctValor = t.vrGastos ? (t.vrFacturaMes / t.vrGastos) * 100 : 0;
  const tPctCumplido = t.nGastos ? (t.cumpl05 / t.nGastos) * 100 : 0;
  const tPctAnul = t.nFacturasMes ? (t.notasAnulacion / t.nFacturasMes) * 100 : 0;

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div className="eyebrow" style={{ fontSize: 15 }}>Indicadores de gastos · {anio}</div>
          <FiltroAuto className="toolbar">
            <label className="flag" style={{ alignSelf: "center" }}>Año:</label>
            <select name="anio" defaultValue={anio} className="select">{anios.map((a) => <option key={a} value={a}>{a}</option>)}</select>
          </FiltroAuto>
        </div>
      </div>

      {/* VR facturado / VR gastos */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-head">Vr. facturado / Vr. gastos <span className="hact">meta ≥ {metaValor} %</span></div>
        <div className="tbl-wrap">
          <table className="tabla-fit">
            <thead><tr><th>Mes</th><th className="r">Vr. factura mes</th><th className="r"># Facturas</th><th className="r">Vr. gastos</th><th className="r"># Gastos</th><th className="r">% Valor</th><th className="r">% Cant.</th></tr></thead>
            <tbody>
              {meses.map((m) => (
                <tr key={m.mes}>
                  <td style={{ fontWeight: 600 }}>{MES_ABBR[m.mes]}</td>
                  <td className="r num"><Monto value={m.vrFacturaMes} /></td>
                  <td className="r num">{nf.format(m.nFacturasMes)}</td>
                  <td className="r num flag"><Monto value={m.vrGastos} /></td>
                  <td className="r num">{nf.format(m.nGastos)}</td>
                  <td className="r num" style={{ fontWeight: 700 }}>{formatPorcentaje(m.pctValor)}{marca(m.pctValor >= metaValor)}</td>
                  <td className="r num">{formatPorcentaje(m.pctCantidad)}</td>
                </tr>
              ))}
              <tr className="fila-total">
                <td style={{ fontWeight: 800 }}>Total</td>
                <td className="r num" style={{ fontWeight: 800 }}><Monto value={t.vrFacturaMes} /></td>
                <td className="r num" style={{ fontWeight: 800 }}>{nf.format(t.nFacturasMes)}</td>
                <td className="r num" style={{ fontWeight: 800 }}><Monto value={t.vrGastos} /></td>
                <td className="r num" style={{ fontWeight: 800 }}>{nf.format(t.nGastos)}</td>
                <td className="r num" style={{ fontWeight: 800 }}>{formatPorcentaje(tPctValor)}{marca(tPctValor >= metaValor)}</td>
                <td className="r num" style={{ fontWeight: 800 }}>{formatPorcentaje(t.nGastos ? (t.nFacturasMes / t.nGastos) * 100 : 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Tiempo de facturación 0–5 días */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-head">Tiempo de facturación (0–5 días) <span className="hact">meta ≥ {metaTiempo} %</span></div>
        <div className="tbl-wrap">
          <table className="tabla-fit">
            <thead><tr><th>Mes</th><th className="r"># Gastos</th><th className="r">Cumpl. 0–5</th><th className="r">6–8</th><th className="r">&gt; 8</th><th className="r">Pendientes</th><th className="r">Vr. pendientes</th><th className="r">% cumplido</th></tr></thead>
            <tbody>
              {meses.map((m) => (
                <tr key={m.mes}>
                  <td style={{ fontWeight: 600 }}>{MES_ABBR[m.mes]}</td>
                  <td className="r num">{nf.format(m.nGastos)}</td>
                  <td className="r num" style={{ fontWeight: 700 }}>{nf.format(m.cumpl05)}</td>
                  <td className="r num">{nf.format(m.cumpl68)}</td>
                  <td className="r num">{nf.format(m.cumpl9)}</td>
                  <td className="r num">{nf.format(m.pendientes)}</td>
                  <td className="r num flag"><Monto value={m.vrPendientes} /></td>
                  <td className="r num" style={{ fontWeight: 700 }}>{formatPorcentaje(m.pctCumplido)}{marca(m.pctCumplido >= metaTiempo)}</td>
                </tr>
              ))}
              <tr className="fila-total">
                <td style={{ fontWeight: 800 }}>Total</td>
                <td className="r num" style={{ fontWeight: 800 }}>{nf.format(t.nGastos)}</td>
                <td className="r num" style={{ fontWeight: 800 }}>{nf.format(t.cumpl05)}</td>
                <td className="r num" style={{ fontWeight: 800 }}>{nf.format(t.cumpl68)}</td>
                <td className="r num" style={{ fontWeight: 800 }}>{nf.format(t.cumpl9)}</td>
                <td className="r num" style={{ fontWeight: 800 }}>{nf.format(t.pendientes)}</td>
                <td className="r num" style={{ fontWeight: 800 }}><Monto value={t.vrPendientes} /></td>
                <td className="r num" style={{ fontWeight: 800 }}>{formatPorcentaje(tPctCumplido)}{marca(tPctCumplido >= metaTiempo)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Facturas anuladas */}
      <div className="card">
        <div className="chart-head">Facturas anuladas <span className="hact">meta ≤ {metaAnuladas} %</span></div>
        <div className="tbl-wrap">
          <table className="tabla-fit">
            <thead><tr><th>Mes</th><th className="r"># Notas anulación</th><th className="r"># Facturas del mes</th><th className="r">% anuladas</th></tr></thead>
            <tbody>
              {meses.map((m) => (
                <tr key={m.mes}>
                  <td style={{ fontWeight: 600 }}>{MES_ABBR[m.mes]}</td>
                  <td className="r num">{nf.format(m.notasAnulacion)}</td>
                  <td className="r num flag">{nf.format(m.nFacturasMes)}</td>
                  <td className="r num" style={{ fontWeight: 700 }}>{formatPorcentaje(m.pctAnuladas)}{marca(m.pctAnuladas <= metaAnuladas)}</td>
                </tr>
              ))}
              <tr className="fila-total">
                <td style={{ fontWeight: 800 }}>Total</td>
                <td className="r num" style={{ fontWeight: 800 }}>{nf.format(t.notasAnulacion)}</td>
                <td className="r num" style={{ fontWeight: 800 }}>{nf.format(t.nFacturasMes)}</td>
                <td className="r num" style={{ fontWeight: 800 }}>{formatPorcentaje(tPctAnul)}{marca(tPctAnul <= metaAnuladas)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
