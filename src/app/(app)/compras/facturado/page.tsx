// ==========================================================
// Facturado Proveedor — los documentos CCP de SIESA: lo que el proveedor
// cobró en el periodo, separado entre factura de consignación (el material
// que ya se consumió) y factura de proveedor (compra en firme).
//
// Ojo: este es el facturado según el reporte de compras, y no tiene por qué
// coincidir con Cuentas por Pagar, que se alimenta de otro reporte y lleva
// saldos y vencimientos. Aquí se mide el flujo del periodo, no la deuda.
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { formatNumero, formatFecha } from "@/lib/format";
import { Monto } from "../../_components/Monto";
import { Donut } from "../../_components/charts/Donut";
import { resumenCompras, detalleFacturas, facturadoPorClase } from "@/lib/negocio/compras";
import { resolverFiltro, type ParamsCompras } from "../_filtro";
import { BarraFiltros } from "../_BarraFiltros";

const LIMITE = 300;

const TONO_ESTADO: Record<string, string> = {
  "Aprobado": "t-ok",
  "En elaboración": "t-w1",
  "Anulado": "t-bad",
};

export default async function FacturadoPage({ searchParams }: { searchParams: Promise<ParamsCompras> }) {
  await requirePermiso("compras.view");
  const c = await resolverFiltro(await searchParams);

  if (!c) {
    return (
      <div className="card"><div className="card-body">
        <div className="empty">Sin compras cargadas. Corre <code>npm run db:compras</code>.</div>
      </div></div>
    );
  }

  const [kpi, filas, clases] = await Promise.all([
    resumenCompras(c.filtro), detalleFacturas(c.filtro, LIMITE), facturadoPorClase(c.filtro),
  ]);

  const retenciones = filas.reduce((s, r) => s + r.valorRetenciones, 0);
  const cxp = filas.reduce((s, r) => s + r.valorCxp, 0);
  const recortado = filas.length === LIMITE;

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingBottom: 12 }}>
          <div style={{ marginBottom: 10 }}>
            <div className="eyebrow" style={{ fontSize: 15 }}>Facturado Proveedor · {c.etiqueta}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              Documentos CCP · {c.filtro.proveedor?.length ? c.filtro.proveedor.join(", ") : "todos los proveedores"}
              {c.filtro.instalacion?.length ? " · el filtro de instalación no aplica aquí: el documento CCP es de cabecera y no trae bodega" : ""}
            </div>
          </div>
          <BarraFiltros
            c={c}
            extra={<a href={`/compras/facturado/export?${c.query}`} className="btn" title="Descargar el facturado en Excel">⬇️ Excel</a>}
          />
        </div>
      </div>

      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi kc k-egreso"><div className="klabel">$ Facturado Proveedor</div><div className="kval num"><Monto value={kpi.facturado} /></div></div>
        <div className="kpi kc"><div className="klabel">Cantidad FPP</div><div className="kval num">{formatNumero(kpi.facturadoCant)}</div></div>
        <div className="kpi kc k-w"><div className="klabel">Retenciones</div><div className="kval num"><Monto value={retenciones} /></div><div className="ksub flag">de los {formatNumero(filas.length)} documentos listados</div></div>
        <div className="kpi kc k-ok"><div className="klabel">Neto a pagar (CxP)</div><div className="kval num"><Monto value={cxp} /></div><div className="ksub flag">facturado − retenciones</div></div>
      </div>

      <div className="grid two" style={{ marginBottom: 12, alignItems: "stretch" }}>
        <div className="card">
          <div className="chart-head">
            Detalle de documentos
            <span className="hact">{recortado ? `${LIMITE} más recientes` : `${formatNumero(filas.length)} documentos`}</span>
          </div>
          <div className="tbl-wrap">
            <table className="tabla-fit">
              <thead>
                <tr>
                  <th>Fecha</th><th>Nro documento</th><th>Docto. proveedor</th><th>Proveedor</th>
                  <th>Clase</th><th className="r">Valor neto</th><th className="r">Retenciones</th>
                  <th className="r">CxP</th><th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((r) => (
                  <tr key={r.nroDocumento}>
                    <td className="num">{formatFecha(r.fecha)}</td>
                    <td style={{ fontWeight: 600 }}>{r.nroDocumento}</td>
                    <td className="num">{r.doctoProveedor || "—"}</td>
                    <td>{r.proveedor || "—"}</td>
                    <td className="flag" style={{ fontSize: 12 }}>{r.claseDocto || "—"}</td>
                    <td className="r num"><Monto value={r.valorNeto} /></td>
                    <td className="r num flag">{r.valorRetenciones ? <Monto value={r.valorRetenciones} /> : "—"}</td>
                    <td className="r num"><Monto value={r.valorCxp} /></td>
                    <td><span className={`tag ${TONO_ESTADO[r.estado] ?? "t-blue"}`}>{r.estado || "—"}</span></td>
                  </tr>
                ))}
                {filas.length === 0 ? (
                  <tr><td colSpan={9}><div className="empty">Sin documentos con estos filtros.</div></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="chart-head">Por clase de documento</div>
          <div className="card-body" style={{ display: "flex", justifyContent: "center" }}>
            {clases.length ? (
              <Donut
                size={240}
                azul
                data={clases.map((x) => ({ label: x.label, valor: x.valor }))}
                centro={{ valor: formatNumero(kpi.facturadoCant), etiqueta: "documentos" }}
              />
            ) : <div className="empty">Sin documentos en el periodo.</div>}
          </div>
        </div>
      </div>
    </>
  );
}
