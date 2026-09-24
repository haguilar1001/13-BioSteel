// Ppto vs Real — EGRESOS: cumplimiento por mes + ejecución por grupo.
import { requirePermiso } from "@/server/auth-context";
import { formatPorcentaje } from "@/lib/format";
import { Monto } from "../../../_components/Monto";
import { presupuestoVsReal, flujoMensual, MESES_LABEL } from "@/lib/negocio/flujo";
import { FiltroAuto } from "../../../_components/FiltroAuto";
import { MultiSelect, type OpcionMulti } from "../../../_components/MultiSelect";
import { listaDe } from "../../../_components/filtro-multi";
import { CeldaEgreso } from "../_semaforo";

const ANIO = 2026;

export default async function PptoEgresosPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  await requirePermiso("cxp.view");
  const sp = await searchParams;
  const mes = listaDe(sp.mes, new Set(Array.from({ length: 12 }, (_, i) => String(i + 1)))).map(Number);
  const opMeses: OpcionMulti[] = Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({ value: String(m), label: MESES_LABEL[m]! }));

  const [meses, filas] = await Promise.all([flujoMensual(ANIO), presupuestoVsReal(ANIO, mes.length ? mes : undefined)]);

  const totMes = meses.reduce((a, m) => ({ pres: a.pres + m.presupuesto, real: a.real + m.egresos }), { pres: 0, real: 0 });
  const cumplMesTot = totMes.pres > 0 ? (totMes.real / totMes.pres) * 100 : 0;
  const totGrupo = filas.reduce((a, f) => ({ pres: a.pres + f.presupuesto, real: a.real + f.real }), { pres: 0, real: 0 });
  const cumplGrupoTot = totGrupo.pres > 0 ? (totGrupo.real / totGrupo.pres) * 100 : 0;

  return (
    <>
      {/* --- Cumplimiento por mes --- */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-head">Egresos · presupuesto vs real <span className="hact">cumplimiento por mes · {ANIO}</span></div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Mes</th><th className="r">Presupuesto</th><th className="r">Real (egresos)</th>
                <th className="r">Desviación</th><th className="r">Cumplimiento</th>
              </tr>
            </thead>
            <tbody>
              <tr className="fila-total">
                <td style={{ fontWeight: 800 }}>Total {ANIO}</td>
                <td className="r num" style={{ fontWeight: 800 }}><Monto value={totMes.pres} /></td>
                <td className="r num" style={{ fontWeight: 800 }}><Monto value={totMes.real} /></td>
                <td className="r num" style={{ fontWeight: 800, color: totMes.real > totMes.pres ? "var(--bad)" : "var(--ok)" }}><Monto value={totMes.real - totMes.pres} /></td>
                <td className="r num" style={{ fontWeight: 800 }}>{formatPorcentaje(cumplMesTot)}</td>
              </tr>
              {meses.map((m) => {
                const desv = m.egresos - m.presupuesto;
                return (
                  <tr key={m.mes}>
                    <td style={{ fontWeight: 600, textTransform: "uppercase" }}>{MESES_LABEL[m.mes]}</td>
                    <td className="r num"><Monto value={m.presupuesto} /></td>
                    <td className="r num"><Monto value={m.egresos} /></td>
                    <td className="r num" style={{ color: desv > 0 ? "var(--bad)" : desv < 0 ? "var(--ok)" : undefined }}><Monto value={desv} /></td>
                    <td className="r"><CeldaEgreso presupuesto={m.presupuesto} real={m.egresos} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- Ejecución por grupo --- */}
      <div className="card">
        <div className="chart-head">Ejecución por grupo <span className="hact">{mes.length ? mes.map((m) => MESES_LABEL[m]).join(", ") : "año corrido"}</span></div>
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <FiltroAuto className="toolbar">
            <MultiSelect name="mes" options={opMeses} selected={mes.map(String)} placeholder="Año corrido" />
            <a href="/flujo/presupuesto/egresos" className="btn">Año corrido</a>
          </FiltroAuto>
        </div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Grupo</th><th className="r">Presupuesto</th><th className="r">Real (egresos)</th>
                <th className="r">Desviación</th><th className="r">Cumplimiento</th>
              </tr>
            </thead>
            <tbody>
              <tr className="fila-total">
                <td style={{ fontWeight: 800 }}>Total</td>
                <td className="r num" style={{ fontWeight: 800 }}><Monto value={totGrupo.pres} /></td>
                <td className="r num" style={{ fontWeight: 800 }}><Monto value={totGrupo.real} /></td>
                <td className="r num" style={{ fontWeight: 800, color: totGrupo.real > totGrupo.pres ? "var(--bad)" : "var(--ok)" }}><Monto value={totGrupo.real - totGrupo.pres} /></td>
                <td className="r num" style={{ fontWeight: 800 }}>{formatPorcentaje(cumplGrupoTot)}</td>
              </tr>
              {filas.length === 0 ? (
                <tr><td colSpan={5} className="empty">Sin datos de presupuesto.</td></tr>
              ) : filas.map((f) => (
                <tr key={f.categoria}>
                  <td style={{ fontWeight: 600 }}>{f.categoria}</td>
                  <td className="r num"><Monto value={f.presupuesto} /></td>
                  <td className="r num"><Monto value={f.real} /></td>
                  <td className="r num" style={{ color: f.desviacion > 0 ? "var(--bad)" : f.desviacion < 0 ? "var(--ok)" : undefined }}><Monto value={f.desviacion} /></td>
                  <td className="r"><CeldaEgreso presupuesto={f.presupuesto} real={f.real} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
