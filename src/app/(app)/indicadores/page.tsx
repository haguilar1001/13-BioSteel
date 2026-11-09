// ==========================================================
// Indicadores Financieros (Contabilidad) — medidores y semáforos.
// Filtro por mes con selección múltiple (suma el período) para los
// indicadores mensuales; los de saldo actual son foto de hoy.
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { alcanceDe } from "@/lib/rbac/authorize";
import { formatCOP, formatCOPCorto, formatPorcentaje, formatNumero } from "@/lib/format";
import { Monto } from "../_components/Monto";
import { calcularIndicadores, type IndicadorCalc } from "@/lib/negocio/indicadores";
import { flujoMensual } from "@/lib/negocio/flujo";
import { ventaPorLinea } from "@/lib/negocio/ventas";
import { mesesConPyg } from "@/lib/negocio/pyg";
import { Medidor } from "../_components/charts/Medidor";
import { Donut } from "../_components/charts/Donut";
import { AccionesDescarga } from "../_components/AccionesDescarga";

const ANIO = 2026;
const MES_ABBR = ["", "ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

function fmtValor(v: number, unidad: IndicadorCalc["unidad"]): string {
  switch (unidad) {
    case "cop": return formatCOP(v);
    case "dias": return `${formatNumero(Math.round(v))} días`;
    case "pct": return formatPorcentaje(v);
    case "veces": return `${v.toFixed(1).replace(".", ",")} veces`;
  }
}

export default async function IndicadoresPage({
  searchParams,
}: {
  searchParams: Promise<{ meses?: string }>;
}) {
  const { usuario } = await requirePermiso("cxp.view");
  const alcanceCartera = await alcanceDe(usuario, "cartera.view");
  const alcInd = alcanceCartera === "ninguno" ? "todos" : alcanceCartera;

  // Meses con datos (para habilitar chips) y default.
  const [meses, pygMeses] = await Promise.all([flujoMensual(ANIO), mesesConPyg(ANIO)]);
  const conDatos = meses.filter((m) => m.ingresos > 0 || m.egresos > 0).map((m) => m.mes);
  const ultimo = conDatos.length ? conDatos[conDatos.length - 1]! : null;
  // Default = último mes con PyG cargado (así los 3 KPIs se ven juntos);
  // si ese mes no tiene flujo o no hay PyG, cae al último mes con movimientos.
  const ultimoPyg = [...pygMeses].reverse().find((m) => conDatos.includes(m)) ?? null;
  const porDefecto = ultimoPyg ?? ultimo;

  // Selección desde la URL (?meses=1,2,3); default = mes de cierre más reciente.
  const sp = await searchParams;
  const pedidos = (sp.meses ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && conDatos.includes(n));
  const seleccion = pedidos.length ? [...new Set(pedidos)].sort((a, b) => a - b)
    : (porDefecto ? [porDefecto] : []);

  const [indicadores, lineas] = await Promise.all([
    calcularIndicadores(usuario, alcInd, seleccion),
    ventaPorLinea(ANIO, seleccion),
  ]);
  const totalLineas = lineas.reduce((s, l) => s + l.valor, 0);
  // El anillo (modo azul) agrupa solo las líneas menores en "Otros menores".
  const donutLineas = lineas.map((l) => ({ label: l.linea.replace(/^\d+\s*-\s*/, ""), valor: l.valor }));

  const cumplen = indicadores.filter((i) => i.cumple === true).length;
  const conDato = indicadores.filter((i) => i.cumple != null).length;

  // Construye el href al alternar (toggle) un mes en la selección.
  const hrefToggle = (m: number) => {
    const set = new Set(seleccion);
    if (set.has(m)) set.delete(m); else set.add(m);
    const arr = [...set].sort((a, b) => a - b);
    return arr.length ? `/indicadores?meses=${arr.join(",")}` : "/indicadores";
  };
  const periodoLabel = seleccion.map((m) => MES_ABBR[m]).join(" · ");
  const excelHref = `/indicadores/export${seleccion.length ? `?meses=${seleccion.join(",")}` : ""}`;

  return (
    <>
      <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <AccionesDescarga excelHref={excelHref} />
      </div>

      {/* Resumen y Período lado a lado para ganar espacio vertical. El título
          del módulo lo pone el layout, que es el que lleva las pestañas. */}
      <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap", marginBottom: 12 }}>
        <div className="card" style={{ marginBottom: 0, flex: "1 1 260px" }}>
          <div className="chart-head">Indicadores Financieros</div>
          <div className="card-body">
            <div className="num kpi-val">{formatNumero(cumplen)} / {formatNumero(conDato)}</div>
            <div className="flag" style={{ marginTop: 2 }}>en meta · corte {ANIO_LABEL()}</div>
          </div>
        </div>

        {/* Filtro por mes (multi-selección) */}
        <div className="card" style={{ marginBottom: 0, flex: "2 1 520px" }}>
        <div className="chart-head">
          Período de los indicadores mensuales
          <span className="hact">{periodoLabel || "sin datos"}{seleccion.length > 1 ? ` · ${seleccion.length} meses (suma)` : ""}</span>
        </div>
        <div className="card-body" style={{ paddingTop: 10, paddingBottom: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {MES_ABBR.slice(1).map((lbl, i) => {
              const m = i + 1;
              const hayDatos = conDatos.includes(m);
              const activo = seleccion.includes(m);
              if (!hayDatos) {
                return (
                  <span key={m} className="mes-chip off" aria-disabled title="Sin movimientos">{lbl}</span>
                );
              }
              return (
                <a key={m} href={hrefToggle(m)} className={`mes-chip${activo ? " on" : ""}`}>{lbl}</a>
              );
            })}
          </div>
          <p className="flag" style={{ marginTop: 8 }}>
            Utilidad (#26) y DSO (#31) se calculan sobre el período seleccionado (suma). Los de saldo actual
            (% cartera vencida, rotación CxP) son foto de hoy y no cambian con el mes.
          </p>
        </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
        {indicadores.map((i) => {
          const color = i.cumple == null ? "var(--muted)" : i.cumple ? "var(--ok)" : "var(--bad)";
          const semaforo = i.cumple == null
            ? <span className="tag t-w1">Sin dato</span>
            : i.cumple ? <span className="tag t-ok">✓ En meta</span> : <span className="tag t-bad">✗ Fuera de meta</span>;
          return (
            <div className="card" key={i.num}>
              <div className="chart-head">
                <span>#{i.num} · {i.nombre}</span>
                <span className="hact">{i.frecuencia}</span>
              </div>
              <div className="card-body">
                {i.pendiente || i.cumplimiento == null ? (
                  <div style={{ height: 112, display: "grid", placeItems: "center", textAlign: "center" }}>
                    <div>
                      <div className="kval num" style={{ fontSize: 26, color: "var(--muted)" }}>—</div>
                      <div className="flag">pendiente de dato</div>
                    </div>
                  </div>
                ) : (
                  <Medidor valor={Math.min(i.cumplimiento, 160)} color={color} size={190} />
                )}

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 }}>
                  <div className="num" style={{ fontSize: 22, fontWeight: 800, color }}>
                    {i.real != null ? fmtValor(i.real, i.unidad) : "—"}
                  </div>
                  {semaforo}
                </div>
                <div className="flag" style={{ marginTop: 4 }}>Meta: {i.metaTexto}</div>
                <div className="flag" style={{ marginTop: 6, fontStyle: "italic" }}>ƒ = {i.formula}</div>
                {i.nota && <div className="flag" style={{ marginTop: 6, color: "var(--muted)" }}>ⓘ {i.nota}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Venta por Línea (período seleccionado) */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="chart-head">
          Venta por Línea
          <span className="hact">{periodoLabel || "sin datos"} · <Monto value={totalLineas} /></span>
        </div>
        <div className="card-body">
          {lineas.length === 0 ? (
            <div className="empty">Sin ventas cargadas. Corre <code>npm run db:ventas</code> para importar el reporte por línea.</div>
          ) : (
            <div className="grid two" style={{ gridTemplateColumns: "300px 1fr", gap: 20, alignItems: "start" }}>
              <div style={{ display: "grid", placeItems: "start center" }}>
                <Donut azul legend size={280} data={donutLineas}
                  centro={{ valor: formatCOP(totalLineas), valorCorto: formatCOPCorto(totalLineas), etiqueta: "venta neta" }} />
              </div>
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr><th>Línea</th><th className="r">Venta neta</th><th className="r">%</th></tr>
                  </thead>
                  <tbody>
                    <tr className="fila-total">
                      <td style={{ fontWeight: 800 }}>Total · {formatNumero(lineas.length)} líneas</td>
                      <td className="r num" style={{ fontWeight: 800 }}><Monto value={totalLineas} /></td>
                      <td className="r num" style={{ fontWeight: 800 }}>{formatPorcentaje(100)}</td>
                    </tr>
                    {lineas.map((l) => (
                      <tr key={l.linea}>
                        <td style={{ fontWeight: 600 }} title={l.linea}>{l.linea}</td>
                        <td className="r num"><Monto value={l.valor} /></td>
                        <td className="r num" style={{ color: "var(--muted)" }}>{formatPorcentaje(totalLineas > 0 ? (l.valor / totalLineas) * 100 : 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ANIO_LABEL() {
  return new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric" }).format(new Date());
}
