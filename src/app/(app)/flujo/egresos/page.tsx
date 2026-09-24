// Egresos: movimientos de salida con filtros (mes, grupo) y buscador.
// Dos vistas: "Detalle" y "Por proveedor" (total por tercero). Encabezados
// ordenables (asc/desc); el orden se aplica en la consulta y se conserva
// con o sin filtros.
import { requirePermiso } from "@/server/auth-context";
import { puede } from "@/lib/rbac/authorize";
import { formatNumero, formatPorcentaje, formatFecha } from "@/lib/format";
import { Monto } from "../../_components/Monto";
import { listarMovimientos, movimientosPorTercero, listarCategorias, categoriasPorTipo, MESES_LABEL, type CampoOrden, type DirOrden } from "@/lib/negocio/flujo";
import { SelectorCategoria } from "../SelectorCategoria";
import { BotonImprimir } from "../../_components/BotonImprimir";
import { FiltroAuto } from "../../_components/FiltroAuto";
import { MultiSelect, type OpcionMulti } from "../../_components/MultiSelect";
import { listaDe } from "../../_components/filtro-multi";

const ANIO = 2026;
const DEF_DIR: Record<string, DirOrden> = { fecha: "desc", grupo: "asc", tercero: "asc", detalle: "asc", observacion: "asc", valor: "desc", cantidad: "desc" };

export default async function EgresosPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; grupo?: string; q?: string; vista?: string; orden?: string; dir?: string }>;
}) {
  const { usuario } = await requirePermiso("cxp.view");
  const puedeGestionar = await puede(usuario, "flujo.manage");
  const sp = await searchParams;
  const mes = sp.mes && /^\d+$/.test(sp.mes) ? Number(sp.mes) : undefined;
  const q = sp.q;
  const vista = sp.vista === "detalle" ? "detalle" : "proveedor";
  const categorias = await listarCategorias();
  const catsEdit = puedeGestionar ? await categoriasPorTipo("egreso") : [];
  const categoriaId = listaDe(sp.grupo, new Set(categorias.map((c) => String(c.id)))).map(Number);
  const opCategorias: OpcionMulti[] = categorias.map((c) => ({ value: String(c.id), label: c.nombre }));

  const campos = vista === "proveedor" ? ["tercero", "cantidad", "valor"] : ["fecha", "grupo", "tercero", "detalle", "observacion", "valor"];
  const campoDefault = vista === "proveedor" ? "valor" : "fecha";
  const campo = (sp.orden && campos.includes(sp.orden) ? sp.orden : campoDefault) as CampoOrden | "cantidad";
  const dir: DirOrden = sp.dir === "asc" || sp.dir === "desc" ? sp.dir : DEF_DIR[campo] ?? "desc";

  const base = (over: { vista?: string; orden?: string; dir?: string } = {}) => {
    const p = new URLSearchParams();
    if (mes) p.set("mes", String(mes));
    if (categoriaId.length) p.set("grupo", categoriaId.join(","));
    if (q) p.set("q", q);
    const v = over.vista ?? vista;
    if (v === "proveedor") p.set("vista", "proveedor");
    if (over.orden) { p.set("orden", over.orden); p.set("dir", over.dir!); }
    const s = p.toString();
    return `/flujo/egresos${s ? `?${s}` : ""}`;
  };
  // Toda columna ordenable muestra un indicador (⇅ inactiva, ▲/▼ activa).
  const th = (c: string, label: string, alinR = false) => {
    const activo = campo === c;
    const nextDir: DirOrden = activo ? (dir === "asc" ? "desc" : "asc") : (DEF_DIR[c] ?? "desc");
    const ind = activo ? (dir === "asc" ? "▲" : "▼") : "⇅";
    return (
      <th className={alinR ? "r" : undefined}>
        <a href={base({ orden: c, dir: nextDir })} title="Ordenar" style={{ color: "inherit", textDecoration: "none", cursor: "pointer", fontWeight: activo ? 800 : undefined, whiteSpace: "nowrap" }}>
          {label}<span style={{ marginLeft: 4, fontSize: 10, opacity: activo ? 0.9 : 0.4 }}>{ind}</span>
        </a>
      </th>
    );
  };

  const filtros = (
    <FiltroAuto className="toolbar">
      {vista === "proveedor" && <input type="hidden" name="vista" value="proveedor" />}
      {sp.orden && <input type="hidden" name="orden" value={campo} />}
      {sp.orden && <input type="hidden" name="dir" value={dir} />}
      <select name="mes" defaultValue={mes ?? ""} className="select">
        <option value="">Todos los meses</option>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <option key={m} value={m}>{MESES_LABEL[m]}</option>
        ))}
      </select>
      <MultiSelect name="grupo" options={opCategorias} selected={categoriaId.map(String)} placeholder="Todos los grupos" />
      <input type="search" name="q" defaultValue={q ?? ""} placeholder="Tercero, NIT, observación…" className="select" style={{ minWidth: 200 }} />
      <button type="submit" className="btn primary">Filtrar</button>
      <a href={base()} className="btn">Limpiar</a>
      <a href={`/flujo/export?tipo=egreso&anio=${ANIO}${mes ? `&mes=${mes}` : ""}${categoriaId.length ? `&grupo=${categoriaId.join(",")}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className="btn" title="Descargar en Excel el listado filtrado">⬇️ Excel</a>
      <BotonImprimir />
      <span style={{ flex: 1 }} />
      <a href={base({ vista: "detalle" })} className={`btn${vista === "detalle" ? " primary" : ""}`}>Detalle</a>
      <a href={base({ vista: "proveedor" })} className={`btn${vista === "proveedor" ? " primary" : ""}`}>Por proveedor</a>
    </FiltroAuto>
  );

  if (vista === "proveedor") {
    const filasRaw = await movimientosPorTercero("egreso", { anio: ANIO, mes, categoriaId, q });
    const filas = [...filasRaw].sort((a, b) => {
      const s = campo === "tercero" ? a.terceroNombre.localeCompare(b.terceroNombre)
        : campo === "cantidad" ? a.movimientos - b.movimientos
        : a.total - b.total;
      return dir === "asc" ? s : -s;
    });
    const total = filas.reduce((s, f) => s + f.total, 0);
    return (
      <div className="card">
        <div className="chart-head">Egresos {ANIO} · por proveedor <span className="hact">{mes ? MESES_LABEL[mes] : "todos los meses"} · clic en columnas para ordenar</span></div>
        <div className="card-body" style={{ paddingBottom: 0 }}>{filtros}</div>
        <div className="tbl-wrap">
          <table className="tabla-fit">
            <colgroup><col style={{ width: "6%" }} /><col style={{ width: "48%" }} /><col style={{ width: "16%" }} /><col style={{ width: "18%" }} /><col style={{ width: "12%" }} /></colgroup>
            <thead><tr><th>#</th>{th("tercero", "Proveedor")}{th("cantidad", "Movimientos", true)}{th("valor", "Total", true)}<th className="r">% Part.</th></tr></thead>
            <tbody>
              <tr className="fila-total">
                <td></td><td style={{ fontWeight: 800 }}>Total · {formatNumero(filas.length)} proveedor{filas.length === 1 ? "" : "es"}</td>
                <td></td><td className="r num" style={{ fontWeight: 800 }}><Monto value={total} /></td>
                <td className="r num" style={{ fontWeight: 800 }}>{formatPorcentaje(100)}</td>
              </tr>
              {filas.length === 0 ? (
                <tr><td colSpan={5} className="empty">Sin movimientos.</td></tr>
              ) : (
                filas.map((f, i) => (
                  <tr key={f.terceroNombre}>
                    <td className="num flag">{i + 1}</td>
                    <td style={{ fontWeight: 600 }} title={f.terceroNombre}>{f.terceroNombre}</td>
                    <td className="r num">{formatNumero(f.movimientos)}</td>
                    <td className="r num" style={{ fontWeight: 700 }}><Monto value={f.total} /></td>
                    <td className="r num">{total > 0 ? formatPorcentaje((f.total / total) * 100) : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const { filas, total, suma } = await listarMovimientos("egreso", { anio: ANIO, mes, categoriaId, q }, { campo: campo as CampoOrden, dir });

  return (
    <div className="card">
      <div className="chart-head">Egresos {ANIO} <span className="hact">clic en columnas para ordenar</span></div>
      <div className="card-body" style={{ paddingBottom: 0 }}>{filtros}</div>
      <div className="tbl-wrap">
        <table className="tabla-fit">
          <colgroup>
            <col style={{ width: "8%" }} /><col style={{ width: "15%" }} /><col style={{ width: "22%" }} />
            <col style={{ width: "13%" }} /><col style={{ width: "28%" }} /><col style={{ width: "14%" }} />
          </colgroup>
          <thead>
            <tr>{th("fecha", "Fecha")}{th("grupo", "Grupo")}{th("tercero", "Tercero")}{th("detalle", "Detalle")}{th("observacion", "Observación")}{th("valor", "Valor", true)}</tr>
          </thead>
          <tbody>
            <tr className="fila-total">
              <td colSpan={5} style={{ fontWeight: 800 }}>Total · {formatNumero(total)} movimiento{total === 1 ? "" : "s"}{filas.length < total ? ` (mostrando ${formatNumero(filas.length)})` : ""}</td>
              <td className="r num" style={{ fontWeight: 800 }}><Monto value={suma} /></td>
            </tr>
            {filas.length === 0 ? (
              <tr><td colSpan={6} className="empty">Sin movimientos.</td></tr>
            ) : (
              filas.map((m) => (
                <tr key={m.id}>
                  <td className="flag">{formatFecha(m.fecha)}</td>
                  <td title={m.categoria ?? ""}>
                    {puedeGestionar
                      ? <SelectorCategoria movimientoId={m.id} categoriaId={m.categoriaId} categorias={catsEdit} />
                      : (m.categoria ?? "—")}
                  </td>
                  <td style={{ fontWeight: 600 }} title={m.terceroNombre}>{m.terceroNombre}</td>
                  <td className="flag" title={m.detalle ?? ""}>{m.detalle}</td>
                  <td className="flag" title={m.observacion ?? ""}>{m.observacion}</td>
                  <td className="r num" style={{ fontWeight: 700 }}><Monto value={m.valor} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
