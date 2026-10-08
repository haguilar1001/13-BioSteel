// ==========================================================
// Nómina · Empleados — listado detallado del año con búsqueda por texto.
// Por defecto solo el personal ACTIVO (FECHA RETIRO vacía o aún no cumplida).
// Columnas: empleado, empresa, proceso, cargo, ciudad, base, seg. social,
// prestaciones, total mensual y tipo de contrato. Fila de totales.
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { Monto } from "../../_components/Monto";
import { formatFecha } from "@/lib/format";
import { aniosConNomina, empleados, type EstadoEmpleado } from "@/lib/negocio/nomina";
import { FiltroAuto } from "../../_components/FiltroAuto";

export default async function NominaEmpleadosPage({ searchParams }: { searchParams: Promise<{ anio?: string; q?: string; estado?: string }> }) {
  await requirePermiso("cxp.view");
  const sp = await searchParams;

  const anios = await aniosConNomina();
  if (anios.length === 0) {
    return <div className="card"><div className="card-body"><div className="empty">Sin nómina cargada. Corre <code>npm run db:nomina</code>.</div></div></div>;
  }
  const anio = sp.anio && anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios[anios.length - 1]!;
  const q = sp.q?.trim() || undefined;

  const estado: EstadoEmpleado = sp.estado === "retirados" || sp.estado === "todos" ? sp.estado : "activos";
  const filas = await empleados(anio, q, estado);
  const tot = filas.reduce(
    (s, f) => ({
      base: s.base + f.baseSalarial,
      seg: s.seg + f.seguridadSocial,
      prest: s.prest + f.prestaciones,
      total: s.total + f.total,
    }),
    { base: 0, seg: 0, prest: 0, total: 0 },
  );

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div className="eyebrow" style={{ fontSize: 15 }}>Empleados {estado === "activos" ? "activos " : estado === "retirados" ? "retirados " : ""}· {anio} <span className="flag">({filas.length})</span></div>
          <FiltroAuto className="toolbar" role="search">
            <label className="flag" style={{ alignSelf: "center" }}>Año:</label>
            <select name="anio" defaultValue={anio} className="select">
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <label className="flag" style={{ alignSelf: "center" }}>Estado:</label>
            <select name="estado" defaultValue={estado} className="select">
              <option value="activos">Activos</option>
              <option value="retirados">Retirados</option>
              <option value="todos">Todos</option>
            </select>
            <input type="search" name="q" defaultValue={q ?? ""} placeholder="Nombre, cargo, proceso, empresa…" className="select" style={{ minWidth: 240 }} aria-label="Buscar" />
            <button type="submit" className="btn primary">Buscar</button>
            {q ? <a href={`/nomina/empleados?anio=${anio}&estado=${estado}`} className="btn">Limpiar</a> : null}
          </FiltroAuto>
        </div>
      </div>

      <div className="card">
        <div className="tbl-wrap">
          <table className="tabla-fit">
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Empresa</th>
                <th>Proceso</th>
                <th>Cargo</th>
                <th>Ciudad</th>
                <th className="r">Base</th>
                <th className="r">Seg. social</th>
                <th className="r">Prestaciones</th>
                <th className="r">Total mes</th>
                <th>Contrato</th>
                <th>Ingreso</th>
                <th>Retiro</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 ? (
                <tr><td colSpan={12}><div className="empty">Sin resultados{q ? ` para “${q}”` : ""}.</div></td></tr>
              ) : (
                filas.map((f) => (
                  <tr key={`${f.cedula}-${f.empresa}`}>
                    <td style={{ fontWeight: 600 }}>{f.nombre}</td>
                    <td className="flag">{f.empresa}</td>
                    <td>{f.proceso}</td>
                    <td>{f.cargo}</td>
                    <td className="flag">{f.ciudad}</td>
                    <td className="r num"><Monto value={f.baseSalarial} /></td>
                    <td className="r num flag"><Monto value={f.seguridadSocial} /></td>
                    <td className="r num flag"><Monto value={f.prestaciones} /></td>
                    <td className="r num" style={{ fontWeight: 700 }}><Monto value={f.total} /></td>
                    <td className="flag">{f.tipoContrato}</td>
                    <td className="flag">{f.fechaIngreso ? formatFecha(f.fechaIngreso) : "—"}</td>
                    <td className="flag">{f.fechaRetiro ? formatFecha(f.fechaRetiro) : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
            {filas.length > 0 && (
              <tfoot>
                <tr className="fila-total">
                  <td style={{ fontWeight: 800 }} colSpan={5}>Total ({filas.length})</td>
                  <td className="r num" style={{ fontWeight: 800 }}><Monto value={tot.base} /></td>
                  <td className="r num" style={{ fontWeight: 800 }}><Monto value={tot.seg} /></td>
                  <td className="r num" style={{ fontWeight: 800 }}><Monto value={tot.prest} /></td>
                  <td className="r num" style={{ fontWeight: 800 }}><Monto value={tot.total} /></td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  );
}
