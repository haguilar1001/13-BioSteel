// ==========================================================
// Nómina · Capacitaciones — el consolidado del plan de formación de Gestión
// Humana y los dos indicadores del proceso.
//
// La lectura va de arriba abajo: cuánto se formó y con qué resultado (KPI),
// cómo se movió mes a mes, si el plan se ejecutó (indicador A) y si la gente
// efectivamente aprendió (indicador B), y por último dónde flojea — por
// capacitación, por colaborador y fila por fila.
//
// Los rankings van de MENOR a mayor promedio a propósito: lo que hay que
// mirar es la capacitación que no quedó, no la que salió perfecta.
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { formatNumero } from "@/lib/format";
import { FiltroAuto } from "../../_components/FiltroAuto";
import { Donut } from "../../_components/charts/Donut";
import { LineasMensuales } from "../../_components/charts/LineasMensuales";
import { TopRanking } from "../../_components/charts/TopRanking";
import {
  aniosConCapacitaciones, registros, resumen, porMes, porCapacitacion,
  porColaborador, distribucion, ejecucion, nivelDe, nivelMejora, detalleCapacitaciones,
  META_EJECUCION, META_EFICACIA, MES_CORTO, MES_LARGO,
} from "@/lib/negocio/capacitaciones";

/** 82,4 % — un decimal y coma decimal, como el resto de la app. */
const pct = (v: number) => `${v.toFixed(1).replace(".", ",")} %`;
const pts = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1).replace(".", ",")}`;

const COLOR_NIVEL: Record<string, string> = {
  excelente: "var(--ok, #2A9D6B)",
  bueno: "var(--brand, #1E5A96)",
  aceptable: "var(--w1, #E0A400)",
  critico: "var(--bad, #D64545)",
};

interface Params { anio?: string; mes?: string }

export default async function CapacitacionesPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requirePermiso("capacitaciones.view");
  const sp = await searchParams;

  const anios = await aniosConCapacitaciones();
  if (!anios.length) {
    return (
      <div className="card"><div className="card-body">
        <div className="empty">
          Sin capacitaciones cargadas. Sube el <b>Consolidado de Capacitaciones</b> desde <a href="/cargar">Cargar archivos</a>.
        </div>
      </div></div>
    );
  }

  const anio = sp.anio && anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios[anios.length - 1]!;
  const todos = await registros(anio);
  const mesesConDatos = [...new Set(todos.map((r) => r.mes))].sort((a, b) => a - b);
  const mes = sp.mes && mesesConDatos.includes(Number(sp.mes)) ? Number(sp.mes) : undefined;

  // El filtro de mes recorta todo menos la evolución mensual: una línea de un
  // solo punto no es una tendencia.
  const rs = mes ? todos.filter((r) => r.mes === mes) : todos;
  const kpi = resumen(rs);
  const meses = porMes(todos);
  const caps = porCapacitacion(rs);
  const colabs = porColaborador(rs);
  const dist = distribucion(rs);
  const filasEjecucion = await ejecucion(anio, todos);

  // Cada capacitación con su detalle (cronograma) y los resultados de sus participantes.
  const detalleCaps = await detalleCapacitaciones(anio, rs, mes);

  const etiqueta = mes ? `${MES_LARGO[mes]} ${anio}` : String(anio);
  const primero = mesesConDatos[0];
  const ultimo = mesesConDatos[mesesConDatos.length - 1];
  const rango = !mes && primero && ultimo && primero !== ultimo
    ? ` · ${MES_LARGO[primero]}–${MES_LARGO[ultimo]}`
    : "";

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingBottom: 12 }}>
          <div style={{ marginBottom: 10 }}>
            <div className="eyebrow" style={{ fontSize: 15 }}>Indicador de Capacitaciones · {etiqueta}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              Evaluaciones pre y post capacitación · {formatNumero(kpi.registros)} registro(s){rango}
            </div>
          </div>
          <FiltroAuto className="toolbar">
            <label className="flag" style={{ alignSelf: "center" }}>Año:</label>
            <select name="anio" defaultValue={anio} className="select">
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <label className="flag" style={{ alignSelf: "center" }}>Mes:</label>
            <select name="mes" defaultValue={mes ?? ""} className="select">
              <option value="">Todos</option>
              {mesesConDatos.map((m) => <option key={m} value={m}>{MES_LARGO[m]}</option>)}
            </select>
          </FiltroAuto>
        </div>
      </div>

      {/* Los cuatro números que resumen el periodo. */}
      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi kc k-ingreso">
          <div className="klabel">🎓 Promedio final</div>
          <div className="kval num">{pct(kpi.promedioFinal)}</div>
          <div className="ksub" style={{ color: "var(--muted)" }}>{nivelDe(kpi.promedioFinal).label}</div>
        </div>
        <div className="kpi kc">
          <div className="klabel">📚 Capacitaciones</div>
          <div className="kval num">{formatNumero(kpi.capacitaciones)}</div>
          <div className="ksub" style={{ color: "var(--muted)" }}>{formatNumero(kpi.registros)} asistencias</div>
        </div>
        <div className="kpi kc k-w">
          <div className="klabel">🧑‍🤝‍🧑 Colaboradores</div>
          <div className="kval num">{formatNumero(kpi.colaboradores)}</div>
          <div className="ksub" style={{ color: "var(--muted)" }}>
            {kpi.colaboradores > 0
              ? `${(kpi.registros / kpi.colaboradores).toFixed(1).replace(".", ",")} capacitaciones c/u`
              : "—"}
          </div>
        </div>
        <div className="kpi kc k-ingreso">
          <div className="klabel">📈 Mejora pre → post</div>
          <div className="kval num">{pts(kpi.mejora)} pts</div>
          <div className="ksub" style={{ color: "var(--muted)" }}>{pct(kpi.promedioPre)} → {pct(kpi.promedioPost)}</div>
        </div>
      </div>

      <div className="grid two" style={{ marginBottom: 12, alignItems: "stretch" }}>
        {/* Evolución mensual: siempre el año completo, aunque haya filtro de mes. */}
        <div className="card">
          <div className="chart-head">
            Evolución mensual · {anio}
            <span className="hact">promedio sobre 100</span>
          </div>
          <div className="card-body">
            {meses.length < 2 ? (
              <div className="empty">Hace falta más de un mes para ver una tendencia.</div>
            ) : (
              <LineasMensuales
                categorias={meses.map((m) => MES_CORTO[m.mes]!)}
                series={[
                  { label: "Pre-evaluación", color: "var(--w1, #E0A400)", data: meses.map((m) => m.pre), dash: true },
                  { label: "Post-evaluación", color: "var(--ok, #2A9D6B)", data: meses.map((m) => m.post) },
                  { label: "% final", color: "var(--brand, #1E5A96)", data: meses.map((m) => m.promedio) },
                ]}
                formatoY={(v) => String(Math.round(v))}
                formatoPunto={pct}
                desdeCero
              />
            )}
          </div>
        </div>

        {/* Cómo se reparte el desempeño: es lo que dice si el promedio esconde cola. */}
        <div className="card">
          <div className="chart-head">
            Distribución de desempeño
            <span className="hact">{formatNumero(kpi.registros)} registros</span>
          </div>
          <div className="card-body" style={{ display: "grid", placeItems: "center" }}>
            {kpi.registros === 0 ? <div className="empty">Sin datos.</div> : (
              <Donut
                size={220}
                data={dist.filter((d) => d.cantidad > 0).map((d) => ({
                  label: `${d.nivel.label} (${d.nivel.desde}+)`,
                  valor: d.cantidad,
                  color: COLOR_NIVEL[d.nivel.clave],
                }))}
                centro={{ valor: pct(kpi.promedioFinal), etiqueta: "promedio final" }}
              />
            )}
          </div>
        </div>
      </div>

      {/* ---------------- Indicador A · Ejecución ---------------- */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-head">
          Indicador A · Ejecución del programa de capacitación
          <span className="hact">
            <a href={`/nomina/capacitaciones/plan?anio=${anio}`}>✏️ Editar plan</a> · meta &gt; {META_EJECUCION} %
          </span>
        </div>
        <div className="card-body">
          <p className="flag" style={{ marginTop: 0, fontSize: 12.5 }}>
            Verifica el cumplimiento del plan de formación: <b>capacitaciones ejecutadas ÷ planeadas</b>,
            mensual, a cargo del Líder de Gestión Humana.
          </p>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr><th>Mes</th><th className="r">Ejecutadas</th><th className="r">Planeadas</th><th className="r">Resultado</th></tr>
              </thead>
              <tbody>
                {filasEjecucion.map((f) => (
                  <tr key={f.mes}>
                    <td>{MES_LARGO[f.mes]}</td>
                    <td className="r num">{f.ejecutadas}</td>
                    <td className="r num">{f.planeadas ?? <span className="flag">sin plan</span>}</td>
                    <td className="r num">
                      {f.resultado == null ? <span className="flag">—</span> : (
                        <>{pct(f.resultado)} <span className={`tag ${f.cumple ? "t-ok" : "t-bad"}`}>{f.cumple ? "cumple" : "no cumple"}</span></>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filasEjecucion.some((f) => f.planeadas == null) && (
            <p className="alert" style={{ fontSize: 12.5, color: "var(--w1, #E0A400)", marginBottom: 0 }}>
              ⚠️ Hay meses sin plan de formación cargado. Sin planeadas no hay contra qué medir lo ejecutado,
              así que esos meses quedan sin resultado en vez de dar 100 % por defecto.{" "}
              <a href={`/nomina/capacitaciones/plan?anio=${anio}`}>Cargar el plan</a>.
            </p>
          )}
        </div>
      </div>

      {/* ---------------- Indicador B · Eficacia ---------------- */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-head">
          Indicador B · Eficacia de las capacitaciones
          <span className="hact">meta &gt; {META_EFICACIA} %</span>
        </div>
        <div className="card-body">
          <p className="flag" style={{ marginTop: 0, fontSize: 12.5 }}>
            Mide cuánto <b>aprendieron</b>, no cuánto sabían: <b>(post − pre) ÷ pre</b>. Por eso un grupo que
            llega bajo y termina bien saca una eficacia alta aunque su nota final no sea la mejor.
          </p>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr><th>Mes</th><th className="r">Pre</th><th className="r">Post</th><th className="r">Mejora</th><th className="r">Eficacia</th></tr>
              </thead>
              <tbody>
                {meses.map((m) => {
                  const cumple = m.eficacia > META_EFICACIA;
                  return (
                    <tr key={m.mes}>
                      <td>{MES_LARGO[m.mes]}</td>
                      <td className="r num">{pct(m.pre)}</td>
                      <td className="r num">{pct(m.post)}</td>
                      <td className="r num">{pts(m.post - m.pre)} pts</td>
                      <td className="r num">
                        {pct(m.eficacia)} <span className={`tag ${cumple ? "t-ok" : "t-bad"}`}>{cumple ? "cumple" : "no cumple"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Dónde flojea: por capacitación y por colaborador. */}
      <div className="grid two" style={{ marginBottom: 12, alignItems: "start" }}>
        <TopRanking
          titulo="Capacitaciones · de menor a mayor promedio"
          items={caps.map((c) => ({
            label: c.capacitacion,
            valor: c.promedio,
            sub: `${MES_CORTO[c.mes]} · ${c.participantes} part.`,
          }))}
          color="var(--brand)"
          formato="pct"
        />
        <TopRanking
          titulo="Colaboradores · de menor a mayor promedio"
          items={colabs.map((c) => ({
            label: c.colaborador,
            valor: c.promedio,
            sub: `${c.capacitaciones} capacitación(es)`,
          }))}
          color="var(--cat-3, #5BB4E5)"
          formato="pct"
        />
      </div>

      {/* Detalle por capacitación: cada una se despliega con su ficha y los
          resultados de cada colaborador. */}
      <div className="card">
        <div className="chart-head">
          Detalle por capacitación
          <span className="hact">{formatNumero(detalleCaps.length)} capacitación(es) · haz clic en una para ver su ficha y a cada colaborador</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {detalleCaps.length === 0 ? (
            <div className="empty">Sin capacitaciones en el periodo.</div>
          ) : (
            <>
              <div className="cap-fila cap-cab" aria-hidden="true">
                <span />
                <span>Mes</span>
                <span>Día</span>
                <span>Capacitación</span>
                <span>Estado</span>
                <span className="r">Evaluados</span>
                <span className="r">Prom. pre</span>
                <span className="r">Prom. post</span>
                <span className="r">Prom. final</span>
              </div>
              {detalleCaps.map((d) => (
                <details key={`${d.mes}-${d.capacitacion}`} className="cons-det cap-det">
                  <summary className="cap-fila">
                    <span className="cons-chev">▸</span>
                    <span>{MES_LARGO[d.mes]}</span>
                    <span>{d.dia ?? "—"}</span>
                    <span style={{ fontWeight: 600 }}>{d.capacitacion}</span>
                    <span>
                      <span className={`tag ${d.estado.toLowerCase().startsWith("ejec") ? "t-ok" : "t-blue"}`}>{d.estado || "—"}</span>
                    </span>
                    <span className="r num">{formatNumero(d.evaluados)}</span>
                    <span className="r num">{d.pre == null ? "—" : pct(d.pre)}</span>
                    <span className="r num">{d.post == null ? "—" : pct(d.post)}</span>
                    <span className="r num" style={{ fontWeight: 700 }}>{d.final == null ? "—" : pct(d.final)}</span>
                  </summary>

                  <div className="cap-ficha">
                    <dl className="cap-datos">
                      <div className="full"><dt>Objetivo</dt><dd>{d.objetivo || "—"}</dd></div>
                      <div><dt>Dirigido a</dt><dd>{d.dirigidoA || "—"}</dd></div>
                      <div><dt>Dirigido por</dt><dd>{d.dirigidoPor || "—"}</dd></div>
                      <div><dt>Modalidad</dt><dd>{d.modalidad || "—"}</dd></div>
                      {d.observaciones && <div className="full"><dt>Observaciones</dt><dd>{d.observaciones}</dd></div>}
                    </dl>
                    {!d.enCronograma && (
                      <p className="flag" style={{ margin: "0 0 8px" }}>
                        Esta capacitación está en el consolidado pero no en el cronograma cargado: faltan fecha, objetivo y demás datos.
                      </p>
                    )}

                    {d.participantes.length === 0 ? (
                      <div className="empty" style={{ padding: 12 }}>Sin evaluaciones registradas para esta capacitación.</div>
                    ) : (
                      <div className="tbl-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Colaborador</th>
                              <th className="r">Pre</th><th className="r">Post</th><th className="r">Mejora</th>
                              <th className="r">% final</th><th>Nivel</th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.participantes.map((r) => {
                              // El nivel de la fila mide cuánto SUBIÓ, no qué tan alto
                              // quedó: por eso sale de la mejora y no del % final.
                              const mejora = r.post - r.pre;
                              const n = nivelMejora(mejora);
                              return (
                                <tr key={r.id}>
                                  <td>{r.colaborador}</td>
                                  <td className="r num">{pct(r.pre)}</td>
                                  <td className="r num">{pct(r.post)}</td>
                                  <td className="r num">{pts(mejora)} pts</td>
                                  <td className="r num" style={{ fontWeight: 700 }}>{pct(r.final)}</td>
                                  <td><span className={`tag ${n.clase}`}>{n.label}</span></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
