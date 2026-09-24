// ==========================================================
// Osteosíntesis · Inventario Valorizado — cuánta plata hay quieta en
// inventario, dónde está y qué tan rápido rota.
//
// El saldo sale del balance mensual, que es la cifra oficial. Se abre por
// bodega, marca, línea, anatomía, sistema o categoría.
//
// La bodega llegó con el export nuevo de SIESA: los meses cargados antes solo
// tienen instalación (propio / consignación / aprovechamiento) y en ellos el
// filtro de bodega no aplica. `mesesConBodega` es lo que distingue unos de
// otros, y la pantalla lo dice en vez de mostrar ceros.
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { formatCOP, formatCOPCorto, formatNumero } from "@/lib/format";
import { Monto } from "../../_components/Monto";
import { FiltroAuto } from "../../_components/FiltroAuto";
import { MultiSelect, type OpcionMulti } from "../../_components/MultiSelect";
import { listaDe } from "../../_components/filtro-multi";
import { Donut } from "../../_components/charts/Donut";
import { LineasMensuales } from "../../_components/charts/LineasMensuales";
import { TopRanking } from "../../_components/charts/TopRanking";
import {
  aniosConBalance, mesesConBalance, mesesConBodega, bodegasConSaldo,
  resumenValorizado, saldoPorInstalacion,
  saldoPorDimension, evolucionSaldo, itemsConSaldo,
  DIMENSIONES, NOMBRE_INSTALACION, INSTALACIONES_CON_MATERIAL, MES_CORTO,
  type Dimension, type FiltroSaldo,
} from "@/lib/negocio/inventario-osteo";

const MES_LARGO = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];


/** Rotación en meses de inventario, con semáforo: mucho saldo y poca salida es plata quieta. */
function Rotacion({ meses }: { meses: number | null }) {
  if (meses == null) return <span className="tag t-bad" title="No tuvo salidas en el año">sin rotar</span>;
  const color = meses <= 3 ? "t-ok" : meses <= 8 ? "t-w1" : "t-bad";
  return <span className={`tag ${color}`}>{meses.toFixed(1)} meses</span>;
}

export default async function ValorizadoPage({
  searchParams,
}: { searchParams: Promise<{ anio?: string; mes?: string; dim?: string; inst?: string; bodega?: string }> }) {
  await requirePermiso("osteo.view");
  const sp = await searchParams;

  const anios = await aniosConBalance();
  if (!anios.length) {
    return (
      <div className="card"><div className="card-body">
        <div className="empty">
          Sin inventario cargado. Corre <code>npm run db:inventario-osteo</code>.
        </div>
      </div></div>
    );
  }

  const anio = sp.anio && anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios[anios.length - 1]!;
  const meses = await mesesConBalance(anio);
  const mes = sp.mes && meses.includes(Number(sp.mes)) ? Number(sp.mes) : meses[meses.length - 1]!;
  const dim: Dimension = (sp.dim && sp.dim in DIMENSIONES ? sp.dim : "marca") as Dimension;
  const instalacionesValidas = new Set(INSTALACIONES_CON_MATERIAL.map(String));
  const inst = listaDe(sp.inst, instalacionesValidas).map(Number);

  // El detalle por bodega solo existe en los meses cargados con el export
  // nuevo; en los demás el selector no se muestra.
  const conBodega = await mesesConBodega(anio);
  const detalleBodega = conBodega.includes(mes);
  const catalogo = detalleBodega ? await bodegasConSaldo(anio, mes) : [];
  const bodegasValidas = new Set(catalogo.map((b) => b.codigo));
  const bodega = listaDe(sp.bodega, bodegasValidas);
  const bodegaSel = bodega.length === 1 ? catalogo.find((b) => b.codigo === bodega[0]) : undefined;
  const filtro: FiltroSaldo = { inst, bodega };

  const [kpi, porInst, porDim, evolucion, items] = await Promise.all([
    resumenValorizado(anio, mes, filtro),
    saldoPorInstalacion(anio, mes, filtro),
    saldoPorDimension(anio, mes, dim, filtro),
    evolucionSaldo(filtro),
    itemsConSaldo(anio, mes, 60, filtro),
  ]);

  const variacionValor = kpi.valor - kpi.valorAnterior;
  const variacion = kpi.valorAnterior > 0 ? (variacionValor / kpi.valorAnterior) * 100 : 0;
  const serieAnio = evolucion.filter((p) => p.anio === anio);
  const quietos = porDim.filter((d) => d.mesesInventario == null || d.mesesInventario > 8);
  const valorQuieto = quietos.reduce((a, d) => a + d.valor, 0);
  const totalInv = porInst.reduce((a, i) => a + i.valor, 0);
  const opInstalaciones: OpcionMulti[] = INSTALACIONES_CON_MATERIAL.map((i) => ({ value: String(i), label: `${i} · ${NOMBRE_INSTALACION[i]}` }));
  const opBodegas: OpcionMulti[] = catalogo.map((b) => ({ value: b.codigo, label: `${b.codigo} · ${b.descripcion}`, sub: b.ciudad || undefined }));

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="eyebrow" style={{ fontSize: 15 }}>Inventario Valorizado · {MES_LARGO[mes]} {anio}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              Saldo del balance mensual, a costo promedio
              {inst.length ? ` · solo ${inst.map((i) => NOMBRE_INSTALACION[i]).join(", ")}` : " · todas las instalaciones"}
              {bodegaSel ? ` · bodega ${bodegaSel.codigo} · ${bodegaSel.descripcion}${bodegaSel.ciudad ? ` · ${bodegaSel.ciudad}` : ""}`
                : bodega.length ? ` · ${bodega.length} bodegas` : ""}.
              {" "}Para ver el detalle documento a documento,{" "}
              <a href={`/osteosintesis/movimientos?anio=${anio}&mes=${mes}${bodega.length ? `&bodega=${bodega.join(",")}` : ""}`}>Movimientos</a>.
            </div>
          </div>
          <FiltroAuto className="toolbar">
            <label className="flag" style={{ alignSelf: "center" }}>Año:</label>
            <select name="anio" defaultValue={anio} className="select">
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <label className="flag" style={{ alignSelf: "center" }}>Mes:</label>
            <select name="mes" defaultValue={mes} className="select">
              {meses.map((m) => <option key={m} value={m}>{MES_LARGO[m]}</option>)}
            </select>
            <label className="flag" style={{ alignSelf: "center" }}>Instalación:</label>
            <MultiSelect name="inst" options={opInstalaciones} selected={inst.map(String)} placeholder="Todas" />
            {detalleBodega && (
              <>
                <label className="flag" style={{ alignSelf: "center" }}>Bodega:</label>
                <MultiSelect name="bodega" options={opBodegas} selected={bodega} placeholder={`Todas (${catalogo.length})`} ancho={320} />
              </>
            )}
            <input type="hidden" name="dim" value={dim} />
          </FiltroAuto>
        </div>
      </div>

      {!detalleBodega && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-body" style={{ fontSize: 12, color: "var(--muted)", padding: "10px 14px" }}>
            {MES_LARGO[mes]} {anio} se cargó con el export viejo del balance, que solo llegaba hasta instalación:
            por eso no hay filtro de bodega. {conBodega.length > 0
              ? <>Sí lo hay en {conBodega.map((m) => MES_LARGO[m]).join(", ")}.</>
              : <>Vuelve a cargar el balance con la columna Bodega para tenerlo.</>}
          </div>
        </div>
      )}

      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi kc">
          <div className="klabel">Saldo en inventario</div>
          <div className="kval num"><Monto value={kpi.valor} /></div>
          <div className="ksub" style={{ color: variacionValor < 0 ? "var(--bad)" : "var(--ok)" }}>
            {variacionValor >= 0 ? "▲" : "▼"} <Monto value={Math.abs(variacionValor)} /> ({Math.abs(variacion).toFixed(1)}%) vs mes anterior
          </div>
        </div>
        <div className="kpi kc k-w">
          <div className="klabel">Unidades</div>
          <div className="kval num">{formatNumero(kpi.unidades)}</div>
          <div className="ksub" style={{ color: "var(--muted)" }}>{formatNumero(kpi.items)} ítems con existencia</div>
        </div>
        <div className="kpi kc k-ingreso">
          <div className="klabel">Entradas del mes</div>
          <div className="kval num"><Monto value={kpi.entradas} /></div>
        </div>
        <div className="kpi kc k-egreso">
          <div className="klabel">Salidas del mes</div>
          <div className="kval num"><Monto value={kpi.salidas} /></div>
        </div>
      </div>

      {/* Evolución + composición por instalación */}
      <div className="grid" style={{ gridTemplateColumns: "minmax(340px, 1.6fr) minmax(280px, 1fr)", marginBottom: 12, alignItems: "start" }}>
        <div className="card">
          <div className="chart-head">
            Evolución del Saldo
            <span className="hact">
              {anio} · cierre de cada mes{inst.length ? ` · ${inst.map((i) => NOMBRE_INSTALACION[i]).join(", ")}` : ""}
              {bodegaSel ? ` · bodega ${bodegaSel.codigo}` : bodega.length ? ` · ${bodega.length} bodegas` : ""}
            </span>
          </div>
          <div className="card-body">
            {serieAnio.length < 2 ? (
              <div className="empty">
                {bodega.length
                  ? `Solo hay ${serieAnio.length} mes con detalle por bodega; se necesitan dos para dibujar la evolución.`
                  : "Se necesitan al menos dos meses cargados."}
              </div>
            ) : (
              <>
                <LineasMensuales
                  desdeCero={false}
                  categorias={serieAnio.map((p) => MES_CORTO[p.mes]!)}
                  series={[{ label: "Saldo final", color: "var(--brand)", data: serieAnio.map((p) => p.valor) }]}
                />
                {(() => {
                  const ini = serieAnio[0]!, fin = serieAnio[serieAnio.length - 1]!;
                  const dif = fin.valor - ini.valor;
                  const pct = ini.valor > 0 ? (dif / ini.valor) * 100 : 0;
                  return (
                    <div style={{ marginTop: 8, fontSize: 12.5 }}>
                      De {MES_CORTO[ini.mes]} a {MES_CORTO[fin.mes]} el inventario{dif < 0 ? " bajó " : " subió "}
                      <b style={{ color: dif < 0 ? "var(--bad)" : "var(--ok)" }}><Monto value={Math.abs(dif)} /></b>
                      {" "}({Math.abs(pct).toFixed(1)}%).
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="chart-head">
            Por Instalación
            <span className="hact">{MES_CORTO[mes]} {anio}{bodegaSel ? ` · bodega ${bodegaSel.codigo}` : ""}</span>
          </div>
          <div className="card-body" style={{ display: "grid", placeItems: "center" }}>
            <Donut
              azul
              size={210}
              data={porInst.filter((i) => i.valor !== 0).map((i) => ({
                label: `${i.instalacion} · ${NOMBRE_INSTALACION[i.instalacion] ?? "?"}`,
                valor: i.valor,
              }))}
              centro={{ valor: formatCOP(totalInv), valorCorto: formatCOPCorto(totalInv), etiqueta: "en inventario" }}
            />
            {(porInst.find((i) => i.instalacion === 106)?.unidades ?? 0) > 0 && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10, textAlign: "center" }}>
                La instalación 106 (aprovechamiento) no aparece: tiene{" "}
                {formatNumero(porInst.find((i) => i.instalacion === 106)?.unidades ?? 0)} unidades a costo $0.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Apertura por dimensión */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingBottom: 0, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div className="eyebrow">Saldo por {DIMENSIONES[dim]}</div>
          <FiltroAuto className="toolbar">
            <input type="hidden" name="anio" value={anio} />
            <input type="hidden" name="mes" value={mes} />
            {/* Sin estos ocultos, cambiar la apertura borraba los filtros de arriba. */}
            {inst.length > 0 && <input type="hidden" name="inst" value={inst.join(",")} />}
            {bodega.length > 0 && <input type="hidden" name="bodega" value={bodega.join(",")} />}
            <label className="flag" style={{ alignSelf: "center" }}>Abrir por:</label>
            <select name="dim" defaultValue={dim} className="select">
              {Object.entries(DIMENSIONES)
                .filter(([k]) => k !== "bodegaCodigo" || detalleBodega)
                .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </FiltroAuto>
        </div>
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>{DIMENSIONES[dim]}</th>
                <th className="r">Saldo</th><th className="r">% del total</th>
                <th className="r">Unidades</th><th className="r">Ítems</th>
                <th className="r">Entradas mes</th><th className="r">Salidas mes</th>
                <th className="r">Rotación</th>
              </tr>
            </thead>
            <tbody>
              {porDim.length === 0 && <tr><td colSpan={8}><div className="empty">Sin datos.</div></td></tr>}
              {porDim.map((d) => (
                <tr key={d.label}>
                  <td style={{ fontWeight: 600, whiteSpace: "normal" }}>{d.label}</td>
                  <td className="r num"><Monto value={d.valor} /></td>
                  <td className="r num">{kpi.valor > 0 ? ((d.valor / kpi.valor) * 100).toFixed(1) : "0.0"}%</td>
                  <td className="r num">{formatNumero(d.unidades)}</td>
                  <td className="r num">{formatNumero(d.items)}</td>
                  <td className="r num"><Monto value={d.entradas} /></td>
                  <td className="r num"><Monto value={d.salidas} /></td>
                  <td className="r"><Rotacion meses={d.mesesInventario} /></td>
                </tr>
              ))}
              {porDim.length > 0 && (
                <tr className="fila-total">
                  <td>Total</td>
                  <td className="r num"><Monto value={kpi.valor} /></td>
                  <td className="r num">100.0%</td>
                  <td className="r num">{formatNumero(kpi.unidades)}</td>
                  <td className="r num">{formatNumero(kpi.items)}</td>
                  <td className="r num"><Monto value={kpi.entradas} /></td>
                  <td className="r num"><Monto value={kpi.salidas} /></td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ fontSize: 12, color: "var(--muted)", borderTop: "1px solid var(--line)" }}>
          Rotación = saldo ÷ salida mensual promedio del año hasta {MES_CORTO[mes]}. Verde hasta 3 meses, ámbar hasta 8, rojo por encima.
          {valorQuieto > 0 && (
            <> Hoy hay <b style={{ color: "var(--bad)" }}><Monto value={valorQuieto} /></b> ({((valorQuieto / kpi.valor) * 100).toFixed(0)}% del inventario)
            en {quietos.length} {DIMENSIONES[dim].toLowerCase()}(s) que rotan por encima de 8 meses o no rotan.</>
          )}
        </div>
      </div>

      {/* Ranking visual */}
      <div style={{ marginBottom: 12 }}>
        <TopRanking
          titulo={`Mayor saldo por ${DIMENSIONES[dim]} · ${MES_CORTO[mes]} ${anio}`}
          items={porDim.slice(0, 20).map((d) => ({
            label: d.label,
            valor: d.valor,
            sub: `${formatNumero(d.unidades)} und · ${d.mesesInventario == null ? "sin rotar" : `${d.mesesInventario.toFixed(1)} meses`}`,
          }))}
          inicial={10}
        />
      </div>

      {/* Ítems de mayor saldo */}
      <div className="card">
        <div className="chart-head">
          Ítems de Mayor Saldo
          <span className="hact">{MES_CORTO[mes]} {anio} · los 60 primeros · &quot;sin salir&quot; = meses sin una sola salida</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Referencia</th><th>Descripción</th><th>Marca</th><th>Inst.</th>
                {detalleBodega && !bodega.length && <th className="r">Bodegas</th>}
                <th className="r">Unidades</th><th className="r">Costo unit.</th>
                <th className="r">Saldo</th><th className="r">Sin salir</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={`${it.instalacion}-${it.item}`}>
                  <td style={{ fontWeight: 600 }}>{it.referencia}</td>
                  <td style={{ whiteSpace: "normal" }}>{it.descripcion}</td>
                  <td style={{ whiteSpace: "normal" }}>{it.marca || "—"}</td>
                  <td>{it.instalacion}</td>
                  {detalleBodega && !bodega.length && <td className="r num">{it.bodegas || "—"}</td>}
                  <td className="r num">{formatNumero(it.unidades)}</td>
                  <td className="r num"><Monto value={it.costoUnit} /></td>
                  <td className="r num" style={{ fontWeight: 600 }}><Monto value={it.valor} /></td>
                  <td className="r">
                    {it.mesesSinSalida >= mes
                      ? <span className="tag t-bad">todo el año</span>
                      : it.mesesSinSalida >= 3
                        ? <span className="tag t-w1">{it.mesesSinSalida} meses</span>
                        : <span className="tag t-ok">{it.mesesSinSalida === 0 ? "este mes" : `${it.mesesSinSalida} mes(es)`}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {kpi.itemsSinCosto > 0 && (
          <div className="card-body" style={{ fontSize: 12, color: "var(--muted)", borderTop: "1px solid var(--line)" }}>
            Hay {formatNumero(kpi.itemsSinCosto)} ítems con {formatNumero(kpi.unidadesSinCosto)} unidades valorizadas en $0.
            La mayoría es aprovechamiento (instalación 106), donde el costo siempre es cero; si aparecen en 101 o 102, sí hay que revisarlos.
          </div>
        )}
      </div>
    </>
  );
}
