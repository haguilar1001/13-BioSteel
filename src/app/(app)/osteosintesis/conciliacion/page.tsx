// ==========================================================
// Osteosíntesis · Conciliación — cruza el BALANCE (por instalación) contra
// los MOVIMIENTOS (por bodega) mes a mes. Es la pantalla de control del
// módulo: si un mes no cuadra, el resto de las cifras no son confiables.
//
// Tres niveles: el semáforo por mes, la cadena de saldos (que cada mes cierre
// solo y enlace con el anterior) y, al elegir un mes, el detalle por ítem y
// por bodega para ir a buscar el documento en SIESA.
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { formatNumero } from "@/lib/format";
import { Monto } from "../../_components/Monto";
import { FiltroAuto } from "../../_components/FiltroAuto";
import { MultiSelect, type OpcionMulti } from "../../_components/MultiSelect";
import { listaDe } from "../../_components/filtro-multi";
import {
  aniosConBalance, conciliacion, cadenaDeSaldos, mesesConBalance,
  movimientosPorBodega, diferenciasPorReferencia, totalDiferencias,
  NOMBRE_INSTALACION, INSTALACIONES_CON_MATERIAL, MES_CORTO, UMBRAL,
} from "@/lib/negocio/inventario-osteo";


/** Celda de diferencia: en verde si es cero, en rojo si no. */
function Dif({ valor }: { valor: number }) {
  const cuadra = Math.abs(valor) < UMBRAL;
  return (
    <span className="num" style={{ color: cuadra ? "var(--ok)" : "var(--bad)", fontWeight: cuadra ? 400 : 700 }}>
      {cuadra ? "—" : <Monto value={valor} />}
    </span>
  );
}

export default async function ConciliacionPage({
  searchParams,
}: { searchParams: Promise<{ anio?: string; mes?: string; inst?: string }> }) {
  await requirePermiso("osteo.view");
  const sp = await searchParams;

  const anios = await aniosConBalance();
  if (!anios.length) {
    return (
      <div className="card"><div className="card-body">
        <div className="empty">
          Sin inventario cargado. Corre <code>npm run db:inventario-osteo</code> o
          sube los archivos desde <a href="/cargar">Cargar archivos</a>.
        </div>
      </div></div>
    );
  }

  const anio = sp.anio && anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios[anios.length - 1]!;
  const instalacionesValidas = new Set(INSTALACIONES_CON_MATERIAL.map(String));
  const inst = listaDe(sp.inst, instalacionesValidas).map(Number);
  const [filas, cadena, meses] = await Promise.all([
    conciliacion(anio), cadenaDeSaldos(inst), mesesConBalance(anio),
  ]);
  const opInstalaciones: OpcionMulti[] = INSTALACIONES_CON_MATERIAL.map((i) => ({ value: String(i), label: `${i} · ${NOMBRE_INSTALACION[i]}` }));

  // Mes del detalle: el pedido, o el primero que no cuadre, o ninguno.
  const descuadrados = [...new Set(filas.filter((f) => !f.cuadra && !f.sinBalance).map((f) => f.mes))].sort((a, b) => a - b);
  const mesPedido = sp.mes ? Number(sp.mes) : undefined;
  const mes = mesPedido && meses.includes(mesPedido) ? mesPedido : descuadrados[0];

  const [bodegas, refs, totales] = mes
    ? await Promise.all([movimientosPorBodega(anio, mes), diferenciasPorReferencia(anio, mes), totalDiferencias(anio, mes)])
    : [[], [], { items: 0, peso: 0 }];

  // Resumen del año para los KPIs.
  const mesesOk = meses.filter((m) => !descuadrados.includes(m));
  const difTotal = filas.filter((f) => !f.sinBalance)
    .reduce((a, f) => a + Math.abs(f.difEntradas) + Math.abs(f.difSalidas), 0);
  const enlaceRoto = cadena.filter((c) => c.saltoEnlace != null && Math.abs(c.saltoEnlace) >= UMBRAL);
  const internoRoto = cadena.filter((c) => Math.abs(c.saltoInterno) >= UMBRAL);

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="eyebrow" style={{ fontSize: 15 }}>Conciliación de Inventario · {anio}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              Balance (por instalación) contra Movimientos (por bodega), en costo promedio.
            </div>
          </div>
          <FiltroAuto className="toolbar">
            <label className="flag" style={{ alignSelf: "center" }}>Año:</label>
            <select name="anio" defaultValue={anio} className="select">
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </FiltroAuto>
        </div>
      </div>

      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className={`kpi kc ${mesesOk.length === meses.length ? "k-ok" : "k-w"}`}>
          <div className="klabel">Meses que cuadran</div>
          <div className="kval num">{mesesOk.length} / {meses.length}</div>
        </div>
        <div className={`kpi kc ${difTotal < UMBRAL ? "k-ok" : "k-bad"}`}>
          <div className="klabel">Diferencia acumulada</div>
          <div className="kval num"><Monto value={difTotal} /></div>
        </div>
        <div className={`kpi kc ${internoRoto.length ? "k-bad" : "k-ok"}`}>
          <div className="klabel">Meses que no cierran solos</div>
          <div className="kval num">{internoRoto.length}</div>
        </div>
        <div className={`kpi kc ${enlaceRoto.length ? "k-bad" : "k-ok"}`}>
          <div className="klabel">Saltos en la cadena</div>
          <div className="kval num">{enlaceRoto.length}</div>
        </div>
      </div>

      {/* Semáforo mes × instalación */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-head">
          Balance vs Movimientos <span className="hact">{anio} · diferencia = movimientos − balance</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Mes</th><th>Instalación</th>
                <th className="r">Entradas balance</th><th className="r">Entradas movtos.</th><th className="r">Dif.</th>
                <th className="r">Salidas balance</th><th className="r">Salidas movtos.</th><th className="r">Dif.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <tr><td colSpan={9}><div className="empty">Sin datos para {anio}.</div></td></tr>
              )}
              {filas.map((f) => (
                <tr key={`${f.mes}-${f.instalacion}`} style={mes === f.mes ? { background: "var(--brand-tint)" } : undefined}>
                  <td><a href={`?anio=${anio}&mes=${f.mes}`} style={{ fontWeight: 600 }}>{MES_CORTO[f.mes]}</a></td>
                  <td>{f.instalacion} · {NOMBRE_INSTALACION[f.instalacion] ?? "?"}</td>
                  <td className="r num"><Monto value={f.balEntradas} /></td>
                  <td className="r num"><Monto value={f.movEntradas} /></td>
                  <td className="r"><Dif valor={f.difEntradas} /></td>
                  <td className="r num"><Monto value={f.balSalidas} /></td>
                  <td className="r num"><Monto value={f.movSalidas} /></td>
                  <td className="r"><Dif valor={f.difSalidas} /></td>
                  <td>{f.sinBalance
                    ? <span className="tag t-blue" title="Hay movimientos pero el balance del mes todavía no se ha cargado">sin balance</span>
                    : f.cuadra
                      ? <span className="tag t-ok">cuadra</span>
                      : <span className="tag t-bad">descuadre</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ fontSize: 12, color: "var(--muted)", borderTop: "1px solid var(--line)" }}>
          En la instalación 106 (aprovechamiento) el costo es siempre $0: tiene unidades pero nunca valor, así que sus tres columnas en cero son lo esperado.
          {" "}Si los descuadres de 101 y 102 se compensan entre sí, el problema es una bodega mal clasificada, no un movimiento faltante.
        </div>
      </div>

      {/* Cadena de saldos */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-head">
          Cadena de Saldos
          <span className="hact">
            {inst.length ? inst.map((i) => `${i} · ${NOMBRE_INSTALACION[i]}`).join(", ") : "todas las instalaciones"} · el final de un mes debe ser el inicial del siguiente
          </span>
        </div>
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <FiltroAuto className="toolbar">
            <input type="hidden" name="anio" value={anio} />
            {mes && <input type="hidden" name="mes" value={mes} />}
            <label className="flag" style={{ alignSelf: "center" }}>Instalación:</label>
            <MultiSelect name="inst" options={opInstalaciones} selected={inst.map(String)} placeholder="Todas" />
          </FiltroAuto>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table data-noorden>
            <thead>
              <tr>
                <th>Periodo</th>
                <th className="r">Saldo inicial</th><th className="r">Entradas</th>
                <th className="r">Salidas</th><th className="r">Saldo final</th>
                <th className="r">Variación</th>
                <th className="r">Cierra solo</th><th className="r">Enlaza</th>
              </tr>
            </thead>
            <tbody>
              {cadena.map((c) => (
                <tr key={`${c.anio}-${c.mes}`}>
                  <td style={{ fontWeight: 600 }}>{MES_CORTO[c.mes]} {c.anio}</td>
                  <td className="r num"><Monto value={c.inicial} /></td>
                  <td className="r num"><Monto value={c.entradas} /></td>
                  <td className="r num"><Monto value={c.salidas} /></td>
                  <td className="r num" style={{ fontWeight: 700 }}><Monto value={c.final} /></td>
                  <td className="r num" style={{ fontWeight: 600, color: c.variacion < 0 ? "var(--bad)" : "var(--ok)" }}>
                    {c.variacion >= 0 ? "▲ " : "▼ "}<Monto value={Math.abs(c.variacion)} />
                  </td>
                  <td className="r"><Dif valor={c.saltoInterno} /></td>
                  <td className="r">{c.saltoEnlace == null
                    ? <span style={{ color: "var(--muted)" }}>base</span>
                    : <Dif valor={c.saltoEnlace} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {cadena.length > 1 && (() => {
          const primero = cadena[0]!, ultimo = cadena[cadena.length - 1]!;
          const total = ultimo.final - primero.inicial;
          const pct = primero.inicial > 0 ? (total / primero.inicial) * 100 : 0;
          return (
            <div className="card-body" style={{ fontSize: 12.5, borderTop: "1px solid var(--line)" }}>
              De {MES_CORTO[primero.mes]} {primero.anio} a {MES_CORTO[ultimo.mes]} {ultimo.anio} el inventario
              {total < 0 ? " bajó " : " subió "}
              <b style={{ color: total < 0 ? "var(--bad)" : "var(--ok)" }}><Monto value={Math.abs(total)} /></b>
              {" "}({Math.abs(pct).toFixed(1)}%), de <Monto value={primero.inicial} /> a <Monto value={ultimo.final} />.
            </div>
          );
        })()}
      </div>

      {/* Detalle del mes elegido */}
      {mes && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="chart-head">
              Ítems con diferencia · {MES_CORTO[mes]} {anio}
              <span className="hact">
                {formatNumero(totales.items)} ítem(s) · peso total <Monto value={totales.peso} />
                {totales.items > refs.length ? ` · se muestran los ${refs.length} mayores` : ""}
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Referencia</th><th>Descripción</th><th>Instalación</th>
                    <th className="r">Dif. entradas</th><th className="r">Dif. salidas</th>
                  </tr>
                </thead>
                <tbody>
                  {refs.length === 0 && (
                    <tr><td colSpan={5}><div className="empty">Sin diferencias por ítem en {MES_CORTO[mes]}.</div></td></tr>
                  )}
                  {refs.map((r) => (
                    <tr key={`${r.instalacion}-${r.referencia}`}>
                      <td style={{ fontWeight: 600 }}>{r.referencia}</td>
                      <td style={{ whiteSpace: "normal" }}>{r.descripcion}</td>
                      <td>{r.instalacion} · {NOMBRE_INSTALACION[r.instalacion] ?? "?"}</td>
                      <td className="r"><Dif valor={r.difEntradas} /></td>
                      <td className="r"><Dif valor={r.difSalidas} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="chart-head">
              Movimientos por Bodega · {MES_CORTO[mes]} {anio}
              <span className="hact">para ubicar de qué bodega sale la diferencia</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Bodega</th><th>Ciudad</th><th>Instalación</th><th>Modelo</th>
                    <th className="r">Movtos.</th><th className="r">Entradas</th><th className="r">Salidas</th>
                  </tr>
                </thead>
                <tbody>
                  {bodegas.map((b) => (
                    <tr key={b.codigo}>
                      <td>
                        <span style={{ fontWeight: 600 }}>{b.codigo}</span> · {b.descripcion}
                        {b.inferida && <span className="tag t-w1" style={{ marginLeft: 6 }} title="No venía en el catálogo; la instalación se asignó manualmente">inferida</span>}
                      </td>
                      <td>{b.ciudad || "—"}</td>
                      <td>{b.instalacion} · {NOMBRE_INSTALACION[b.instalacion] ?? "?"}</td>
                      <td>{b.modeloCompra || "—"}</td>
                      <td className="r num">{formatNumero(b.movimientos)}</td>
                      <td className="r num"><Monto value={b.entradas} /></td>
                      <td className="r num"><Monto value={b.salidas} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
