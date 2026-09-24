// Barra de segmentadores del módulo Pedidos. La lógica de resolución vive en
// _filtro.ts, para que las rutas de exportación puedan reutilizarla sin
// arrastrar JSX.
import { MES_LARGO } from "@/lib/negocio/pedidos";
import { FiltroAuto } from "../_components/FiltroAuto";
import { MultiSelect, type OpcionMulti } from "../_components/MultiSelect";
import { hayFiltros, type ContextoFiltro } from "./_filtro";

const opcionesDe = (vals: string[]): OpcionMulti[] => vals.map((v) => ({ value: v, label: v }));

export function BarraFiltros({ c, extra }: { c: ContextoFiltro; extra?: React.ReactNode }) {
  const f = c.filtro;
  return (
    <FiltroAuto className="toolbar">
      <label className="flag" style={{ alignSelf: "center" }}>Año:</label>
      <select name="anio" defaultValue={f.anio} className="select">
        {c.anios.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>

      <label className="flag" style={{ alignSelf: "center" }}>Mes:</label>
      <select name="mes" defaultValue={f.mes ?? ""} className="select">
        <option value="">Todos</option>
        {c.meses.map((m) => <option key={m} value={m}>{MES_LARGO[m]}</option>)}
      </select>

      {/* El día solo tiene sentido dentro de un mes; sin mes ni se ofrece. */}
      {f.mes ? (
        <>
          <label className="flag" style={{ alignSelf: "center" }}>Día:</label>
          <select name="dia" defaultValue={f.dia ?? ""} className="select" style={{ maxWidth: 90 }}>
            <option value="">Todos</option>
            {c.dias.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </>
      ) : null}

      <label className="flag" style={{ alignSelf: "center" }}>Ciudad:</label>
      <MultiSelect name="ciudad" options={opcionesDe(c.ciudades)} selected={f.ciudad ?? []} placeholder="Todas" ancho={180} />

      <label className="flag" style={{ alignSelf: "center" }}>Cliente:</label>
      <MultiSelect name="cliente" options={opcionesDe(c.clientes)} selected={f.cliente ?? []} placeholder="Todos" ancho={240} />

      <label className="flag" style={{ alignSelf: "center" }}>Marca:</label>
      <MultiSelect name="marca" options={opcionesDe(c.marcas)} selected={f.marca ?? []} placeholder="Todas" ancho={220} />

      <label className="flag" style={{ alignSelf: "center" }}>Línea:</label>
      <MultiSelect name="linea" options={opcionesDe(c.lineas)} selected={f.linea ?? []} placeholder="Todas" ancho={220} />

      <label className="flag" style={{ alignSelf: "center" }}>Anatomía:</label>
      <MultiSelect name="anatomia" options={opcionesDe(c.anatomias)} selected={f.anatomia ?? []} placeholder="Todas" ancho={200} />

      <label className="flag" style={{ alignSelf: "center" }}>Estado:</label>
      <MultiSelect name="estado" options={opcionesDe(c.estados)} selected={f.estado ?? []} placeholder="Todos" ancho={180} />

      {hayFiltros(c) ? <a href={`?anio=${f.anio}`} className="btn">Limpiar filtros</a> : null}
      {extra}
    </FiltroAuto>
  );
}
