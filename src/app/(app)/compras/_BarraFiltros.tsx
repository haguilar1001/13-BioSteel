// Barra de segmentadores del modulo Compras (Año · Mes · Dia · Proveedor ·
// Linea · Tipo de compra · Instalacion). La logica de resolucion vive en
// _filtro.ts, para que las rutas de exportacion puedan reutilizarla sin
// arrastrar JSX.
import { MES_LARGO } from "@/lib/negocio/compras";
import { FiltroAuto } from "../_components/FiltroAuto";
import { MultiSelect, type OpcionMulti } from "../_components/MultiSelect";
import type { ContextoFiltro } from "./_filtro";

export function BarraFiltros({ c, extra }: { c: ContextoFiltro; extra?: React.ReactNode }) {
  const f = c.filtro;
  const opProveedores: OpcionMulti[] = c.proveedores.map((p) => ({ value: p, label: p }));
  const opLineas: OpcionMulti[] = c.lineas.map((l) => ({ value: l, label: l }));
  const opTipos: OpcionMulti[] = c.tipos.map((t) => ({ value: t, label: t }));
  const opInstalaciones: OpcionMulti[] = c.instalaciones.map((i) => ({ value: String(i.valor), label: i.label }));
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

      <label className="flag" style={{ alignSelf: "center" }}>Proveedor:</label>
      <MultiSelect name="prov" options={opProveedores} selected={f.proveedor ?? []} placeholder="Todos" ancho={260} />

      <label className="flag" style={{ alignSelf: "center" }}>Línea:</label>
      <MultiSelect name="linea" options={opLineas} selected={f.linea ?? []} placeholder="Todas" ancho={220} />

      {/* El tipo de compra depende del catálogo de proveedores: si no está
          cargado, el selector se oculta en vez de ofrecer una lista vacía. */}
      {c.tipos.length ? (
        <>
          <label className="flag" style={{ alignSelf: "center" }}>Tipo:</label>
          <MultiSelect name="tipo" options={opTipos} selected={f.tipoCompra ?? []} placeholder="Todos" ancho={200} />
        </>
      ) : null}

      {/* Instalación: sale del catálogo de bodegas, así que solo se ofrece
          si ese catálogo alcanza a ubicar las compras del año. */}
      {c.instalaciones.length ? (
        <>
          <label className="flag" style={{ alignSelf: "center" }}>Instalación:</label>
          <MultiSelect name="inst" options={opInstalaciones} selected={(f.instalacion ?? []).map(String)} placeholder="Todas" ancho={200} />
        </>
      ) : null}

      {extra}
    </FiltroAuto>
  );
}
