// ==========================================================
// Inventario · Novedades (bitácora)
// Historial de compras, bajas, daños, reparaciones, retornos y
// traslados. Las novedades se registran desde la tabla de inventario.
// ==========================================================
import { requirePermiso, requireUsuario } from "@/server/auth-context";
import { puede } from "@/lib/rbac/authorize";
import { formatNumero, formatFechaSello, formatFecha } from "@/lib/format";
import {
  listarNovedades, listarEquipos, catalogos, novedadLabel, novedadIcono, estadoLabel, estadoClase, esHoy,
} from "@/lib/negocio/inventario";
import type { TipoNovedad } from "@prisma/client";
import NuevaNovedadForm from "../NuevaNovedadForm";

const TIPO_TAG: Record<TipoNovedad, string> = {
  compra: "t-ok", ingreso_existente: "t-blue", baja: "t-bad", dano: "t-w1",
  reparacion: "t-w1", retorno_reparacion: "t-ok", traslado: "t-blue",
};

export default async function NovedadesPage() {
  await requirePermiso("inventario.view");
  const usuario = await requireUsuario();
  const puedeGestionar = await puede(usuario, "inventario.manage");
  const [novedades, equipos, cat] = await Promise.all([listarNovedades(), listarEquipos(), catalogos()]);

  const equiposOpc = equipos.map((e) => ({
    id: e.id, etiqueta: `${e.codigo ? `${e.codigo} · ` : ""}${e.categoria} · ${e.marca}`, ciudad: e.ciudad, sedeId: e.sedeId,
    categoria: e.categoria, marca: e.marca,
    items: e.items.map((it) => ({
      id: it.id, descripcion: it.descripcion, tipo: it.tipo, cantidad: it.cantidad, lote: it.lote, estado: it.estado,
    })),
  }));

  const conteo = novedades.reduce<Record<string, number>>((acc, n) => {
    acc[n.tipo] = (acc[n.tipo] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Inventarios</div>
          <h1>Novedades</h1>
          <p>Bitácora de movimientos · {formatNumero(novedades.length)} registros</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <a className="btn" href="/soporte/inventario/hoy" target="_blank" rel="noopener" title="Exportar a PDF las novedades registradas hoy">
            📄 Soportes de hoy
          </a>
          {puedeGestionar && <NuevaNovedadForm equipos={equiposOpc} sedes={cat.sedes} categorias={cat.categorias} marcas={cat.marcas} />}
        </div>
      </div>

      <div className="kpis k5">
        <div className="kpi k-ok">
          <div className="klabel">🆕 Compras</div>
          <div className="kval num">{formatNumero(conteo.compra ?? 0)}</div>
          <div className="ksub"><span className="flag">altas de equipos</span></div>
        </div>
        <div className="kpi k-ingreso">
          <div className="klabel">📦 Ingresos de equipos existentes</div>
          <div className="kval num">{formatNumero(conteo.ingreso_existente ?? 0)}</div>
          <div className="ksub"><span className="flag">ya eran de BioSteel, no son compra nueva</span></div>
        </div>
        <div className="kpi k-w">
          <div className="klabel">🔧 Reparaciones</div>
          <div className="kval num">{formatNumero((conteo.reparacion ?? 0) + (conteo.dano ?? 0))}</div>
          <div className="ksub"><span className="flag">daños y envíos</span></div>
        </div>
        <div className="kpi k-ingreso">
          <div className="klabel">🚚 Traslados</div>
          <div className="kval num">{formatNumero(conteo.traslado ?? 0)}</div>
          <div className="ksub"><span className="flag">entre sedes</span></div>
        </div>
        <div className="kpi k-bad">
          <div className="klabel">🚫 Bajas</div>
          <div className="kval num">{formatNumero(conteo.baja ?? 0)}</div>
          <div className="ksub"><span className="flag">fuera de servicio</span></div>
        </div>
      </div>

      <div className="card">
        <div className="chart-head">Historial de novedades</div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th><th>Novedad</th><th>Equipo</th><th>Ítem</th>
                <th>Detalle</th><th>Estado</th><th>Usuario</th><th>Soporte</th>
              </tr>
            </thead>
            <tbody>
              {novedades.map((n) => (
                <tr key={n.id}>
                  <td className="num flag">
                    {formatFechaSello(n.fecha)}
                    {esHoy(n.fecha) && <span className="tag t-ok" style={{ marginLeft: 6 }}>Hoy</span>}
                  </td>
                  <td><span className={`tag ${TIPO_TAG[n.tipo]}`}>{novedadIcono(n.tipo)} {novedadLabel(n.tipo)}</span></td>
                  <td style={{ fontWeight: 600 }}>{n.equipo}<div className="flag">📍 {n.ciudad}</div></td>
                  <td className="flag">{n.itemDescripcion ?? "Todo el equipo"}</td>
                  <td className="flag">
                    {n.tipo === "traslado" && n.sedeOrigen && n.sedeDestino
                      ? <>{n.sedeOrigen} → <strong>{n.sedeDestino}</strong></>
                      : (n.descripcion ?? "—")}
                    {n.fechaCompraOriginal && <div>Fecha de compra: {formatFecha(n.fechaCompraOriginal)}</div>}
                  </td>
                  <td>
                    {n.estadoNuevo
                      ? <span className={`tag ${estadoClase(n.estadoNuevo)}`}>{estadoLabel(n.estadoNuevo)}</span>
                      : <span className="flag">—</span>}
                  </td>
                  <td className="flag">{n.usuario ?? "—"}</td>
                  <td>
                    <a className="tag t-blue" style={{ textDecoration: "none" }}
                       href={`/soporte/inventario/novedad/${n.id}`} target="_blank" rel="noopener"
                       title="Ver / exportar a PDF el soporte de esta novedad">📄 PDF</a>
                  </td>
                </tr>
              ))}
              {novedades.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>
                  Aún no hay novedades registradas.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
