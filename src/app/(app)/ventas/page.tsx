// ==========================================================
// Ventas x Mes — informe anual. KPIs (Venta Neta, Costo, Utilidad, %),
// tabla Mes vs Año Anterior con variación, venta por cliente (anillo) y
// venta por mes (barras). Selector de año.
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { formatCOP, formatCOPCorto, formatPorcentaje } from "@/lib/format";
import { Monto } from "../_components/Monto";
import { Donut } from "../_components/charts/Donut";
import { lineasConVenta, ventaPorLinea, nombreLinea, resumenAnual, ventaMensualDetalle, ventaPorCiudad, aniosConVenta, ventaNetaPorDia, clientesConVenta, resumenAnualCliente, ventaMensualDetalleCliente } from "@/lib/negocio/ventas";
import { MapaCartera } from "../_components/charts/MapaCartera";
import { LineasMensuales } from "../_components/charts/LineasMensuales";
import { FiltroAuto } from "../_components/FiltroAuto";
import { MultiSelect, type OpcionMulti } from "../_components/MultiSelect";
import { listaDe } from "../_components/filtro-multi";

const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const MES_ABBR = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const CATS = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)", "var(--cat-4)", "var(--cat-5)", "var(--cat-6)", "var(--cat-7)", "var(--cat-8)"];

export default async function VentasPage({ searchParams }: { searchParams: Promise<{ anio?: string; mes?: string; cliente?: string; linea?: string }> }) {
  await requirePermiso("cxp.view");
  const sp = await searchParams;

  const anios = await aniosConVenta();
  if (anios.length === 0) {
    return <div className="card"><div className="card-body"><div className="empty">Sin ventas cargadas. Corre <code>npm run db:ventas</code>.</div></div></div>;
  }
  const anio = sp.anio && anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios[anios.length - 1]!;

  // Mes seleccionado (1–12) o null = todos los meses del año.
  const mesNum = Number(sp.mes);
  const mesSel = mesNum >= 1 && mesNum <= 12 ? mesNum : null;
  const mesesFiltro = mesSel ? [mesSel] : undefined;

  // Clientes seleccionados (o [] = todos). El filtro afecta KPIs, tabla, líneas y mapa.
  const clientes = await clientesConVenta(anio);
  const cliSel = listaDe(sp.cliente, new Set(clientes));

  // Líneas seleccionadas (o [] = todas). La venta por cliente no trae la línea,
  // así que los dos filtros no se combinan: con un cliente elegido manda el cliente.
  const lineas = await lineasConVenta(anio);
  const linSel = cliSel.length ? [] : listaDe(sp.linea, new Set(lineas));
  const filtraLinea = linSel.length > 0;

  const [kpi, mesesAct, mesesAnt, ciudades, porLinea] = await Promise.all([
    cliSel.length ? resumenAnualCliente(anio, cliSel, mesesFiltro) : resumenAnual(anio, mesesFiltro, linSel),
    cliSel.length ? ventaMensualDetalleCliente(anio, cliSel) : ventaMensualDetalle(anio, linSel),
    cliSel.length ? ventaMensualDetalleCliente(anio - 1, cliSel) : ventaMensualDetalle(anio - 1, linSel),
    ventaPorCiudad(anio, mesesFiltro, cliSel.length ? cliSel : undefined),
    ventaPorLinea(anio, mesesFiltro),
  ]);
  const opLineas: OpcionMulti[] = lineas.map((l) => ({ value: l, label: nombreLinea(l) }));
  const totalLineas = porLinea.reduce((s, l) => s + l.valor, 0) || 1;

  // Meses con venta cargada (para el selector de mes).
  const mesesDisponibles = mesesAct.filter((m) => m.venta > 0).map((m) => m.mes);

  const totalAnt = mesesAnt.reduce((s, m) => s + m.venta, 0);

  // Meses transcurridos: no comparar contra el año anterior los meses que aún
  // no han pasado (evita difs y % engañosos, p. ej. −100 %).
  const hoy = new Date();
  const mesActual = anio < hoy.getUTCFullYear() ? 12 : anio > hoy.getUTCFullYear() ? 0 : hoy.getUTCMonth() + 1;
  const esFuturo = (mes: number) => mes > mesActual;
  const parcial = mesActual >= 1 && mesActual < 12; // año en curso

  // Venta neta por día del mes actual (o del mes filtrado), desde VentaDia.
  // No aplica al filtrar por cliente (VentaDia no tiene desglose por cliente).
  const mesDia = mesSel ?? (mesActual >= 1 ? mesActual : 12);
  const ventaDiaRaw = cliSel.length ? [] : await ventaNetaPorDia(anio, mesDia);
  let accDia = 0;
  const ventaDia = ventaDiaRaw.map((d) => { accDia += d.valor; return { dia: d.dia, venta: d.valor, acumulado: accDia }; });
  const totalDia = accDia;
  // Heat map de la columna Venta: verde más intenso a mayor venta del día.
  const minDia = ventaDia.length ? Math.min(...ventaDia.map((d) => d.venta)) : 0;
  const maxDia = ventaDia.length ? Math.max(...ventaDia.map((d) => d.venta)) : 0;
  const heatVenta = (v: number) => {
    const t = maxDia > minDia ? (v - minDia) / (maxDia - minDia) : 0.5;
    return `color-mix(in srgb, var(--ok) ${Math.round(8 + t * 56)}%, transparent)`;
  };

  // Total comparable: solo meses transcurridos de ambos años.
  let v26c = 0, v25c = 0;
  for (const m of mesesAct) {
    if (esFuturo(m.mes)) continue;
    v26c += m.venta;
    v25c += mesesAnt[m.mes - 1]!.venta;
  }
  const difC = v26c - v25c;
  const varC = v25c > 0 ? (difC / v25c) * 100 : null;

  // Promedio por mes transcurrido (mismos meses en ambos años).
  const nMeses = Math.max(1, mesActual);
  const prom26 = v26c / nMeses;
  const prom25 = v25c / nMeses;
  const difProm = prom26 - prom25;

  // Mapa por ciudad: burbuja por ciudad, color categórico ("Sin ciudad" en gris).
  // detalle = IPS de la ciudad (para el tooltip del mapa).
  let idxCol = 0;
  const colorCiudad = new Map<string, string>();
  for (const c of ciudades) colorCiudad.set(c.ciudad, c.ciudad === "Sin ciudad" ? "var(--muted)" : CATS[idxCol++ % CATS.length]!);
  const mapaData = ciudades.map((c) => ({
    ciudad: c.ciudad,
    valor: c.valor,
    color: colorCiudad.get(c.ciudad)!,
    ips: c.ips.map((i) => ({ cliente: i.nombre, saldo: i.valor })),
  }));
  const totalCiudades = ciudades.reduce((s, c) => s + c.valor, 0) || 1;

  // Series para la gráfica de líneas (año en curso corta en el mes actual).
  const serieActual = mesesAct.map((m) => (esFuturo(m.mes) ? null : m.venta));
  const serieAnterior = mesesAnt.map((m) => m.venta);

  // El eje se corta en el mes en curso, igual que en /compras: dibujar los
  // meses que aún no han pasado dejaba media gráfica vacía a la derecha, con
  // la línea del año anterior corriendo sola. Si hubiera venta más allá del
  // mes actual, se extiende hasta ahí en vez de esconderla.
  const ultimoConVenta = mesesAct.reduce((max, m) => (m.venta ? m.mes : max), 1);
  const hastaMes = anio < hoy.getUTCFullYear() ? 12 : Math.max(mesActual, ultimoConVenta);
  const opClientes: OpcionMulti[] = clientes.map((c) => ({ value: c, label: c }));

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div className="eyebrow" style={{ fontSize: 15 }}>Informe de Ventas · {mesSel ? `${MESES[mesSel]} ` : ""}{anio}{cliSel.length ? ` · ${cliSel.join(", ")}` : ""}{filtraLinea ? ` · ${linSel.map(nombreLinea).join(", ")}` : ""}</div>
          <FiltroAuto className="toolbar">
            <label className="flag" style={{ alignSelf: "center" }}>Año:</label>
            <select name="anio" defaultValue={anio} className="select">
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <label className="flag" style={{ alignSelf: "center" }}>Mes:</label>
            <select name="mes" defaultValue={mesSel ?? ""} className="select">
              <option value="">Todos</option>
              {mesesDisponibles.map((m) => <option key={m} value={m}>{MESES[m]}</option>)}
            </select>
            <label className="flag" style={{ alignSelf: "center" }}>Cliente:</label>
            <MultiSelect name="cliente" options={opClientes} selected={cliSel} placeholder="Todos" ancho={240} />
            <label className="flag" style={{ alignSelf: "center" }}>Línea:</label>
            <MultiSelect name="linea" options={opLineas} selected={linSel} placeholder={cliSel.length ? "Todas (con cliente no aplica)" : "Todas"} ancho={240} />
            <a href={`/ventas/export?anio=${anio}`} className="btn" title="Descargar ventas por mes en Excel">⬇️ Excel</a>
          </FiltroAuto>
        </div>
      </div>

      {/* KPIs — centrados */}
      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi kc"><div className="klabel">Venta Neta</div><div className="kval num"><Monto value={kpi.venta} /></div></div>
        <div className="kpi kc k-egreso"><div className="klabel">Costo</div><div className="kval num"><Monto value={kpi.costo} /></div></div>
        <div className="kpi kc k-ok"><div className="klabel">Utilidad</div><div className="kval num"><Monto value={kpi.utilidad} /></div></div>
        <div className="kpi kc k-w"><div className="klabel">% Utilidad</div><div className="kval num">{formatPorcentaje(kpi.margen)}</div></div>
      </div>

      <div className={cliSel.length ? "grid" : "grid two"} style={{ marginBottom: 12, alignItems: "stretch" }}>
        {/* Tabla Mes vs Año Anterior */}
        <div className="card">
          <div className="chart-head">Ventas · Mes vs Año Anterior <span className="hact">{anio} vs {anio - 1}</span></div>
          <div className="tbl-wrap">
            <table className="tabla-fit">
              <thead><tr><th>Mes</th><th className="r">Venta {anio}</th><th className="r">Venta {anio - 1}</th><th className="r">Dif. $</th><th className="r">% Var.</th></tr></thead>
              <tbody>
                {mesesAct.map((m) => {
                  const ant = mesesAnt[m.mes - 1]!.venta;
                  const futuro = esFuturo(m.mes);
                  const dif = m.venta - ant;
                  const varr = ant > 0 ? (dif / ant) * 100 : null;
                  const vac = m.venta === 0 && ant === 0;
                  if (vac) return null;
                  const colDif = dif >= 0 ? "var(--ok)" : "var(--bad)";
                  return (
                    <tr key={m.mes} style={mesSel === m.mes ? { background: "var(--brand-tint)" } : undefined}>
                      <td style={{ fontWeight: 600 }}>{MESES[m.mes]}</td>
                      <td className="r num">{m.venta ? formatCOP(m.venta) : "—"}</td>
                      <td className="r num flag">{ant ? formatCOP(ant) : "—"}</td>
                      <td className="r num" style={{ fontWeight: 600, color: futuro ? "var(--muted)" : colDif }}>
                        {futuro ? "—" : `${dif >= 0 ? "+" : "−"}${formatCOP(Math.abs(dif))}`}
                      </td>
                      <td className="r num" style={{ fontWeight: 700, color: futuro || varr == null ? "var(--muted)" : varr >= 0 ? "var(--ok)" : "var(--bad)" }}>
                        {futuro || varr == null ? "—" : `${varr >= 0 ? "+" : ""}${formatPorcentaje(varr)}`}
                      </td>
                    </tr>
                  );
                })}
                <tr className="fila-total">
                  <td style={{ fontWeight: 800 }}>Total</td>
                  <td className="r num" style={{ fontWeight: 800 }}><Monto value={kpi.venta} /></td>
                  <td className="r num" style={{ fontWeight: 800 }}><Monto value={totalAnt} /></td>
                  <td className="r num" style={{ fontWeight: 800, color: difC >= 0 ? "var(--ok)" : "var(--bad)" }}>
                    {`${difC >= 0 ? "+" : "−"}${formatCOP(Math.abs(difC))}`}
                  </td>
                  <td className="r num" style={{ fontWeight: 800, color: varC == null ? "var(--muted)" : varC >= 0 ? "var(--ok)" : "var(--bad)" }}>
                    {varC == null ? "—" : `${varC >= 0 ? "+" : ""}${formatPorcentaje(varC)}`}
                  </td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 700, fontStyle: "italic", color: "var(--muted)" }}>Promedio mes ({nMeses})</td>
                  <td className="r num" style={{ fontWeight: 700 }}><Monto value={prom26} /></td>
                  <td className="r num flag"><Monto value={prom25} /></td>
                  <td className="r num" style={{ fontWeight: 700, color: difProm >= 0 ? "var(--ok)" : "var(--bad)" }}>
                    {`${difProm >= 0 ? "+" : "−"}${formatCOP(Math.abs(difProm))}`}
                  </td>
                  <td className="r num" style={{ fontWeight: 700, color: varC == null ? "var(--muted)" : varC >= 0 ? "var(--ok)" : "var(--bad)" }}>
                    {varC == null ? "—" : `${varC >= 0 ? "+" : ""}${formatPorcentaje(varC)}`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {parcial && (
            <p className="flag" style={{ padding: "8px 14px", margin: 0 }}>
              Dif. $ y % Var. comparan solo meses transcurridos (Ene–{MES_ABBR[mesActual]}).
            </p>
          )}
        </div>

        {/* Venta por día del mes actual — no aplica al filtrar por cliente */}
        {!cliSel.length && (
        <div className="card">
          <div className="chart-head">Venta por día <span className="hact">{MESES[mesDia]} {anio}</span></div>
          <div className="tbl-wrap" style={{ maxHeight: 520, overflowY: "auto" }}>
            <table className="tabla-fit">
              <thead><tr><th>Día</th><th className="r">Venta</th><th className="r">Acumulado</th></tr></thead>
              <tbody>
                {ventaDia.length === 0 ? (
                  <tr><td colSpan={3}><div className="empty">Sin facturación en {MESES[mesDia]} {anio}.</div></td></tr>
                ) : (
                  <>
                    {ventaDia.map((d) => (
                      <tr key={d.dia}>
                        <td style={{ fontWeight: 600 }}>{d.dia}</td>
                        <td className="r num" style={{ background: heatVenta(d.venta) }}><Monto value={d.venta} /></td>
                        <td className="r num" style={{ fontWeight: 700 }}><Monto value={d.acumulado} /></td>
                      </tr>
                    ))}
                    <tr className="fila-total">
                      <td style={{ fontWeight: 800 }}>Total</td>
                      <td className="r num" style={{ fontWeight: 800 }}><Monto value={totalDia} /></td>
                      <td></td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
          <p className="flag" style={{ padding: "8px 14px", margin: 0 }}>Venta neta por día (con nota crédito). Cuadra con la venta del mes.</p>
        </div>
        )}
      </div>

      {/* Venta por línea (anillo). Respeta año y mes; con filtro de línea resalta solo las elegidas. */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-head">Venta por Línea <span className="hact">{mesSel ? `${MESES[mesSel]} ` : ""}{anio}</span></div>
        <div className="card-body" style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center", justifyContent: "center" }}>
          {porLinea.length === 0 ? <div className="empty">Sin datos.</div> : (
            <>
              <Donut
                azul
                valores
                lateral
                size={260}
                data={porLinea.filter((l) => l.valor > 0 && (!filtraLinea || linSel.includes(l.linea))).map((l) => ({ label: nombreLinea(l.linea), valor: l.valor }))}
                centro={{ valor: formatCOP(filtraLinea ? kpi.venta : totalLineas), valorCorto: formatCOPCorto(filtraLinea ? kpi.venta : totalLineas), etiqueta: "venta neta" }}
              />
            </>
          )}
        </div>
        {(filtraLinea || cliSel.length > 0) && (
          <p className="flag" style={{ padding: "8px 14px", margin: 0 }}>
            {filtraLinea ? "El filtro de línea aplica a KPIs, tabla y gráfica mensual; la venta por día y por ciudad no traen la línea. " : ""}
            {cliSel.length > 0 ? "Con un cliente elegido el filtro de línea no aplica (la venta por cliente no trae la línea)." : ""}
          </p>
        )}
      </div>

      {/* Venta neta por mes (líneas, más angosta) + Venta por ciudad (mapa) */}
      <div className="grid two" style={{ alignItems: "start" }}>
        <div className="card">
          <div className="chart-head">
            Venta neta por mes
            <span className="hact">
              {hastaMes < 12 ? `Ene–${MES_ABBR[hastaMes]} · ` : ""}{anio} vs {anio - 1}
            </span>
          </div>
          <div className="card-body">
            <LineasMensuales
              categorias={MES_ABBR.slice(1, hastaMes + 1)}
              series={[
                { label: `${anio}`, color: "var(--brand)", data: serieActual.slice(0, hastaMes) },
                { label: `${anio - 1}`, color: "var(--w1)", data: serieAnterior.slice(0, hastaMes), dash: true },
              ]}
            />
          </div>
        </div>

        {/* Venta por ciudad (mapa) */}
        <div className="card">
          <div className="chart-head">Venta por Ciudad <span className="hact">{mesSel ? `${MESES[mesSel]} ` : ""}{anio}</span></div>
          <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mapaData.length === 0 ? <div className="empty">Sin datos.</div> : (
              <>
                <MapaCartera data={mapaData} />
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {ciudades.map((c) => (
                    <div key={c.ciudad} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, padding: "6px 4px", borderTop: "1px solid var(--line)" }}>
                      <i style={{ width: 12, height: 12, borderRadius: 3, background: colorCiudad.get(c.ciudad), flex: "0 0 auto" }} />
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.ciudad}</span>
                      <span className="num" style={{ fontWeight: 700 }}>{formatCOP(c.valor)}</span>
                      <span className="num" style={{ color: "var(--muted)", minWidth: 58, textAlign: "right" }}>{formatPorcentaje((c.valor / totalCiudades) * 100)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
