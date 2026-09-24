// ==========================================================
// Análisis · Asistencia Técnica — indicador de calidad sobre las evaluaciones
// de seguimiento a los asesores quirúrgicos dentro del procedimiento.
//
// Siete ítems en escala 1–5, meta institucional ≥ 4,5. La metodología y todos
// los promedios viven en @/lib/negocio/asistencia-tecnica; aquí solo se pinta.
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { formatNumero } from "@/lib/format";
import { FiltroAuto } from "../_components/FiltroAuto";
import { MultiSelect, type OpcionMulti } from "../_components/MultiSelect";
import { listaDe } from "../_components/filtro-multi";
import { LineasMensuales } from "../_components/charts/LineasMensuales";
import {
  aniosConEvaluaciones, mesesConEvaluaciones, evaluaciones, pqrs,
  agregar, porMes, porAsesor, porCampo, conAdversos,
  ITEMS, ITEMS_CALIFICADOS, META, MES_CORTO, MES_LARGO,
} from "@/lib/negocio/asistencia-tecnica";

const COLORES = ["var(--az-1)", "var(--az-2)", "var(--az-3)", "var(--az-4)"];
const nota = (v: number) => v.toFixed(2).replace(".", ",");

/** Color según qué tan lejos está de la meta. */
function tono(v: number): string {
  if (v >= META + 0.3) return "var(--ok)";
  if (v >= META) return "var(--brand)";
  return "var(--bad)";
}

/** Barra de una calificación en escala 1–5, con la meta marcada. */
function BarraNota({ valor, ancho = 190 }: { valor: number; ancho?: number }) {
  const pct = (v: number) => ((v - 1) / 4) * 100;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ position: "relative", width: ancho, height: 8, background: "var(--brand-tint)", borderRadius: 4, overflow: "hidden", flex: "0 0 auto" }}>
        <span style={{ position: "absolute", inset: 0, width: `${pct(valor)}%`, background: tono(valor), borderRadius: 4 }} />
        <span style={{ position: "absolute", top: -2, bottom: -2, left: `${pct(META)}%`, width: 2, background: "var(--ink)", opacity: 0.55 }} title={`Meta ${nota(META)}`} />
      </span>
      <b className="num" style={{ color: tono(valor), minWidth: 34 }}>{nota(valor)}</b>
    </span>
  );
}

export default async function AsistenciaPage({
  searchParams,
}: { searchParams: Promise<{ anio?: string; mes?: string; asesor?: string }> }) {
  await requirePermiso("cxp.view");
  const sp = await searchParams;

  const anios = await aniosConEvaluaciones();
  if (!anios.length) {
    return (
      <div className="card"><div className="card-body">
        <div className="empty">Sin evaluaciones cargadas. Corre <code>npm run db:asistencia</code>.</div>
      </div></div>
    );
  }

  const anio = sp.anio && anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios[anios.length - 1]!;
  const mesesDisp = await mesesConEvaluaciones(anio);
  const mes = listaDe(sp.mes, new Set(mesesDisp.map(String))).map(Number);

  // El año completo alimenta las tendencias; el periodo elegido, todo lo demás.
  const [delAnio, casosPqrs] = await Promise.all([evaluaciones(anio), pqrs(anio, mes.length ? mes : undefined)]);
  const asesoresDisp = [...new Set(delAnio.map((e) => e.asesor))].sort();
  const asesor = listaDe(sp.asesor, new Set(asesoresDisp));

  const periodo = delAnio.filter((e) => (!mes.length || mes.includes(e.mes)) && (!asesor.length || asesor.includes(e.asesor)));
  const total = agregar(periodo);
  const serie = porMes(delAnio.filter((e) => !asesor.length || asesor.includes(e.asesor)));
  const asesores = porAsesor(periodo);
  const especialistas = porCampo(periodo, "especialista");
  const adversos = conAdversos(periodo);
  const totalPqrs = casosPqrs.reduce((a, p) => a + p.casos, 0);

  const mejor = serie.length ? serie.reduce((a, b) => (b.final > a.final ? b : a)) : undefined;
  const peor = serie.length ? serie.reduce((a, b) => (b.final < a.final ? b : a)) : undefined;
  const etiquetaPeriodo = mes.length === 1 ? `${MES_LARGO[mes[0]!]} ${anio}`
    : mes.length > 1 ? `${mes.map((m) => MES_CORTO[m]).join(", ")} ${anio}`
    : `${anio}`;
  const opMeses: OpcionMulti[] = mesesDisp.map((m) => ({ value: String(m), label: MES_LARGO[m]! }));
  const opAsesores: OpcionMulti[] = asesoresDisp.map((a) => ({ value: a, label: a }));
  const asesorTxt = asesor.length ? ` · ${asesor.join(", ")}` : "";

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="eyebrow" style={{ fontSize: 15 }}>Asistencia Técnica · {etiquetaPeriodo}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              Seguimiento a evaluaciones de asesores quirúrgicos · Conocimiento, Desempeño,
              Capacidad de solución y Habilidad · meta ≥ {nota(META)}
            </div>
          </div>
          <FiltroAuto className="toolbar">
            <label className="flag" style={{ alignSelf: "center" }}>Año:</label>
            <select name="anio" defaultValue={anio} className="select">
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <label className="flag" style={{ alignSelf: "center" }}>Mes:</label>
            <MultiSelect name="mes" options={opMeses} selected={mes.map(String)} placeholder="Todo el año" />
            <label className="flag" style={{ alignSelf: "center" }}>Asesor:</label>
            <MultiSelect name="asesor" options={opAsesores} selected={asesor} placeholder="Todos" />
          </FiltroAuto>
        </div>
      </div>

      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className={`kpi kc ${total.cumpleMeta ? "k-ok" : "k-bad"}`}>
          <div className="klabel">Calificación final</div>
          <div className="kval num" style={{ color: tono(total.final) }}>{nota(total.final)}</div>
          <div className="ksub" style={{ color: total.cumpleMeta ? "var(--ok)" : "var(--bad)" }}>
            {total.cumpleMeta ? "✓ cumple" : "✗ no cumple"} la meta de {nota(META)}
          </div>
        </div>
        <div className="kpi kc">
          <div className="klabel">Evaluaciones</div>
          <div className="kval num">{formatNumero(total.n)}</div>
          <div className="ksub" style={{ color: "var(--muted)" }}>{asesores.length} asesor(es)</div>
        </div>
        <div className={`kpi kc ${adversos.length ? "k-bad" : "k-ok"}`}>
          <div className="klabel">Novedades, eventos e incidentes</div>
          <div className="kval num">{formatNumero(adversos.length)}</div>
          <div className="ksub" style={{ color: "var(--muted)" }}>de {formatNumero(total.n)} procedimientos</div>
        </div>
        <div className={`kpi kc ${totalPqrs ? "k-bad" : "k-ok"}`}>
          <div className="klabel">Quejas, reclamos y sugerencias</div>
          <div className="kval num">{formatNumero(totalPqrs)}</div>
          <div className="ksub" style={{ color: "var(--muted)" }}>dato que se lleva aparte</div>
        </div>
      </div>

      {/* Tendencia de la calificación final y de los cuatro ítems calificados */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", marginBottom: 12, alignItems: "start" }}>
        <div className="card">
          <div className="chart-head">
            Comportamiento de la Calificación Final
            <span className="hact">{anio}{asesorTxt}</span>
          </div>
          <div className="card-body">
            {serie.length < 2 ? <div className="empty">Se necesitan al menos dos meses.</div> : (
              <LineasMensuales
                desdeCero={false}
                unidad="escala 1 a 5"
                formatoY={nota}
                formatoPunto={nota}
                categorias={serie.map((s) => MES_CORTO[s.mes]!)}
                series={[
                  { label: "Calificación del mes", color: "var(--brand)", data: serie.map((s) => s.final) },
                  { label: `Meta ${nota(META)}`, color: "var(--ok)", dash: true, data: serie.map(() => META) },
                ]}
              />
            )}
          </div>
        </div>

        <div className="card">
          <div className="chart-head">Tendencia por Ítem <span className="hact">ítems 1–4</span></div>
          <div className="card-body">
            {serie.length < 2 ? <div className="empty">Se necesitan al menos dos meses.</div> : (
              <LineasMensuales
                desdeCero={false}
                unidad="escala 1 a 5"
                formatoY={nota}
                formatoPunto={nota}
                categorias={serie.map((s) => MES_CORTO[s.mes]!)}
                series={ITEMS_CALIFICADOS.map((it, i) => ({
                  label: it.label,
                  color: COLORES[i]!,
                  data: serie.map((s) => s.items[i]!),
                }))}
              />
            )}
          </div>
        </div>
      </div>

      {/* Promedio por ítem + calificación por asesor */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", marginBottom: 12, alignItems: "start" }}>
        <div className="card">
          <div className="chart-head">Promedio por Ítem Evaluado <span className="hact">{etiquetaPeriodo}</span></div>
          <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {ITEMS.map((it, i) => (
              <div key={it.clave} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {i + 1}. {it.label}
                  {i >= 4 && <span className="flag" style={{ marginLeft: 6, fontWeight: 500 }}>· sí/no</span>}
                </span>
                <BarraNota valor={total.items[i]!} />
              </div>
            ))}
          </div>
          <div className="card-body" style={{ fontSize: 12, color: "var(--muted)", borderTop: "1px solid var(--line)" }}>
            La línea vertical marca la meta de {nota(META)}. Los ítems 5 a 7 son sí/no: un &quot;no hubo&quot; vale 5 puntos y un &quot;sí hubo&quot; vale 1.
          </div>
        </div>

        <div className="card">
          <div className="chart-head">Calificación por Asesor <span className="hact">{etiquetaPeriodo}</span></div>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Asesor</th><th className="r">Evaluaciones</th>
                  <th>Calificación</th><th></th>
                </tr>
              </thead>
              <tbody>
                {asesores.length === 0 && <tr><td colSpan={4}><div className="empty">Sin evaluaciones.</div></td></tr>}
                {asesores.map((a) => (
                  <tr key={a.asesor}>
                    <td style={{ fontWeight: 600, whiteSpace: "normal" }}>{a.asesor}</td>
                    <td className="r num">{formatNumero(a.n)}</td>
                    <td><BarraNota valor={a.final} ancho={130} /></td>
                    <td>{a.cumpleMeta
                      ? <span className="tag t-ok">cumple</span>
                      : <span className="tag t-bad">bajo meta</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Resumen del periodo */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-head">Resumen del Periodo <span className="hact">{etiquetaPeriodo}</span></div>
        <div className="card-body">
          <div style={{ display: "grid", gap: 10, marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
              <span className="tag t-blue" style={{ flex: "0 0 auto" }}>Objetivo general</span>
              <p style={{ flex: "1 1 400px", fontSize: 13.5, lineHeight: 1.55, margin: 0 }}>
                Crear estrategias de buen servicio que permitan optimizar el manejo de procesos y recursos
                con el fin de establecer mecanismos para garantizar la satisfacción del cliente.
              </p>
            </div>
            <div style={{ display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
              <span className="tag t-blue" style={{ flex: "0 0 auto" }}>Objetivo específico</span>
              <p style={{ flex: "1 1 400px", fontSize: 13.5, lineHeight: 1.55, margin: 0 }}>
                Analizar a través de las evaluaciones de seguimiento la capacidad, el conocimiento, el desempeño
                y la habilidad del asesor quirúrgico dentro del procedimiento.
              </p>
            </div>
          </div>

          <p style={{ fontSize: 14, lineHeight: 1.65 }}>
            En {etiquetaPeriodo} se realizaron <b>{formatNumero(total.n)} evaluaciones</b> a{" "}
            <b>{asesores.length} asesor(es)</b>, con una calificación final de{" "}
            <b style={{ color: tono(total.final) }}>{nota(total.final)}</b>, que{" "}
            {total.cumpleMeta ? "cumple" : "no alcanza"} la meta institucional de {nota(META)}.
            {mejor && peor && mejor.mes !== peor.mes && (
              <> El mejor mes fue <b>{MES_LARGO[mejor.mes]}</b> con {nota(mejor.final)} y el más bajo{" "}
              <b>{MES_LARGO[peor.mes]}</b> con {nota(peor.final)}.</>
            )}
            {" "}Se registraron <b>{adversos.length}</b> procedimientos con novedades, eventos o incidentes adversos
            {especialistas.length > 0 && <> y se acompañó a <b>{especialistas.length}</b> especialista(s)</>}.
          </p>

          <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginTop: 16, padding: "14px 16px", background: totalPqrs ? "var(--bad-t)" : "var(--ok-t)", border: `1px solid ${totalPqrs ? "var(--bad)" : "var(--ok)"}`, borderRadius: 10 }}>
            <div style={{ flex: "0 0 auto", width: 34, height: 34, borderRadius: "50%", background: totalPqrs ? "var(--bad)" : "var(--ok)", color: "#fff", fontSize: 18, fontWeight: 700, display: "grid", placeItems: "center" }}>
              {totalPqrs ? "!" : "✓"}
            </div>
            <div>
              <div style={{ fontSize: 11.5, letterSpacing: ".06em", textTransform: "uppercase", fontWeight: 700, color: totalPqrs ? "var(--bad)" : "var(--ok)" }}>
                Atención a quejas, reclamos y/o sugerencias
                <a href={`/asistencia/pqrs?anio=${anio}`} style={{ marginLeft: 8, textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>registrar →</a>
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, marginTop: 2, color: totalPqrs ? "var(--bad)" : "var(--ok)" }}>
                {formatNumero(totalPqrs)} <span style={{ fontSize: 12.5, fontWeight: 600 }}>caso(s) registrado(s)</span>
              </div>
              <div style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.5, color: "var(--muted)" }}>
                {casosPqrs.length === 0
                  ? "Todavía no se ha registrado el dato para este periodo."
                  : totalPqrs === 0
                    ? `Se mantuvo en cero durante ${casosPqrs.length} mes(es) del periodo.`
                    : casosPqrs.filter((p) => p.casos > 0).map((p) => `${MES_LARGO[p.mes]}: ${p.casos}`).join(" · ")}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Detalle */}
      <div className="card">
        <div className="chart-head">
          Detalle de Evaluaciones
          <span className="hact">{formatNumero(periodo.length)} registro(s) · {etiquetaPeriodo}{asesorTxt}</span>
        </div>
        <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Fecha</th><th>Paciente</th><th>Procedimiento</th><th>IPS</th>
                <th>Especialista</th><th>Asesor</th>
                <th className="r">Con.</th><th className="r">Des.</th>
                <th className="r">Cap.</th><th className="r">Hab.</th>
                <th className="r">Prom.</th><th>Adversos</th>
              </tr>
            </thead>
            <tbody>
              {periodo.length === 0 && <tr><td colSpan={12}><div className="empty">Sin evaluaciones en el periodo.</div></td></tr>}
              {periodo.map((e) => {
                const prom = (e.conocimiento + e.desempeno + e.capacidad + e.habilidad) / 4;
                const hubo = e.novedades || e.eventos || e.incidentes;
                return (
                  <tr key={e.id}>
                    <td>{e.fecha.toISOString().slice(0, 10)}</td>
                    <td style={{ whiteSpace: "normal" }}>{e.paciente}</td>
                    <td style={{ whiteSpace: "normal" }}>{e.procedimiento}</td>
                    <td style={{ whiteSpace: "normal" }}>{e.ips}</td>
                    <td style={{ whiteSpace: "normal" }}>{e.especialista}</td>
                    <td style={{ whiteSpace: "normal" }}>{e.asesor}</td>
                    <td className="r num">{nota(e.conocimiento)}</td>
                    <td className="r num">{nota(e.desempeno)}</td>
                    <td className="r num">{nota(e.capacidad)}</td>
                    <td className="r num">{nota(e.habilidad)}</td>
                    <td className="r num" style={{ fontWeight: 700, color: tono(prom) }}>{nota(prom)}</td>
                    <td>{hubo
                      ? <span className="tag t-bad">
                          {[e.novedades && "novedad", e.eventos && "evento", e.incidentes && "incidente"].filter(Boolean).join(", ")}
                        </span>
                      : <span className="tag t-ok">ninguno</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ fontSize: 12, color: "var(--muted)", borderTop: "1px solid var(--line)" }}>
          <b>Metodología.</b> Cada ítem = suma de calificaciones ÷ número de evaluaciones del periodo.
          Los ítems 5, 6 y 7 (Novedades, Eventos e Incidentes adversos) toman un &quot;no hubo&quot; como 5 puntos y un &quot;sí hubo&quot; como 1.
          La calificación final es el promedio de los 7 ítems en escala 1–5; la meta institucional es ≥ {nota(META)}.
        </div>
      </div>
    </>
  );
}
