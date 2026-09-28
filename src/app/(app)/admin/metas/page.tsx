// ==========================================================
// Administración · Metas de indicadores — valores que antes estaban escritos
// a mano en el código (p. ej. "meta ≥ 90 %" en Indicadores de Gastos) y que
// el proceso mueve de vez en cuando. Ver metas-indicador.ts.
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { formatFechaHora } from "@/lib/format";
import { listarMetas } from "@/lib/negocio/metas-indicador";
import { guardarMeta, restablecerMetaAction } from "./actions";

export default async function MetasPage() {
  await requirePermiso("parametro.manage");
  const metas = await listarMetas();

  return (
    <div className="card">
      <div className="chart-head">Metas de indicadores</div>
      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p className="flag" style={{ margin: 0 }}>
          Cambia aquí la meta que se compara en cada indicador; no hace falta tocar código ni volver a
          desplegar la app. Una meta sin editar usa su valor por defecto.
        </p>
        {metas.map((m) => (
          <form key={m.clave} action={guardarMeta} className="toolbar" style={{ alignItems: "center", borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <input type="hidden" name="clave" value={m.clave} />
            <div style={{ flex: "1 1 320px", minWidth: 260 }}>
              <div style={{ fontWeight: 700 }}>{m.label}</div>
              <div className="flag" style={{ fontSize: 12 }}>{m.descripcion}</div>
              <div className="flag" style={{ fontSize: 11, marginTop: 2 }}>
                {m.editada
                  ? <>editada{m.actualizadoPor ? ` por ${m.actualizadoPor}` : ""}{m.actualizadoEn ? ` · ${formatFechaHora(m.actualizadoEn)}` : ""} · por defecto {m.porDefecto}{m.sufijo}</>
                  : <>usando el valor por defecto ({m.porDefecto}{m.sufijo})</>}
              </div>
            </div>
            <input type="number" name="valor" step="0.01" min="0" defaultValue={m.valor} className="select" style={{ width: 100 }} required />
            <span className="flag">{m.sufijo}</span>
            <button type="submit" className="btn primary">Guardar</button>
            {m.editada && (
              <button type="submit" formAction={restablecerMetaAction} className="btn" title={`Volver a ${m.porDefecto}${m.sufijo}`}>
                Restablecer
              </button>
            )}
          </form>
        ))}
      </div>
    </div>
  );
}
