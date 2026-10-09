// ==========================================================
// Pendientes por Despacho — lo que se ordenó y el proveedor no ha entregado.
// Se muestra POR PROVEEDOR (cuántas órdenes tiene pendientes cada uno); cada
// proveedor se despliega para ver sus órdenes. El detalle por ítem queda en el Excel.
// A diferencia de las otras vistas, esta es una FOTO: el archivo trae lo que
// seguía pendiente el día de la carga, y lo ya despachado desaparece.
//
// El periodo se filtra por FECHA DE ENTREGA pactada (igual que el tablero),
// que es lo que permite ver el atraso: días vencidos = hoy − fecha de entrega.
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { formatNumero, formatFecha, formatFechaSello } from "@/lib/format";
import { Monto } from "../../_components/Monto";
import { resumenCompras, detallePendientes, corteDePendientes, agruparPendientes } from "@/lib/negocio/compras";
import { resolverFiltro, type ParamsCompras } from "../_filtro";
import { BarraFiltros } from "../_BarraFiltros";

// Tope de renglones leídos para agrupar (el mismo del Excel): sin recortar por orden.
const LIMITE = 20_000;

/** Semáforo de atraso: al día, por vencer o vencido. */
function tonoAtraso(dias: number | null): { clase: string; texto: string } {
  if (dias == null) return { clase: "t-blue", texto: "sin fecha" };
  if (dias > 30) return { clase: "t-bad", texto: `${dias} días vencido` };
  if (dias > 0) return { clase: "t-w1", texto: `${dias} días vencido` };
  if (dias === 0) return { clase: "t-w1", texto: "vence hoy" };
  return { clase: "t-ok", texto: `en ${Math.abs(dias)} días` };
}

export default async function PendientesPage({ searchParams }: { searchParams: Promise<ParamsCompras> }) {
  await requirePermiso("compras.view");
  const c = await resolverFiltro(await searchParams);

  if (!c) {
    return (
      <div className="card"><div className="card-body">
        <div className="empty">Sin compras cargadas. Corre <code>npm run db:compras</code>.</div>
      </div></div>
    );
  }

  const hoy = new Date();
  const [kpi, filas, corte] = await Promise.all([
    resumenCompras(c.filtro), detallePendientes(c.filtro, hoy, LIMITE), corteDePendientes(),
  ]);

  const proveedores = agruparPendientes(filas);
  const totalOrdenes = proveedores.reduce((s, p) => s + p.ordenes.length, 0);
  const ordenesVencidas = proveedores.reduce((s, p) => s + p.ordenesVencidas, 0);
  const valorVencido = proveedores.reduce((s, p) => s + p.valorVencido, 0);
  const valorTotal = proveedores.reduce((s, p) => s + p.valorPendiente, 0);
  const unidades = filas.reduce((s, r) => s + r.cantPendiente, 0);
  const recortado = filas.length === LIMITE;

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingBottom: 12 }}>
          <div style={{ marginBottom: 10 }}>
            <div className="eyebrow" style={{ fontSize: 15 }}>Pendientes por Despacho · {c.etiqueta}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              Foto del inventario pendiente{corte ? ` · cargada el ${formatFechaSello(corte)}` : ""} ·
              el periodo filtra por fecha de entrega pactada
            </div>
          </div>
          <BarraFiltros
            c={c}
            extra={<a href={`/compras/pendientes/export?${c.query}`} className="btn" title="Descargar los pendientes en Excel">⬇️ Excel</a>}
          />
        </div>
      </div>

      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi kc k-w"><div className="klabel">$ Pendiente por Despacho</div><div className="kval num"><Monto value={kpi.pendiente} /></div></div>
        <div className="kpi kc"><div className="klabel">Órdenes pendientes</div><div className="kval num">{formatNumero(totalOrdenes)}</div><div className="ksub flag">{formatNumero(proveedores.length)} proveedores · {formatNumero(unidades)} unidades</div></div>
        <div className="kpi kc k-bad"><div className="klabel">Vencido</div><div className="kval num"><Monto value={valorVencido} /></div><div className="ksub flag">{formatNumero(ordenesVencidas)} órdenes vencidas</div></div>
        <div className="kpi kc k-ok"><div className="klabel">Entradas por Compras</div><div className="kval num"><Monto value={kpi.entradas} /></div></div>
      </div>

      <div className="card">
        <div className="chart-head">
          Pendientes por proveedor · mayor valor primero
          <span className="hact">{formatNumero(proveedores.length)} proveedores · {formatNumero(totalOrdenes)} órdenes · <Monto value={valorTotal} /></span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {proveedores.length === 0 ? (
            <div className="empty">Sin pendientes con estos filtros.</div>
          ) : (
            <>
              <div className="pend-fila pend-cab" aria-hidden="true">
                <span />
                <span>Proveedor</span>
                <span className="r">Órdenes</span>
                <span className="r">Unidades</span>
                <span className="r">$ Pendiente</span>
                <span className="r">Vencidas</span>
                <span className="r">$ Vencido</span>
                <span>Mayor atraso</span>
              </div>
              {proveedores.map((p) => {
                const t = tonoAtraso(p.maxDiasVencido);
                return (
                  <details key={p.proveedor} className="cons-det">
                    <summary className="pend-fila">
                      <span className="cons-chev">▸</span>
                      <span style={{ fontWeight: 600 }} title={p.proveedor}>{p.proveedor}</span>
                      <span className="r num" style={{ fontWeight: 700 }}>{formatNumero(p.ordenes.length)}</span>
                      <span className="r num flag">{formatNumero(p.unidades)}</span>
                      <span className="r num"><Monto value={p.valorPendiente} /></span>
                      <span className="r num">{p.ordenesVencidas ? formatNumero(p.ordenesVencidas) : "—"}</span>
                      <span className="r num">{p.valorVencido ? <Monto value={p.valorVencido} /> : "—"}</span>
                      <span><span className={`tag ${t.clase}`}>{t.texto}</span></span>
                    </summary>
                    <div className="pend-ordenes">
                      <table>
                        <thead>
                          <tr><th>Nro orden</th><th className="r">Renglones</th><th className="r">Unidades</th><th className="r">$ Pendiente</th><th>Entrega</th><th>Atraso</th></tr>
                        </thead>
                        <tbody>
                          {p.ordenes.map((o) => {
                            const to = tonoAtraso(o.diasVencido);
                            return (
                              <tr key={o.nroOrden}>
                                <td style={{ fontWeight: 600 }}>{o.nroOrden}</td>
                                <td className="r num">{formatNumero(o.renglones)}</td>
                                <td className="r num flag">{formatNumero(o.unidades)}</td>
                                <td className="r num"><Monto value={o.valorPendiente} /></td>
                                <td className="num">{o.fechaEntrega ? formatFecha(o.fechaEntrega) : "—"}</td>
                                <td><span className={`tag ${to.clase}`}>{to.texto}</span></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </details>
                );
              })}
            </>
          )}
        </div>
        <div className="card-body" style={{ padding: "8px 14px", fontSize: 12, color: "var(--muted)" }}>
          Haz clic en un proveedor para ver sus órdenes. El detalle por ítem está en el Excel.
          {recortado ? ` Se leyeron los primeros ${formatNumero(LIMITE)} renglones.` : ""}
        </div>
      </div>
    </>
  );
}
