// ==========================================================
// Órdenes de Compra — el renglón, que es donde se ve qué se pidió: referencia,
// cantidad, bodega de destino y estado. La cabecera resume el periodo con las
// mismas cifras del informe.
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { formatNumero, formatFecha } from "@/lib/format";
import { Monto } from "../../_components/Monto";
import {
  resumenCompras, detalleOrdenes, ordenesPorEstado,
} from "@/lib/negocio/compras";
import { resolverFiltro, type ParamsCompras } from "../_filtro";
import { BarraFiltros } from "../_BarraFiltros";

const LIMITE = 300;

// Semáforo por estado: cumplido es lo esperado, en elaboración es lo que aún
// no está en firme.
const TONO: Record<string, string> = {
  "Cumplido": "t-ok",
  "Aprobado": "t-blue",
  "Parcial": "t-w1",
  "En elaboración": "t-bad",
};

export default async function OrdenesPage({ searchParams }: { searchParams: Promise<ParamsCompras> }) {
  await requirePermiso("compras.view");
  const c = await resolverFiltro(await searchParams);

  if (!c) {
    return (
      <div className="card"><div className="card-body">
        <div className="empty">Sin compras cargadas. Corre <code>npm run db:compras</code>.</div>
      </div></div>
    );
  }

  const [kpi, filas, estados] = await Promise.all([
    resumenCompras(c.filtro), detalleOrdenes(c.filtro, LIMITE), ordenesPorEstado(c.filtro),
  ]);

  const totalFilas = filas.reduce((s, r) => s + r.valorNeto, 0);
  const recortado = filas.length === LIMITE;

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingBottom: 12 }}>
          <div style={{ marginBottom: 10 }}>
            <div className="eyebrow" style={{ fontSize: 15 }}>Órdenes de Compra · {c.etiqueta}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              {formatNumero(kpi.ordenesCant)} órdenes · {c.filtro.proveedor?.length ? c.filtro.proveedor.join(", ") : "todos los proveedores"}
              {c.filtro.linea?.length ? ` · ${c.filtro.linea.join(", ")}` : ""}
            </div>
          </div>
          <BarraFiltros
            c={c}
            extra={<a href={`/compras/ordenes/export?${c.query}`} className="btn" title="Descargar el detalle de órdenes en Excel">⬇️ Excel</a>}
          />
        </div>
      </div>

      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi kc"><div className="klabel">$ Órdenes de Compra</div><div className="kval num"><Monto value={kpi.ordenes} /></div></div>
        <div className="kpi kc k-ok"><div className="klabel">Cantidad ODC</div><div className="kval num">{formatNumero(kpi.ordenesCant)}</div></div>
        <div className="kpi kc k-w"><div className="klabel">Pendiente por Despacho</div><div className="kval num"><Monto value={kpi.pendiente} /></div></div>
        <div className="kpi kc k-ingreso"><div className="klabel">Entradas por Compras</div><div className="kval num"><Monto value={kpi.entradas} /></div></div>
      </div>

      {estados.length > 1 ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-body" style={{ padding: "10px 14px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span className="flag">Por estado:</span>
            {estados.map((e) => (
              <span key={e.label} className={`tag ${TONO[e.label] ?? "t-blue"}`}>
                {e.label} · <Monto value={e.valor} />
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="chart-head">
          Detalle por renglón
          <span className="hact">
            {recortado ? `${LIMITE} de ${formatNumero(kpi.ordenesCant)} órdenes · ` : ""}
            <Monto value={totalFilas} />
          </span>
        </div>
        <div className="tbl-wrap">
          <table className="tabla-fit">
            <thead>
              <tr>
                <th>Fecha</th><th>Nro orden</th><th>Proveedor</th><th>Bodega</th>
                <th>Referencia</th><th>Descripción</th>
                <th className="r">Cant.</th><th className="r">Valor neto</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((r, i) => (
                <tr key={`${r.nroOrden}-${r.referencia}-${i}`}>
                  <td className="num">{formatFecha(r.fechaOrden)}</td>
                  <td style={{ fontWeight: 600 }}>{r.nroOrden}</td>
                  <td>{r.proveedor || "—"}</td>
                  <td className="flag">{r.bodegaCodigo}{r.bodegaDesc ? ` · ${r.bodegaDesc}` : ""}</td>
                  <td className="num">{r.referencia}</td>
                  <td style={{ fontSize: 12 }}>{r.descItem || "—"}</td>
                  <td className="r num">{formatNumero(r.cantOrdenada)}</td>
                  <td className="r num"><Monto value={r.valorNeto} /></td>
                  <td><span className={`tag ${TONO[r.estado] ?? "t-blue"}`}>{r.estado || "—"}</span></td>
                </tr>
              ))}
              {filas.length === 0 ? (
                <tr><td colSpan={9}><div className="empty">Sin órdenes con estos filtros.</div></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {recortado ? (
          <div className="card-body" style={{ padding: "8px 14px", fontSize: 12, color: "var(--muted)" }}>
            Se muestran los {LIMITE} renglones más recientes. Afina el filtro o descarga el Excel para verlos todos.
          </div>
        ) : null}
      </div>
    </>
  );
}
