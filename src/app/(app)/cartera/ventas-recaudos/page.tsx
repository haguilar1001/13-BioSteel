// ==========================================================
// Cartera › Ventas vs Recaudos por cliente (por mes).
//   Ventas   = reporte "Venta por línea" (VentaCliente), neto del mes.
//   Recaudos = ingresos del Flujo de Caja (abonos a cartera) del mes.
// Se cruzan por nombre normalizado (fuentes distintas: puede haber clientes
// que aparezcan en una sola serie).
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { formatCOP, formatNumero } from "@/lib/format";
import { Monto } from "../../_components/Monto";
import { ventaPorCliente, aniosConVenta } from "@/lib/negocio/ventas";
import { movimientosPorTercero, mesesConMovimiento, aniosConMovimiento, nombresInternos, MESES_LABEL } from "@/lib/negocio/flujo";
import { BarrasComparativas, type BarraItem } from "../../_components/charts/BarrasComparativas";
import { FiltroAuto } from "../../_components/FiltroAuto";

/** Normaliza el nombre para cruzar clientes entre fuentes distintas. */
function norm(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // sin tildes
    .replace(/[.,]/g, " ")
    .replace(/\b(S A S|SAS|S A|SA|LTDA|E S E|ESE|IPS|E U|EU)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default async function VentasRecaudosPage({
  searchParams,
}: {
  searchParams: Promise<{ anio?: string; mes?: string }>;
}) {
  await requirePermiso("cartera.view");
  const sp = await searchParams;

  // Años disponibles: los que tienen ventas o recaudos cargados (recientes primero).
  const [aniosVenta, aniosRec] = await Promise.all([aniosConVenta(), aniosConMovimiento("ingreso")]);
  const anios = [...new Set([...aniosVenta, ...aniosRec])].sort((a, b) => b - a);
  const anio = sp.anio && anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios[0] ?? new Date().getFullYear();

  const mesesRec = await mesesConMovimiento(anio, "ingreso");
  const ultimo = mesesRec.length ? mesesRec[mesesRec.length - 1]! : new Date().getMonth() + 1;
  // mes = "all" → año corrido (todos los meses); vacío → último mes con recaudos.
  const todos = sp.mes === "all";
  const mes = todos ? undefined : sp.mes && /^\d+$/.test(sp.mes) ? Number(sp.mes) : ultimo;
  const etiqueta = todos ? `año corrido ${anio}` : `${MESES_LABEL[mes!]} ${anio}`;
  const etiquetaCorta = todos ? `Año ${anio}` : `${MESES_LABEL[mes!]} ${anio}`;

  const [ventas, recaudos, internos] = await Promise.all([
    ventaPorCliente(anio, mes ? [mes] : undefined),
    movimientosPorTercero("ingreso", { anio, mes: mes ? [mes] : undefined }),
    nombresInternos(),
  ]);
  // Excluye internos / partes relacionadas (p.ej. la propia BioSteel).
  const setInterno = new Set(internos.map((n) => norm(n)));

  // Cruce por nombre normalizado.
  const mapa = new Map<string, { label: string; ventas: number; recaudos: number }>();
  // Lo que se deja por fuera se guarda para poder mostrarlo: si no, esta
  // pantalla y /ventas dan cifras distintas y parece un error de datos.
  const excluidos = new Map<string, { label: string; ventas: number; recaudos: number }>();
  for (const v of ventas) {
    const k = norm(v.clienteNombre);
    if (setInterno.has(k)) {
      const e = excluidos.get(k) ?? { label: v.clienteNombre, ventas: 0, recaudos: 0 };
      e.ventas += v.valor; excluidos.set(k, e);
      continue;
    }
    const e = mapa.get(k) ?? { label: v.clienteNombre, ventas: 0, recaudos: 0 };
    e.ventas += v.valor;
    mapa.set(k, e);
  }
  for (const r of recaudos) {
    const k = norm(r.terceroNombre);
    if (setInterno.has(k)) {
      const e = excluidos.get(k) ?? { label: r.terceroNombre, ventas: 0, recaudos: 0 };
      e.recaudos += r.total; excluidos.set(k, e);
      continue;
    }
    const e = mapa.get(k) ?? { label: r.terceroNombre, ventas: 0, recaudos: 0 };
    e.recaudos += r.total;
    // Prefiere un nombre "con letras" legible si el de ventas venía vacío.
    if (!e.ventas) e.label = r.terceroNombre;
    mapa.set(k, e);
  }

  const filas = [...mapa.values()].sort((a, b) => Math.max(b.ventas, b.recaudos) - Math.max(a.ventas, a.recaudos));
  const totVentas = filas.reduce((s, f) => s + f.ventas, 0);
  const totRecaudos = filas.reduce((s, f) => s + f.recaudos, 0);
  const fuera = [...excluidos.values()].filter((e) => e.ventas > 0 || e.recaudos > 0)
    .sort((a, b) => b.ventas - a.ventas);
  const fueraVentas = fuera.reduce((s, f) => s + f.ventas, 0);
  const fueraRecaudos = fuera.reduce((s, f) => s + f.recaudos, 0);

  const items: BarraItem[] = filas
    .filter((f) => f.ventas > 0 || f.recaudos > 0)
    .map((f) => ({ label: f.label, a: f.ventas, b: f.recaudos }));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Cartera</div>
          <h1>Ventas vs Recaudos</h1>
          <p>Por cliente · {etiqueta} · ventas (facturación) contra recaudos (abonos)</p>
        </div>
        <div className="toolbar">
          <a href="/cartera/clientes" className="btn">Por cliente (saldo)</a>
          <a href="/cartera" className="btn">← Facturas</a>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingBottom: 12 }}>
          <FiltroAuto className="toolbar">
            <label className="flag" style={{ alignSelf: "center" }}>Año:</label>
            <select name="anio" defaultValue={anio} className="select">
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <label className="flag" style={{ alignSelf: "center" }}>Mes:</label>
            <select name="mes" defaultValue={todos ? "all" : mes} className="select">
              <option value="all">Todos los meses</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{MESES_LABEL[m]}{mesesRec.includes(m) ? "" : " (sin recaudos)"}</option>
              ))}
            </select>
          </FiltroAuto>
        </div>
      </div>

      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi">
          <div className="klabel">Ventas {todos ? "del año" : "del mes"}</div>
          <div className="kval num" style={{ color: "var(--cat-1)" }}><Monto value={totVentas} /></div>
          <div className="ksub"><span className="flag">facturación neta (por línea)</span></div>
        </div>
        <div className="kpi">
          <div className="klabel">Recaudos {todos ? "del año" : "del mes"}</div>
          <div className="kval num" style={{ color: "var(--cat-3)" }}><Monto value={totRecaudos} /></div>
          <div className="ksub"><span className="flag">abonos a cartera</span></div>
        </div>
        <div className={`kpi ${totRecaudos - totVentas >= 0 ? "k-ok" : "k-w"}`}>
          <div className="klabel">Recaudo − Venta</div>
          <div className="kval num"><Monto value={totRecaudos - totVentas} /></div>
          <div className="ksub"><span className="flag">{totRecaudos >= totVentas ? "se recaudó más de lo vendido" : "se vendió más de lo recaudado"}</span></div>
        </div>
      </div>

      {fuera.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-body" style={{ fontSize: 12.5, color: "var(--muted)" }}>
            Esta pantalla <b>excluye {fuera.length} parte(s) relacionada(s)</b>, por eso su total de ventas no
            coincide con el de <a href={`/ventas?anio=${anio}${mes ? `&mes=${mes}` : ""}`}>Ventas</a>, que las incluye.
            Quedaron por fuera <b><Monto value={fueraVentas} /></b> en ventas
            {fueraRecaudos > 0 && <> y <b><Monto value={fueraRecaudos} /></b> en recaudos</>}:{" "}
            {fuera.map((f, i) => (
              <span key={f.label}>
                {i > 0 && " · "}{f.label} (<Monto value={f.ventas} />)
              </span>
            ))}.
          </div>
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <BarrasComparativas
          titulo={`Ventas vs Recaudos · ${etiquetaCorta}`}
          items={items}
          labelA="Ventas" labelB="Recaudos"
          colorA="var(--cat-1)" colorB="var(--cat-3)"
          inicial={12} step={6}
        />
      </div>

      <div className="card">
        <div className="chart-head">Detalle por cliente <span className="hact">{formatNumero(items.length)} clientes</span></div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr><th>Cliente</th><th className="r">Ventas</th><th className="r">Recaudos</th><th className="r">Recaudo − Venta</th></tr>
            </thead>
            <tbody>
              {items.length > 0 && (
                <tr className="fila-total">
                  <td style={{ fontWeight: 800 }}>Total · {formatNumero(items.length)} clientes</td>
                  <td className="r num" style={{ fontWeight: 800 }}><Monto value={totVentas} /></td>
                  <td className="r num" style={{ fontWeight: 800 }}><Monto value={totRecaudos} /></td>
                  <td className="r num" style={{ fontWeight: 800 }}><Monto value={totRecaudos - totVentas} /></td>
                </tr>
              )}
              {filas.length === 0 ? (
                <tr><td colSpan={4} className="empty">Sin datos para {etiqueta}.</td></tr>
              ) : (
                filas.map((f) => (
                  <tr key={f.label}>
                    <td style={{ fontWeight: 600 }} title={f.label}>{f.label}</td>
                    <td className="r num" style={{ color: "var(--cat-1)" }}>{f.ventas ? formatCOP(f.ventas) : "—"}</td>
                    <td className="r num" style={{ color: "var(--cat-3)" }}>{f.recaudos ? formatCOP(f.recaudos) : "—"}</td>
                    <td className="r num" style={{ fontWeight: 700, color: f.recaudos - f.ventas < 0 ? "var(--w1)" : "var(--ok)" }}><Monto value={f.recaudos - f.ventas} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
