// ==========================================================
// Indicadores de Compras (FOR-GC-011) — los dos indicadores de calidad que
// lleva el Líder de Compras:
//
//   1. % de órdenes de compra recibidas completas, contra la meta de 85 %.
//   2. Evaluación de proveedores sobre 5,0 puntos en seis criterios.
//
// No salen de SIESA: se cargan desde el Excel del formato. Por eso la pantalla
// muestra siempre de qué meses hay dato y cuáles siguen sin diligenciar — un
// indicador de calidad a medio llenar que se ve completo es peor que uno vacío.
//
// El % del periodo es ponderado (Σ completas / Σ totales), no el promedio de
// los porcentajes mensuales: un mes de 40 órdenes no puede pesar lo mismo que
// uno de 540. El de proveedores sí es promedio simple, porque ahí cada
// proveedor cuenta una vez.
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { formatNumero, formatPorcentaje } from "@/lib/format";
import { Medidor } from "../../_components/charts/Medidor";
import { LineasMensuales } from "../../_components/charts/LineasMensuales";
import { Buscador } from "../../_components/Buscador";
import {
  resumenIndicador, resumenEvaluacion, aniosConIndicador, mesesConEvaluacion,
  resumenProxyEstado,
  META_ORDENES, META_PROVEEDOR, PUNTAJE_MAXIMO, MES_CORTO, MES_LARGO,
} from "@/lib/negocio/indicador-compras";

const MES_ABBR = ["", "ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

const pct1 = (v: number) => `${v.toFixed(1).replace(".", ",")} %`;
const pts = (v: number) => v.toFixed(2).replace(".", ",");

/** Insensible a mayúsculas y tildes, para que "sanpedro" encuentre "SAMPEDRO". */
const normaliza = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Semáforo de un porcentaje contra su meta. */
function tag(valor: number | null, meta: number) {
  if (valor == null) return <span className="tag t-w1">Sin dato</span>;
  return valor >= meta
    ? <span className="tag t-ok">✓ En meta</span>
    : <span className="tag t-bad">✗ Fuera de meta</span>;
}

export default async function IndicadoresComprasPage({
  searchParams,
}: {
  searchParams: Promise<{ anio?: string; meses?: string; prov?: string }>;
}) {
  await requirePermiso("cxp.view");
  const sp = await searchParams;

  const anios = await aniosConIndicador();
  if (!anios.length) {
    return (
      <div className="card"><div className="card-body">
        <div className="empty">
          Sin indicadores de compras cargados. Súbelos desde <a href="/cargar">Cargar archivos</a>{" "}
          (grupo Compras) o corre <code>npm run db:ind-compras</code>.
        </div>
      </div></div>
    );
  }
  const anio = sp.anio && anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios[anios.length - 1]!;

  // Meses seleccionables: los que tienen dato en cualquiera de los dos
  // indicadores, para que el filtro no esconda uno por culpa del otro.
  const [base, mesesEval] = await Promise.all([resumenIndicador(anio), mesesConEvaluacion(anio)]);
  const disponibles = [...new Set([...base.conDato, ...mesesEval])].sort((a, b) => a - b);

  const pedidos = (sp.meses ?? "").split(",").map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && disponibles.includes(n));
  const seleccion = [...new Set(pedidos)].sort((a, b) => a - b);
  const acota = seleccion.length ? seleccion : undefined;

  const [ind, ev, px] = await Promise.all([
    resumenIndicador(anio, acota),
    resumenEvaluacion(anio, acota),
    resumenProxyEstado(anio, acota),
  ]);

  // El proxy se corta en su último mes con órdenes, igual que el manual.
  const pxHasta = px.conDato.length ? Math.max(...px.conDato) : 0;
  const pxVisibles = px.meses.slice(0, pxHasta);

  const periodoLabel = seleccion.length
    ? seleccion.map((m) => MES_ABBR[m]).join(" · ")
    : `${MES_CORTO[disponibles[0] ?? 1]}–${MES_CORTO[disponibles[disponibles.length - 1] ?? 12]} ${anio}`;

  // Toggle de mes, igual que en los indicadores financieros.
  const hrefToggle = (m: number) => {
    const set = new Set(seleccion);
    if (set.has(m)) set.delete(m); else set.add(m);
    const arr = [...set].sort((a, b) => a - b);
    const qs = new URLSearchParams({ anio: String(anio) });
    if (arr.length) qs.set("meses", arr.join(","));
    return `/indicadores/compras?${qs.toString()}`;
  };

  // La gráfica se corta en el último mes con dato: pintar los que aún no han
  // pasado deja media línea en cero y se lee como una caída.
  const hastaMes = ind.conDato.length ? Math.max(...ind.conDato) : 0;
  const visibles = ind.meses.slice(0, hastaMes);
  const sinDiligenciar = 12 - base.conDato.length;

  const maxCriterio = Math.max(1, ...ev.porCriterio.map((c) => c.maximo));

  // Filtro de proveedor: solo acota la tabla de calificación de abajo. Los
  // KPI y las gráficas de arriba (promedio del período, criterios) siguen
  // hablando de TODOS los proveedores evaluados, no de la búsqueda — si no,
  // buscar "ALLOGRAFT" haría parecer que el período entero saca 100 %.
  const q = (sp.prov ?? "").trim();
  const filasProveedor = q
    ? ev.filas.filter((f) => normaliza(f.proveedor).includes(normaliza(q)))
    : ev.filas;
  const qsBase = { anio: String(anio), ...(seleccion.length ? { meses: seleccion.join(",") } : {}) };

  return (
    <>
      {/* Ficha del formato: qué mide, cómo y contra qué meta. */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-head">
          Indicadores de Compras · {periodoLabel}
          <span className="hact">FOR-GC-011 v4 · responsable: Líder de Compras</span>
        </div>
        <div className="card-body">
          <div className="grid two" style={{ gap: 16 }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
              <div className="flag" style={{ fontWeight: 700 }}>Objetivo específico</div>
              Evaluar el cumplimiento de entrega de las órdenes de compra de dispositivos médicos
              mediante el informe mensual de compra.
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
              <div className="flag" style={{ fontWeight: 700 }}>Indicador y fórmula</div>
              % de órdenes de compra recibidas completas ={" "}
              <i>N.° órdenes recibidas completas / N.° órdenes totales</i> · meta &gt; {META_ORDENES} %
            </div>
          </div>

          <div className="subhead" style={{ margin: "12px 0 6px" }}>Período</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {MES_ABBR.slice(1).map((lbl, i) => {
              const m = i + 1;
              if (!disponibles.includes(m)) {
                return <span key={m} className="mes-chip off" aria-disabled title="Sin dato cargado">{lbl}</span>;
              }
              return (
                <a key={m} href={hrefToggle(m)} className={`mes-chip${seleccion.includes(m) ? " on" : ""}`}>{lbl}</a>
              );
            })}
            {seleccion.length ? (
              <a href={`/indicadores/compras?anio=${anio}`} className="btn" style={{ marginLeft: 6 }}>Todos los meses</a>
            ) : null}
          </div>
          {sinDiligenciar > 0 && (
            <p className="flag" style={{ marginTop: 8 }}>
              {sinDiligenciar} mes(es) del año todavía sin diligenciar en el formato. No cuentan como
              cero: quedan fuera del cálculo hasta que se registren.
            </p>
          )}
        </div>
      </div>

      {/* ---------- 1. Órdenes recibidas completas ---------- */}
      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi kc k-ingreso">
          <div className="klabel">✅ Órdenes recibidas completas</div>
          <div className="kval num">{formatNumero(ind.completas)}</div>
          <div className="ksub flag">de {formatNumero(ind.totales)} órdenes recibidas</div>
        </div>
        <div className="kpi kc">
          <div className="klabel">📈 % de cumplimiento</div>
          <div className="kval num">{ind.pct != null ? pct1(ind.pct) : "—"}</div>
          <div className="ksub flag">meta &gt; {META_ORDENES} %</div>
        </div>
        <div className="kpi kc k-w">
          <div className="klabel">📅 Meses en meta</div>
          <div className="kval num">{formatNumero(ind.mesesEnMeta)} / {formatNumero(ind.conDato.length)}</div>
          <div className="ksub flag">meses con dato en el período</div>
        </div>
        <div className="kpi kc k-egreso">
          <div className="klabel">⚠️ Órdenes incompletas</div>
          <div className="kval num">{formatNumero(ind.totales - ind.completas)}</div>
          <div className="ksub flag">
            {ind.peor ? `peor mes: ${MES_LARGO[ind.peor.mes]} (${pct1(ind.peor.pct!)})` : "—"}
          </div>
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 12, alignItems: "stretch" }}>
        <div className="card">
          <div className="chart-head">
            Cumplimiento del período
            <span className="hact">{periodoLabel}</span>
          </div>
          <div className="card-body" style={{ display: "grid", placeItems: "center" }}>
            {ind.pct != null ? (
              <>
                <Medidor valor={ind.pct} color={ind.pct >= META_ORDENES ? "var(--ok)" : "var(--bad)"} size={230} />
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
                  {tag(ind.pct, META_ORDENES)}
                  <span className="flag">
                    {ind.pct >= META_ORDENES
                      ? `${(ind.pct - META_ORDENES).toFixed(1).replace(".", ",")} pp sobre la meta`
                      : `${(META_ORDENES - ind.pct).toFixed(1).replace(".", ",")} pp bajo la meta`}
                  </span>
                </div>
              </>
            ) : <div className="empty">Sin meses diligenciados en el período.</div>}
          </div>
        </div>

        <div className="card">
          <div className="chart-head">
            Cumplimiento mensual
            <span className="hact">% de órdenes completas vs. meta {META_ORDENES} %</span>
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
                  {
                    label: "% de cumplimiento", color: "var(--brand)",
                    data: visibles.map((m) => m.pct),
                  },
                  {
                    label: `Meta ${META_ORDENES} %`, color: "var(--bad)", dash: true,
                    data: visibles.map((m) => (m.pct == null ? null : META_ORDENES)),
                  },
                ]}
              />
            ) : <div className="empty">Sin meses diligenciados.</div>}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-head">
          Detalle mensual
          <span className="hact">datos del formato, tal como fueron registrados · clic para ordenar</span>
        </div>
        <div className="tbl-wrap">
          <table className="tabla-fit">
            <thead>
              <tr>
                <th>Mes</th>
                <th className="r">Órdenes recibidas completas</th>
                <th className="r">Total de órdenes recibidas</th>
                <th className="r">Incompletas</th>
                <th className="r">% de cumplimiento</th>
                <th>Contra la meta</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {ind.meses.filter((m) => m.pct != null).map((m) => (
                <tr key={m.mes}>
                  <td style={{ fontWeight: 600 }}>{MES_LARGO[m.mes]}</td>
                  <td className="r num">{formatNumero(m.completas)}</td>
                  <td className="r num flag">{formatNumero(m.totales)}</td>
                  <td className="r num" style={{ color: m.totales - m.completas > 0 ? "var(--w1)" : undefined }}>
                    {formatNumero(m.totales - m.completas)}
                  </td>
                  <td className="r num" style={{ fontWeight: 700, color: m.cumple ? "var(--ok)" : "var(--bad)" }}>
                    {pct1(m.pct!)}
                  </td>
                  <td style={{ minWidth: 150 }} data-orden={m.pct!}>
                    <div className="rank-bar">
                      <div style={{ width: `${Math.min(100, m.pct!)}%`, background: m.cumple ? "var(--ok)" : "var(--bad)" }} />
                    </div>
                  </td>
                  <td>{tag(m.pct, META_ORDENES)}</td>
                </tr>
              ))}
              {ind.conDato.length === 0 ? (
                <tr><td colSpan={7}><div className="empty">Sin meses diligenciados en el período.</div></td></tr>
              ) : (
                <tr className="fila-total">
                  <td style={{ fontWeight: 800 }}>Total del período</td>
                  <td className="r num" style={{ fontWeight: 800 }}>{formatNumero(ind.completas)}</td>
                  <td className="r num" style={{ fontWeight: 800 }}>{formatNumero(ind.totales)}</td>
                  <td className="r num" style={{ fontWeight: 800 }}>{formatNumero(ind.totales - ind.completas)}</td>
                  <td className="r num" style={{ fontWeight: 800 }}>{ind.pct != null ? pct1(ind.pct) : "—"}</td>
                  <td />
                  <td>{tag(ind.pct, META_ORDENES)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ padding: "8px 14px", fontSize: 12, color: "var(--muted)" }}>
          El % del período es <b>Σ completas / Σ totales</b>, no el promedio de los porcentajes
          mensuales: un mes de 40 órdenes no puede pesar lo mismo que uno de 540.
        </div>
      </div>

      {/* ---------- 1-bis. Proxy automático desde el estado de las órdenes ---------- */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-head">
          Proxy automático · estado de las órdenes (SIESA)
          <span className="hact">
            {px.pct != null ? `${pct1(px.pct)} vs. ${ind.pct != null ? pct1(ind.pct) : "—"} del formato` : "sin órdenes en el período"}
          </span>
        </div>
        <div className="card-body" style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--muted)" }}>
          Calculado desde las órdenes de compra: una orden cuenta como <b>completa</b> cuando todos sus
          renglones están en estado <b>“Cumplido”</b>. Es una lectura automática, <b>no reemplaza el
          dato oficial</b> del formato y no coincide con él por diseño: refleja el estado <b>actual</b>
          {" "}de la orden (los meses pasados “mejoran” al cerrarse despachos), el denominador incluye
          órdenes que aún no han llegado (<b>Aprobado</b>, <b>En elaboración</b>) y el mes es el de la
          <b> fecha de orden</b>, no el de recepción. El desglose por estado está abajo para que nada
          quede escondido.
        </div>
      </div>

      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi kc k-ingreso">
          <div className="klabel">✅ Órdenes completas (proxy)</div>
          <div className="kval num">{formatNumero(px.completas)}</div>
          <div className="ksub flag">de {formatNumero(px.totales)} órdenes del período</div>
        </div>
        <div className="kpi kc">
          <div className="klabel">📈 % de cumplimiento (proxy)</div>
          <div className="kval num">{px.pct != null ? pct1(px.pct) : "—"}</div>
          <div className="ksub flag">meta &gt; {META_ORDENES} %</div>
        </div>
        <div className="kpi kc k-egreso">
          <div className="klabel">⚠️ Órdenes no completas</div>
          <div className="kval num">{formatNumero(px.totales - px.completas)}</div>
          <div className="ksub flag">
            {px.peor ? `peor mes: ${MES_LARGO[px.peor.mes]} (${pct1(px.peor.pct!)})` : "—"}
          </div>
        </div>
        <div className="kpi kc k-w">
          <div className="klabel">🧭 Por estado de la orden</div>
          <div className="kval num" style={{ fontSize: 18 }}>
            {formatNumero(px.porEstado.parcial)} parciales
          </div>
          <div className="ksub flag">
            {formatNumero(px.porEstado.aprobado)} aprobadas · {formatNumero(px.porEstado.elaboracion)} en elaboración
          </div>
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 12, alignItems: "stretch" }}>
        <div className="card">
          <div className="chart-head">
            Cumplimiento del período (proxy)
            <span className="hact">{periodoLabel}</span>
          </div>
          <div className="card-body" style={{ display: "grid", placeItems: "center" }}>
            {px.pct != null ? (
              <>
                <Medidor valor={px.pct} color={px.pct >= META_ORDENES ? "var(--ok)" : "var(--bad)"} size={230} />
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
                  {tag(px.pct, META_ORDENES)}
                  <span className="flag">
                    {px.pct >= META_ORDENES
                      ? `${(px.pct - META_ORDENES).toFixed(1).replace(".", ",")} pp sobre la meta`
                      : `${(META_ORDENES - px.pct).toFixed(1).replace(".", ",")} pp bajo la meta`}
                  </span>
                </div>
              </>
            ) : <div className="empty">Sin órdenes en el período.</div>}
          </div>
        </div>

        <div className="card">
          <div className="chart-head">
            Cumplimiento mensual (proxy)
            <span className="hact">% de órdenes completas vs. meta {META_ORDENES} %</span>
          </div>
          <div className="card-body">
            {pxHasta > 0 ? (
              <LineasMensuales
                categorias={MES_CORTO.slice(1, pxHasta + 1)}
                unidad="% de cumplimiento"
                desdeCero={false}
                formatoY={(v) => `${v.toFixed(0)} %`}
                formatoPunto={(v) => pct1(v)}
                series={[
                  {
                    label: "% de cumplimiento", color: "var(--az-2)",
                    data: pxVisibles.map((m) => m.pct),
                  },
                  {
                    label: `Meta ${META_ORDENES} %`, color: "var(--bad)", dash: true,
                    data: pxVisibles.map((m) => (m.pct == null ? null : META_ORDENES)),
                  },
                ]}
              />
            ) : <div className="empty">Sin órdenes en el período.</div>}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-head">
          Detalle mensual (proxy)
          <span className="hact">estado actual de las órdenes en SIESA · clic para ordenar</span>
        </div>
        <div className="tbl-wrap">
          <table className="tabla-fit">
            <thead>
              <tr>
                <th>Mes</th>
                <th className="r">Órdenes completas</th>
                <th className="r">Total de órdenes</th>
                <th className="r">No completas</th>
                <th className="r">% de cumplimiento</th>
                <th>Contra la meta</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {px.meses.filter((m) => m.pct != null).map((m) => (
                <tr key={m.mes}>
                  <td style={{ fontWeight: 600 }}>{MES_LARGO[m.mes]}</td>
                  <td className="r num">{formatNumero(m.completas)}</td>
                  <td className="r num flag">{formatNumero(m.totales)}</td>
                  <td className="r num" style={{ color: m.totales - m.completas > 0 ? "var(--w1)" : undefined }}>
                    {formatNumero(m.totales - m.completas)}
                  </td>
                  <td className="r num" style={{ fontWeight: 700, color: m.cumple ? "var(--ok)" : "var(--bad)" }}>
                    {pct1(m.pct!)}
                  </td>
                  <td style={{ minWidth: 150 }} data-orden={m.pct!}>
                    <div className="rank-bar">
                      <div style={{ width: `${Math.min(100, m.pct!)}%`, background: m.cumple ? "var(--ok)" : "var(--bad)" }} />
                    </div>
                  </td>
                  <td>{tag(m.pct, META_ORDENES)}</td>
                </tr>
              ))}
              {px.conDato.length === 0 ? (
                <tr><td colSpan={7}><div className="empty">Sin órdenes en el período.</div></td></tr>
              ) : (
                <tr className="fila-total">
                  <td style={{ fontWeight: 800 }}>Total del período</td>
                  <td className="r num" style={{ fontWeight: 800 }}>{formatNumero(px.completas)}</td>
                  <td className="r num" style={{ fontWeight: 800 }}>{formatNumero(px.totales)}</td>
                  <td className="r num" style={{ fontWeight: 800 }}>{formatNumero(px.totales - px.completas)}</td>
                  <td className="r num" style={{ fontWeight: 800 }}>{px.pct != null ? pct1(px.pct) : "—"}</td>
                  <td />
                  <td>{tag(px.pct, META_ORDENES)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ padding: "8px 14px", fontSize: 12, color: "var(--muted)" }}>
          “No completas” junta las órdenes <b>parciales</b> (algo llegó, falta el resto) con las que
          aún no han entrado a recepción (<b>Aprobado</b>, <b>En elaboración</b>). Para el cumplimiento
          real de entrega, el dato oficial es el del <b>formato</b> de arriba.
        </div>
      </div>

      {/* ---------- 2. Evaluación de proveedores ---------- */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-head">
          Evaluación de Proveedores
          <span className="hact">sobre {PUNTAJE_MAXIMO},0 puntos en seis criterios</span>
        </div>
        <div className="card-body" style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--muted)" }}>
          Cada proveedor se califica en calidad del producto, tiempos de entrega, cumplimiento en
          cantidad, precio, atención post-venta y seguimiento. El <b>% de calificación</b> se calcula
          como total ÷ {PUNTAJE_MAXIMO},0 — no se copia del Excel, porque el archivo trae varias
          celdas con el porcentaje mal digitado; el resultado de la carga las reporta una por una
          para poder corregirlas en la fuente.
        </div>
      </div>

      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi kc k-ingreso">
          <div className="klabel">⭐ Calificación promedio</div>
          <div className="kval num">{ev.promedio != null ? pct1(ev.promedio) : "—"}</div>
          <div className="ksub flag">
            {ev.promedio != null ? `${pts((ev.promedio / 100) * PUNTAJE_MAXIMO)} de ${PUNTAJE_MAXIMO},0 puntos` : "sin evaluaciones"}
          </div>
        </div>
        <div className="kpi kc">
          <div className="klabel">🏭 Proveedores evaluados</div>
          <div className="kval num">{formatNumero(ev.evaluados)}</div>
          <div className="ksub flag">de {formatNumero(ev.activos)} activos en el catálogo</div>
        </div>
        <div className="kpi kc k-w">
          <div className="klabel">✅ En {META_PROVEEDOR} % o más</div>
          <div className="kval num">{formatNumero(ev.enMeta)}</div>
          <div className="ksub flag">
            {ev.evaluados > 0 ? `${((ev.enMeta / ev.evaluados) * 100).toFixed(0)} % de los evaluados` : "—"}
          </div>
        </div>
        <div className="kpi kc k-egreso">
          <div className="klabel">🔻 Bajo {META_PROVEEDOR} %</div>
          <div className="kval num">{formatNumero(ev.evaluados - ev.enMeta)}</div>
          <div className="ksub flag">proveedores a revisar</div>
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 12, alignItems: "stretch" }}>
        <div className="card">
          <div className="chart-head">
            Calificación promedio por mes
            <span className="hact">promedio del % entre los proveedores evaluados cada mes</span>
          </div>
          <div className="card-body">
            {ev.porMes.length ? (
              <LineasMensuales
                categorias={ev.porMes.map((m) => MES_CORTO[m.mes]!)}
                unidad="% de calificación"
                desdeCero={false}
                formatoY={(v) => `${v.toFixed(0)} %`}
                formatoPunto={(v) => pct1(v)}
                series={[
                  { label: "% promedio", color: "var(--az-2)", data: ev.porMes.map((m) => m.promedio) },
                  { label: `Referencia ${META_PROVEEDOR} %`, color: "var(--w1)", dash: true, data: ev.porMes.map(() => META_PROVEEDOR) },
                ]}
              />
            ) : <div className="empty">Sin evaluaciones en el período.</div>}
          </div>
        </div>

        <div className="card">
          <div className="chart-head">
            Dónde se pierde puntaje
            <span className="hact">promedio por criterio sobre el máximo observado</span>
          </div>
          <div className="tbl-wrap">
            <table className="tabla-fit">
              <thead>
                <tr><th>Criterio</th><th className="r">Peso</th><th className="r">Promedio</th><th>Sobre el máximo</th></tr>
              </thead>
              <tbody>
                {ev.porCriterio.map((c) => {
                  const frac = c.maximo > 0 ? (c.promedio / c.maximo) * 100 : 0;
                  return (
                    <tr key={c.campo}>
                      <td style={{ fontWeight: 600 }}>{c.label}</td>
                      <td className="r num flag">{c.peso} %</td>
                      <td className="r num" style={{ fontWeight: 700 }} data-orden={c.promedio}>
                        {pts(c.promedio)} / {pts(c.maximo)}
                      </td>
                      <td style={{ minWidth: 130 }} data-orden={frac}>
                        <div className="rank-bar">
                          <div style={{ width: `${Math.max(2, frac)}%`, background: frac >= 95 ? "var(--ok)" : frac >= 85 ? "var(--w1)" : "var(--bad)" }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {ev.porCriterio.every((c) => c.maximo === 0) ? (
                  <tr><td colSpan={4}><div className="empty">Sin evaluaciones en el período.</div></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="card-body" style={{ padding: "8px 14px", fontSize: 12, color: "var(--muted)" }}>
            El formato no publica el puntaje máximo de cada criterio, así que la barra se mide contra
            el <b>máximo que algún proveedor obtuvo</b> en el período. Es una referencia entre pares,
            no un porcentaje sobre una escala oficial.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="chart-head">
          Calificación por Proveedor
          <span className="hact">
            {q ? `${formatNumero(filasProveedor.length)} de ${formatNumero(ev.filas.length)}` : formatNumero(ev.filas.length)} proveedores
            · clic en las columnas para ordenar
          </span>
        </div>
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <Buscador
            action="/indicadores/compras"
            q={q || undefined}
            placeholder="Buscar proveedor…"
            extra={qsBase}
            limpiarHref={`/indicadores/compras?${new URLSearchParams(qsBase).toString()}`}
          />
        </div>
        <div className="tbl-wrap">
          <table className="tabla-fit">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th className="r">Meses</th>
                {ev.porCriterio.map((c) => (
                  <th key={c.campo} className="r" title={`${c.label} · peso ${c.peso} %`}>{c.label}</th>
                ))}
                <th className="r">Puntaje</th>
                <th className="r">% Calificación</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filasProveedor.map((f) => (
                <tr key={f.proveedor}>
                  <td style={{ fontWeight: 600 }} title={f.enCatalogo ? undefined : "Evaluado, pero no aparece en la hoja PROVEEDORES ACTIVOS"}>
                    {f.proveedor}{f.enCatalogo ? "" : " *"}
                  </td>
                  <td className="r num flag">{f.evaluaciones}</td>
                  {ev.porCriterio.map((c) => (
                    <td key={c.campo} className="r num flag" data-orden={f.criterios[c.campo] ?? 0}>
                      {pts(f.criterios[c.campo] ?? 0)}
                    </td>
                  ))}
                  <td className="r num" style={{ fontWeight: 700 }} data-orden={f.total}>
                    {pts(f.total)} / {PUNTAJE_MAXIMO},0
                  </td>
                  <td className="r num" style={{ fontWeight: 700, color: f.pct >= META_PROVEEDOR ? "var(--ok)" : "var(--w1)" }}>
                    {pct1(f.pct)}
                  </td>
                  <td>
                    {f.pct >= META_PROVEEDOR
                      ? <span className="tag t-ok">✓ Satisfactorio</span>
                      : <span className="tag t-w1">Por revisar</span>}
                  </td>
                </tr>
              ))}
              {ev.filas.length === 0 ? (
                <tr><td colSpan={ev.porCriterio.length + 5}><div className="empty">Sin evaluaciones en el período.</div></td></tr>
              ) : filasProveedor.length === 0 ? (
                <tr><td colSpan={ev.porCriterio.length + 5}><div className="empty">Ningún proveedor coincide con “{q}”.</div></td></tr>
              ) : !q ? (
                // El promedio es del PERÍODO completo: con una búsqueda activa no
                // corresponde a lo que se ve en la tabla, así que se oculta.
                <tr className="fila-total">
                  <td style={{ fontWeight: 800 }}>Promedio</td>
                  <td />
                  {ev.porCriterio.map((c) => (
                    <td key={c.campo} className="r num" style={{ fontWeight: 800 }}>{pts(c.promedio)}</td>
                  ))}
                  <td className="r num" style={{ fontWeight: 800 }}>
                    {ev.promedio != null ? pts((ev.promedio / 100) * PUNTAJE_MAXIMO) : "—"}
                  </td>
                  <td className="r num" style={{ fontWeight: 800 }}>{ev.promedio != null ? pct1(ev.promedio) : "—"}</td>
                  <td />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ padding: "8px 14px", fontSize: 12, color: "var(--muted)" }}>
          Un proveedor evaluado en varios meses aparece con el <b>promedio de sus meses</b>: la tabla
          habla del proveedor en el período, no de una evaluación suelta.
          {ev.fueraDeCatalogo.length > 0 && (
            <> Los marcados con <b>*</b> ({ev.fueraDeCatalogo.length}) fueron evaluados pero no están
              en la hoja PROVEEDORES ACTIVOS: {ev.fueraDeCatalogo.join(", ")}.</>
          )}
        </div>
      </div>
    </>
  );
}
