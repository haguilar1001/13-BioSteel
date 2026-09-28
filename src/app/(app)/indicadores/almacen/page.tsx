// ==========================================================
// Indicadores de Almacén — % de cumplimiento de especificaciones técnicas.
// Sale en vivo de Recepción Técnica (FOR-ALM-005 / FOR-ALM-008): cada
// recepción registrada es una evaluación, y "Aceptado" + "Aceptado con
// observaciones" cuentan como conforme (ver indicador-almacen.ts).
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { formatNumero, formatPorcentaje } from "@/lib/format";
import { Medidor } from "../../_components/charts/Medidor";
import { LineasMensuales } from "../../_components/charts/LineasMensuales";
import { claseOpcion } from "@/lib/negocio/recepcion";
import {
  resumenAceptacion, aniosConRecepciones, META, MES_CORTO, MES_LARGO,
} from "@/lib/negocio/indicador-almacen";

const MES_ABBR = ["", "ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
const pct1 = (v: number) => `${v.toFixed(1).replace(".", ",")} %`;

function tag(valor: number | null) {
  if (valor == null) return <span className="tag t-w1">Sin dato</span>;
  return valor >= META
    ? <span className="tag t-ok">✓ En meta</span>
    : <span className="tag t-bad">✗ Fuera de meta</span>;
}

export default async function IndicadoresAlmacenPage({
  searchParams,
}: {
  searchParams: Promise<{ anio?: string; meses?: string }>;
}) {
  await requirePermiso("recepcion.view");
  const sp = await searchParams;

  const anios = await aniosConRecepciones();
  if (!anios.length) {
    return (
      <div className="card"><div className="card-body">
        <div className="empty">
          Sin recepciones técnicas registradas todavía. Se llena solo a medida que se registran en{" "}
          <a href="/osteosintesis/recepcion">Recepción Técnica</a>.
        </div>
      </div></div>
    );
  }
  const anio = sp.anio && anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios[anios.length - 1]!;

  const base = await resumenAceptacion(anio);
  const disponibles = base.conDato;

  const pedidos = (sp.meses ?? "").split(",").map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && disponibles.includes(n));
  const seleccion = [...new Set(pedidos)].sort((a, b) => a - b);
  const acota = seleccion.length ? seleccion : undefined;

  const r = acota ? await resumenAceptacion(anio, acota) : base;

  const periodoLabel = seleccion.length
    ? seleccion.map((m) => MES_ABBR[m]).join(" · ")
    : disponibles.length
      ? `${MES_CORTO[disponibles[0]!]}–${MES_CORTO[disponibles[disponibles.length - 1]!]} ${anio}`
      : `${anio}`;

  const hrefToggle = (m: number) => {
    const set = new Set(seleccion);
    if (set.has(m)) set.delete(m); else set.add(m);
    const arr = [...set].sort((a, b) => a - b);
    const qs = new URLSearchParams({ anio: String(anio) });
    if (arr.length) qs.set("meses", arr.join(","));
    return `/indicadores/almacen?${qs.toString()}`;
  };

  const hastaMes = base.conDato.length ? Math.max(...base.conDato) : 0;
  const visibles = base.meses.slice(0, hastaMes);

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-head">
          Indicadores de Almacén · {periodoLabel}
          <span className="hact">FOR-ALM-005 / FOR-ALM-008 · responsable: Almacén / Calidad</span>
        </div>
        <div className="card-body">
          <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            <div className="flag" style={{ fontWeight: 700 }}>Indicador y fórmula</div>
            % de cumplimiento de especificaciones técnicas ={" "}
            <i>N.° evaluaciones aceptadas / N.° evaluaciones realizadas</i> · meta ≥ {META} %
            <div className="flag" style={{ marginTop: 4 }}>
              &quot;Aceptada&quot; = resultado <b>Aceptado</b> o <b>Aceptado con observaciones</b> (el procedimiento
              trata ambos como lote conforme). No cuentan como aceptadas <b>Cuarentena</b> ni <b>Rechazado</b>.
            </div>
          </div>

          <div className="subhead" style={{ margin: "12px 0 6px" }}>Período</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {MES_ABBR.slice(1).map((lbl, i) => {
              const m = i + 1;
              if (!disponibles.includes(m)) {
                return <span key={m} className="mes-chip off" aria-disabled title="Sin recepciones ese mes">{lbl}</span>;
              }
              return <a key={m} href={hrefToggle(m)} className={`mes-chip${seleccion.includes(m) ? " on" : ""}`}>{lbl}</a>;
            })}
            {seleccion.length ? (
              <a href={`/indicadores/almacen?anio=${anio}`} className="btn" style={{ marginLeft: 6 }}>Todos los meses</a>
            ) : null}
          </div>
        </div>
      </div>

      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi kc k-ingreso">
          <div className="klabel">✅ Evaluaciones aceptadas</div>
          <div className="kval num">{formatNumero(r.aceptadas)}</div>
          <div className="ksub flag">de {formatNumero(r.evaluadas)} evaluaciones realizadas</div>
        </div>
        <div className="kpi kc">
          <div className="klabel">📈 % de cumplimiento</div>
          <div className="kval num">{r.pct != null ? pct1(r.pct) : "—"}</div>
          <div className="ksub flag">meta ≥ {META} %</div>
        </div>
        <div className="kpi kc k-egreso">
          <div className="klabel">⚠️ No conformes</div>
          <div className="kval num">{formatNumero(r.evaluadas - r.aceptadas)}</div>
          <div className="ksub flag">cuarentena + rechazadas</div>
        </div>
        <div className="kpi kc k-w">
          <div className="klabel">📅 Meses en meta</div>
          <div className="kval num">
            {formatNumero(base.meses.filter((m) => m.pct != null && m.pct >= META).length)} / {formatNumero(base.conDato.length)}
          </div>
          <div className="ksub flag">meses con evaluaciones en el período</div>
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 12, alignItems: "stretch" }}>
        <div className="card">
          <div className="chart-head">
            Cumplimiento del período
            <span className="hact">{periodoLabel}</span>
          </div>
          <div className="card-body" style={{ display: "grid", placeItems: "center" }}>
            {r.pct != null ? (
              <>
                <Medidor valor={r.pct} color={r.pct >= META ? "var(--ok)" : "var(--bad)"} size={230} />
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
                  {tag(r.pct)}
                  <span className="flag">
                    {r.pct >= META
                      ? `${(r.pct - META).toFixed(1).replace(".", ",")} pp sobre la meta`
                      : `${(META - r.pct).toFixed(1).replace(".", ",")} pp bajo la meta`}
                  </span>
                </div>
              </>
            ) : <div className="empty">Sin evaluaciones en el período.</div>}
          </div>
        </div>

        <div className="card">
          <div className="chart-head">
            Cumplimiento mensual
            <span className="hact">% de aceptadas vs. meta {META} %</span>
          </div>
          <div className="card-body">
            {hastaMes > 0 ? (
              <LineasMensuales
                categorias={MES_CORTO.slice(1, hastaMes + 1)}
                unidad="% de cumplimiento"
                desdeCero={false}
                formatoY={(v) => `${v.toFixed(0)} %`}
                formatoPunto={(v) => pct1(v)}
                series={[
                  { label: "% de cumplimiento", color: "var(--brand)", data: visibles.map((m) => m.pct) },
                  { label: `Meta ${META} %`, color: "var(--bad)", dash: true, data: visibles.map((m) => (m.pct == null ? null : META)) },
                ]}
              />
            ) : <div className="empty">Sin evaluaciones registradas.</div>}
          </div>
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 12, alignItems: "start" }}>
        <div className="card">
          <div className="chart-head">Por tipo de recepción <span className="hact">{periodoLabel}</span></div>
          <div className="tbl-wrap">
            <table className="tabla-fit">
              <thead><tr><th>Tipo</th><th className="r">Aceptadas</th><th className="r">Evaluadas</th><th className="r">% Cumplimiento</th><th>Estado</th></tr></thead>
              <tbody>
                {r.porTipo.map((t) => (
                  <tr key={t.tipo}>
                    <td style={{ fontWeight: 600 }}>{t.label}</td>
                    <td className="r num">{formatNumero(t.aceptadas)}</td>
                    <td className="r num flag">{formatNumero(t.evaluadas)}</td>
                    <td className="r num" style={{ fontWeight: 700, color: t.pct != null && t.pct >= META ? "var(--ok)" : t.pct != null ? "var(--bad)" : undefined }}>
                      {t.pct != null ? pct1(t.pct) : "—"}
                    </td>
                    <td>{tag(t.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="chart-head">Por resultado <span className="hact">{periodoLabel}</span></div>
          <div className="tbl-wrap">
            <table className="tabla-fit">
              <thead><tr><th>Resultado</th><th className="r">Recepciones</th><th className="r">% del período</th></tr></thead>
              <tbody>
                {r.porResultado.length === 0 ? (
                  <tr><td colSpan={3}><div className="empty">Sin evaluaciones en el período.</div></td></tr>
                ) : r.porResultado.map((x) => (
                  <tr key={x.resultado}>
                    <td><span className={`tag ${claseOpcion(x.resultado)}`}>{x.resultado}</span></td>
                    <td className="r num" style={{ fontWeight: 700 }}>{formatNumero(x.n)}</td>
                    <td className="r num flag">{r.evaluadas > 0 ? pct1((x.n / r.evaluadas) * 100) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="chart-head">
          Detalle mensual
          <span className="hact">{anio}</span>
        </div>
        <div className="tbl-wrap">
          <table className="tabla-fit">
            <thead>
              <tr>
                <th>Mes</th><th className="r">Aceptadas</th><th className="r">Evaluadas</th>
                <th className="r">No conformes</th><th className="r">% de cumplimiento</th>
                <th>Contra la meta</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {base.meses.filter((m) => m.pct != null).map((m) => (
                <tr key={m.mes}>
                  <td style={{ fontWeight: 600 }}>{MES_LARGO[m.mes]}</td>
                  <td className="r num">{formatNumero(m.aceptadas)}</td>
                  <td className="r num flag">{formatNumero(m.evaluadas)}</td>
                  <td className="r num" style={{ color: m.evaluadas - m.aceptadas > 0 ? "var(--w1)" : undefined }}>
                    {formatNumero(m.evaluadas - m.aceptadas)}
                  </td>
                  <td className="r num" style={{ fontWeight: 700, color: m.pct! >= META ? "var(--ok)" : "var(--bad)" }}>
                    {pct1(m.pct!)}
                  </td>
                  <td style={{ minWidth: 150 }} data-orden={m.pct!}>
                    <div className="rank-bar">
                      <div style={{ width: `${Math.min(100, m.pct!)}%`, background: m.pct! >= META ? "var(--ok)" : "var(--bad)" }} />
                    </div>
                  </td>
                  <td>{tag(m.pct)}</td>
                </tr>
              ))}
              {base.conDato.length === 0 ? (
                <tr><td colSpan={7}><div className="empty">Sin evaluaciones registradas en {anio}.</div></td></tr>
              ) : (
                <tr className="fila-total">
                  <td style={{ fontWeight: 800 }}>Total del año</td>
                  <td className="r num" style={{ fontWeight: 800 }}>{formatNumero(base.aceptadas)}</td>
                  <td className="r num" style={{ fontWeight: 800 }}>{formatNumero(base.evaluadas)}</td>
                  <td className="r num" style={{ fontWeight: 800 }}>{formatNumero(base.evaluadas - base.aceptadas)}</td>
                  <td className="r num" style={{ fontWeight: 800 }}>{base.pct != null ? pct1(base.pct) : "—"}</td>
                  <td />
                  <td>{tag(base.pct)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ padding: "8px 14px", fontSize: 12, color: "var(--muted)" }}>
          Cada fila de este indicador es una recepción registrada en <a href="/osteosintesis/recepcion">Recepción Técnica</a>;
          no requiere carga aparte.
        </div>
      </div>
    </>
  );
}
