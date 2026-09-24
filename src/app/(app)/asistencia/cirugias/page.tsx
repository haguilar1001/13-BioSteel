// ==========================================================
// Análisis · Asistencia Técnica · Cirugías — volumen y cobertura de asesores.
// Replica el informe Power BI (Cirugías, Prom Día, Prom Mes, Prom por médico,
// Asesores vs Sin Soporte) con el diseño nativo del app.
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { formatNumero } from "@/lib/format";
import { FiltroAuto } from "../../_components/FiltroAuto";
import { MultiSelect, type OpcionMulti } from "../../_components/MultiSelect";
import { listaDe } from "../../_components/filtro-multi";
import { LineasMensuales } from "../../_components/charts/LineasMensuales";
import {
  aniosConCirugias, mesesConCirugias, diasConCirugias, catalogosCx,
  resumenCx, cirugiasPorMes, cirugiasPorAsesor, promedioDiaAsesor, cirugiasPorMedico,
  cirugiasPorIps, cirugiasPorCiudad, cirugiasPorGrupo,
  MES_CORTO, MES_LARGO, type FiltroCx,
} from "@/lib/negocio/cirugias";

const nInt = (v: number) => formatNumero(Math.round(v));
const n1 = (v: number) => v.toFixed(1).replace(".", ",");
const pct1 = (v: number) => (v * 100).toFixed(1).replace(".", ",") + " %";

/** Ranking horizontal de conteos (barra + valor). */
function Ranking({ filas, tope = 15, color = "var(--brand)", formato = nInt }: { filas: { nombre: string; total: number }[]; tope?: number; color?: string; formato?: (v: number) => string }) {
  const top = filas.slice(0, tope);
  const max = Math.max(1, ...top.map((f) => f.total));
  return (
    <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {top.length === 0 && <div className="empty">Sin datos.</div>}
      {top.map((f) => (
        <div key={f.nombre} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 220px) 1fr 60px", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.nombre}>{f.nombre}</span>
          <span style={{ height: 12, background: "var(--brand-tint)", borderRadius: 4, overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${(f.total / max) * 100}%`, background: color, borderRadius: 4 }} />
          </span>
          <span className="num" style={{ textAlign: "right", fontWeight: 700 }}>{formato(f.total)}</span>
        </div>
      ))}
    </div>
  );
}

export default async function CirugiasPage({
  searchParams,
}: { searchParams: Promise<{ anio?: string; mes?: string; dia?: string; ciudad?: string; grupo?: string; asesor?: string }> }) {
  await requirePermiso("cxp.view");
  const sp = await searchParams;

  const anios = await aniosConCirugias();
  if (!anios.length) {
    return (
      <div className="card"><div className="card-body">
        <div className="empty">Sin cirugías cargadas. Súbelas en <b>Cargar archivos → Calidad</b> o corre <code>npm run db:cirugias</code>.</div>
      </div></div>
    );
  }
  const anio = sp.anio && anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios[anios.length - 1]!;
  const mesesDisp = await mesesConCirugias(anio);
  const mes = listaDe(sp.mes, new Set(mesesDisp.map(String))).map(Number);
  // El día solo se ofrece con un único mes elegido: "día 15" no significa
  // nada si el filtro abarca varios meses a la vez.
  const mesUnico = mes.length === 1 ? mes[0]! : undefined;
  const diasDisp = mesUnico ? await diasConCirugias(anio, mesUnico) : [];
  const dia = mesUnico && sp.dia && diasDisp.includes(Number(sp.dia)) ? Number(sp.dia) : undefined;

  const cat = await catalogosCx(anio);
  const ciudad = listaDe(sp.ciudad, new Set(cat.ciudades));
  const grupo = listaDe(sp.grupo, new Set(cat.grupos));
  const asesor = listaDe(sp.asesor, new Set(cat.asesores));
  const f: FiltroCx = { anio, mes, dia, ciudad, grupo, asesor };

  const [resumen, porMes, porAsesor, promAsesor, porIps, porCiudad, porGrupo, porMedico] = await Promise.all([
    resumenCx(f), cirugiasPorMes(f), cirugiasPorAsesor(f), promedioDiaAsesor(f), cirugiasPorIps(f),
    cirugiasPorCiudad(f), cirugiasPorGrupo(f), cirugiasPorMedico(f),
  ]);

  const etiqueta = mesUnico ? `${dia ? `${dia} de ` : ""}${MES_LARGO[mesUnico]} ${anio}`
    : mes.length > 1 ? `${mes.map((m) => MES_CORTO[m]).join(", ")} ${anio}`
    : `${anio}`;
  const cobColor = resumen.coberturaPct >= 0.7 ? "var(--ok)" : resumen.coberturaPct >= 0.5 ? "var(--w1)" : "var(--bad)";
  const opMeses: OpcionMulti[] = mesesDisp.map((m) => ({ value: String(m), label: MES_LARGO[m]! }));
  const opCiudades: OpcionMulti[] = cat.ciudades.map((c) => ({ value: c, label: c }));
  const opGrupos: OpcionMulti[] = cat.grupos.map((g) => ({ value: g, label: g }));
  const opAsesores: OpcionMulti[] = cat.asesores.map((a) => ({ value: a, label: a }));

  return (
    <>
      {/* Filtros */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="eyebrow" style={{ fontSize: 15 }}>Asistencia Técnica · Cirugías · {etiqueta}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              Volumen de cirugías (material de osteosíntesis) y cobertura de asesores quirúrgicos
            </div>
          </div>
          <FiltroAuto className="toolbar">
            <label className="flag" style={{ alignSelf: "center" }}>Año:</label>
            <select name="anio" defaultValue={anio} className="select">
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <label className="flag" style={{ alignSelf: "center" }}>Mes:</label>
            <MultiSelect name="mes" options={opMeses} selected={mes.map(String)} placeholder="Todo el año" />
            <label className="flag" style={{ alignSelf: "center" }}>Día:</label>
            <select name="dia" defaultValue={dia ?? ""} className="select" disabled={!mesUnico} title={mesUnico ? undefined : "Elige un solo mes primero"}>
              <option value="">{mesUnico ? "Todo el mes" : "—"}</option>
              {diasDisp.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <label className="flag" style={{ alignSelf: "center" }}>Ciudad:</label>
            <MultiSelect name="ciudad" options={opCiudades} selected={ciudad} placeholder="Todas" />
            <label className="flag" style={{ alignSelf: "center" }}>Grupo:</label>
            <MultiSelect name="grupo" options={opGrupos} selected={grupo} placeholder="Todos" />
            <label className="flag" style={{ alignSelf: "center" }}>Asesor:</label>
            <MultiSelect name="asesor" options={opAsesores} selected={asesor} placeholder="Todos" ancho={220} />
            {(mes.length || ciudad.length || grupo.length || asesor.length)
              ? <a href={`/asistencia/cirugias?anio=${anio}`} className="btn">Limpiar</a>
              : null}
          </FiltroAuto>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi kc">
          <div className="klabel">Cirugías</div>
          <div className="kval num">{nInt(resumen.total)}</div>
          <div className="ksub" style={{ color: "var(--muted)" }}>{nInt(resumen.dias)} días · {nInt(resumen.medicos)} médicos</div>
        </div>
        <div className="kpi kc">
          <div className="klabel">Promedio por día</div>
          <div className="kval num">{n1(resumen.promDia)}</div>
          <div className="ksub" style={{ color: "var(--muted)" }}>cirugías / día</div>
        </div>
        <div className="kpi kc">
          <div className="klabel">Promedio por mes</div>
          <div className="kval num">{nInt(resumen.promMes)}</div>
          <div className="ksub" style={{ color: "var(--muted)" }}>· {n1(resumen.promMedico)} por médico</div>
        </div>
        <div className="kpi kc">
          <div className="klabel">Cobertura de asesor</div>
          <div className="kval num" style={{ color: cobColor }}>{pct1(resumen.coberturaPct)}</div>
          <div className="ksub" style={{ color: "var(--muted)" }}>{nInt(resumen.conAsesor)} con asesor · {nInt(resumen.sinSoporte)} sin soporte</div>
        </div>
      </div>

      {/* Tendencia por mes + cobertura */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", marginBottom: 12, alignItems: "start" }}>
        <div className="card">
          <div className="chart-head">Cirugías por Mes <span className="hact">{anio}</span></div>
          <div className="card-body">
            {porMes.length < 2 ? <div className="empty">Se necesitan al menos dos meses.</div> : (
              <LineasMensuales
                desdeCero unidad="cirugías" formatoY={(v) => nInt(v)} formatoPunto={(v) => nInt(v)}
                categorias={porMes.map((m) => MES_CORTO[m.mes]!)}
                series={[
                  { label: "Total", color: "var(--brand)", data: porMes.map((m) => m.total) },
                  { label: "Con asesor", color: "var(--ok)", data: porMes.map((m) => m.conAsesor) },
                  { label: "Sin soporte", color: "var(--bad)", dash: true, data: porMes.map((m) => m.sinSoporte) },
                ]}
              />
            )}
          </div>
        </div>

        <div className="card">
          <div className="chart-head">Cobertura de Asesores <span className="hact">{etiqueta}</span></div>
          <div className="card-body">
            <div style={{ display: "flex", height: 26, borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
              <div title={`Con asesor: ${nInt(resumen.conAsesor)}`} style={{ width: `${resumen.coberturaPct * 100}%`, background: "var(--ok)" }} />
              <div title={`Sin soporte: ${nInt(resumen.sinSoporte)}`} style={{ width: `${(1 - resumen.coberturaPct) * 100}%`, background: "var(--bad)" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--ok)", borderRadius: 2, marginRight: 6 }} />Con asesor</span>
              <b className="num">{nInt(resumen.conAsesor)} · {pct1(resumen.coberturaPct)}</b>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 6 }}>
              <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--bad)", borderRadius: 2, marginRight: 6 }} />Sin soporte asesor QX</span>
              <b className="num">{nInt(resumen.sinSoporte)} · {pct1(1 - resumen.coberturaPct)}</b>
            </div>
          </div>
        </div>
      </div>

      {/* Por asesor + por médico */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", marginBottom: 12, alignItems: "start" }}>
        <div className="card">
          <div className="chart-head">Cirugías por Asesor <span className="hact">top {Math.min(15, porAsesor.length)} de {porAsesor.length}</span></div>
          <Ranking filas={porAsesor} color="var(--brand)" />
        </div>
        <div className="card">
          <div className="chart-head">Promedio de Cx Diarias por Asesor <span className="hact">cx ÷ días operados</span></div>
          <Ranking filas={promAsesor} color="var(--ok)" formato={n1} />
        </div>
      </div>

      {/* Top médicos */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-head">Top Médicos Cirujanos <span className="hact">{porMedico.length} médicos · {n1(resumen.promMedico)} cx/médico</span></div>
        <Ranking filas={porMedico} tope={15} color="var(--az-3)" />
      </div>

      {/* Por IPS */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-head">Cirugías por IPS <span className="hact">{porIps.length} IPS · {etiqueta}</span></div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr><th>IPS</th><th>Ciudad</th><th>Grupo</th><th className="r">Cirugías</th><th className="r">Con asesor</th><th className="r">% Cobertura</th></tr>
            </thead>
            <tbody>
              {porIps.map((x) => {
                const cob = x.total ? (x.total - x.sinSoporte) / x.total : 0;
                return (
                  <tr key={x.ips}>
                    <td style={{ fontWeight: 600, whiteSpace: "normal" }}>{x.ips}</td>
                    <td className="flag">{x.ciudad ?? "—"}</td>
                    <td className="flag">{x.grupo ?? "—"}</td>
                    <td className="r num" style={{ fontWeight: 700 }}>{nInt(x.total)}</td>
                    <td className="r num flag">{nInt(x.total - x.sinSoporte)}</td>
                    <td className="r num" style={{ color: cob >= 0.7 ? "var(--ok)" : cob >= 0.5 ? undefined : "var(--bad)", fontWeight: 600 }}>{pct1(cob)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Por ciudad + grupo */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", marginBottom: 12, alignItems: "start" }}>
        <div className="card">
          <div className="chart-head">Cirugías por Ciudad</div>
          <Ranking filas={porCiudad} tope={20} color="var(--az-2)" />
        </div>
        <div className="card">
          <div className="chart-head">Cirugías por Grupo</div>
          <Ranking filas={porGrupo} tope={20} color="var(--az-5)" />
        </div>
      </div>
    </>
  );
}
