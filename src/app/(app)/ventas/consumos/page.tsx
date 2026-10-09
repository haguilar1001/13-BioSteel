// ==========================================================
// Informe de Consumos — indicadores de venta neta, costo, utilidad y
// % Utilidad del período, y ese mismo % desglosado por proveedor (MARCA).
// Todos los filtros (año, mes, lista, proveedor, ciudad, IPS, instalación)
// admiten selección múltiple; cada uno viaja en la URL como valores unidos
// por coma (?marca=A,B,C), igual que ya hacía "meses". Año es la excepción:
// uno solo, porque el resto del informe (KPIs, tabla, listas) se lee "del
// año X" y mezclar dos rompería esa lectura.
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { formatPorcentaje, formatNumero } from "@/lib/format";
import { Monto } from "../../_components/Monto";
import {
  aniosConVenta, mesesConVenta, ipsConVenta, ciudadesDeIps,
  marcasFiltradas, ipsPorMarcaFiltrado, itemsPorMarcaFiltrado,
  listasConVenta, utilidadPorLista, ipsPorLista, itemsPorListaIps, marcasConVenta,
  instalacionesConVenta,
  lineasConVentaItem,
  SIN_LISTA, type FiltroConsumo,
} from "@/lib/negocio/ventas";
import { FiltroAuto } from "../../_components/FiltroAuto";
import { MultiSelect, type OpcionMulti } from "../../_components/MultiSelect";
import { nombreLista } from "@/lib/negocio/listas-precio";

const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const MES_CORTO = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const margen = (venta: number, costo: number) => (venta > 0 ? ((venta - costo) / venta) * 100 : 0);

/** "?marca=A,B,C" → ["A","B","C"], solo los valores que sí existen entre las opciones. */
function listaDe(crudo: string | undefined, validos: Set<string>): string[] {
  if (!crudo) return [];
  return [...new Set(crudo.split(",").map((s) => s.trim()).filter(Boolean))].filter((v) => validos.has(v));
}
type OrdenCol = "marca" | "venta" | "costo" | "utilidad" | "margen";

interface Params {
  anio?: string; mes?: string; orden?: string; dir?: string; vista?: string;
  ips?: string; ciudad?: string; lista?: string; marca?: string; instalacion?: string; linea?: string;
}

export default async function ConsumosPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requirePermiso("cxp.view");
  const sp = await searchParams;

  const anios = await aniosConVenta();
  if (anios.length === 0) {
    return <div className="card"><div className="card-body"><div className="empty">Sin ventas cargadas. Corre <code>npm run db:ventas</code>.</div></div></div>;
  }
  const anio = sp.anio && anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios[anios.length - 1]!;
  const mesesDisp = await mesesConVenta(anio);
  const mesesSet = new Set(mesesDisp.map(String));
  const meses = listaDe(sp.mes, mesesSet).map(Number).sort((a, b) => a - b);
  const mesesQ = meses.length ? meses : undefined;

  // Opciones del filtro: todas SIN filtrar (año/mes aparte), para que elegir
  // una no vacíe al resto de las opciones del propio selector.
  const opcionesIps = await ipsConVenta(anio, mesesQ);
  const ciudades = ciudadesDeIps(opcionesIps);
  const ipsValidas = new Set(opcionesIps.map((o) => o.ips));
  const ipsSel = listaDe(sp.ips, ipsValidas);
  const ciudadesValidas = new Set(ciudades.map((c) => c.ciudad));
  // La ciudad solo aplica si no hay IPS puntuales elegidas (mismo criterio de antes).
  const ciudadSel = ipsSel.length ? [] : listaDe(sp.ciudad, ciudadesValidas);

  const listasDisp = await listasConVenta(anio);
  const listasValidas = new Set([...listasDisp, SIN_LISTA]);
  const listaSel = listaDe(sp.lista, listasValidas);

  const marcasDisp = await marcasConVenta(anio, mesesQ);
  const marcasValidas = new Set(marcasDisp);
  const marcaSel = listaDe(sp.marca, marcasValidas);

  const instalacionesDisp = await instalacionesConVenta(anio, mesesQ);
  const instalacionesValidas = new Set(instalacionesDisp.map((i) => String(i.valor)));
  const instalacionSel = listaDe(sp.instalacion, instalacionesValidas).map(Number);

  const lineasDisp = await lineasConVentaItem(anio, mesesQ);
  const lineaSel = listaDe(sp.linea, new Set(lineasDisp));

  const filtro: FiltroConsumo = {
    anio, meses: mesesQ,
    ips: ipsSel.length ? ipsSel : undefined,
    ciudad: ciudadSel.length ? ciudadSel : undefined,
    lista: listaSel.length ? listaSel : undefined,
    marca: marcaSel.length ? marcaSel : undefined,
    instalacion: instalacionSel.length ? instalacionSel : undefined,
    linea: lineaSel.length ? lineaSel : undefined,
  };

  const [marcasBase, ipsMap, itemsMap, porLista, ipsListaMap, itemsListaMap] = await Promise.all([
    marcasFiltradas(filtro, opcionesIps),
    ipsPorMarcaFiltrado(filtro, opcionesIps),
    itemsPorMarcaFiltrado(filtro, opcionesIps),
    // El desglose por lista ignora el propio filtro de lista: si no, al elegir
    // una quedaría una sola fila y no se podrían comparar entre sí.
    utilidadPorLista({ ...filtro, lista: undefined }, opcionesIps),
    ipsPorLista({ ...filtro, lista: undefined }, opcionesIps),
    itemsPorListaIps({ ...filtro, lista: undefined }, opcionesIps),
  ]);
  const ventaListas = porLista.reduce((a, l) => a + l.valor, 0);
  const hayListas = porLista.some((l) => l.lista !== SIN_LISTA);
  const marcas = marcasBase.map((m) => ({ ...m, ips: ipsMap.get(m.marca) ?? [] }));
  const venta = marcas.reduce((s, m) => s + m.valor, 0);
  const costo = marcas.reduce((s, m) => s + m.costo, 0);
  const sinCiudad = opcionesIps.filter((o) => !o.ciudad);
  const utilidad = venta - costo;
  const maxVenta = marcas.length ? Math.max(...marcas.map((m) => m.valor)) : 1;
  const periodo = meses.length === 1 ? `${MESES[meses[0]!]} ${anio}`
    : meses.length > 1 ? `${meses.map((m) => MES_CORTO[m]).join(", ")} ${anio}`
    : `${anio}`;
  const GRID = "minmax(160px, 2fr) 150px 150px 150px 90px 90px";
  const GRID_ITEM = "minmax(200px, 3fr) 80px 120px 130px 130px 130px 90px";
  const GRID_LISTA = "minmax(200px, 2fr) 140px 130px 130px 100px 100px";
  const GRID_IPSL = "minmax(220px, 3fr) 140px 130px 130px 100px";
  const GRID_ITL = "minmax(240px, 3fr) 70px 120px 130px 120px 90px";
  const TOPE_ITEMS = 50; // ítems mostrados por IPS (los demás se resumen)

  // Orden de proveedores por columna (clic en el encabezado). Por defecto venta desc.
  const ORDENES: OrdenCol[] = ["marca", "venta", "costo", "utilidad", "margen"];
  const orden: OrdenCol = ORDENES.includes(sp.orden as OrdenCol) ? (sp.orden as OrdenCol) : "venta";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const clave = (m: { marca: string; valor: number; costo: number }): number | string =>
    orden === "marca" ? m.marca
      : orden === "venta" ? m.valor
      : orden === "costo" ? m.costo
      : orden === "utilidad" ? m.valor - m.costo
      : margen(m.valor, m.costo);
  marcas.sort((a, b) => {
    const va = clave(a), vb = clave(b);
    const c = typeof va === "string" ? va.localeCompare(vb as string, "es") : (va as number) - (vb as number);
    return dir === "asc" ? c : -c;
  });
  // Vista: desglose por IPS o por Ítem (toggle al nivel de los filtros). Por defecto Ítem.
  const vista: "ips" | "item" = sp.vista === "ips" ? "ips" : "item";
  // Todo lo que filtra viaja en los enlaces de orden y de vista: cambiar de
  // columna o de desglose no puede borrar el filtro que el usuario puso.
  const qsPart = (nombre: string, arr: (string | number)[]) => (arr.length ? `&${nombre}=${encodeURIComponent(arr.join(","))}` : "");
  const filtroQS = `${qsPart("ips", ipsSel)}${qsPart("ciudad", ciudadSel)}${qsPart("lista", listaSel)}${qsPart("marca", marcaSel)}${qsPart("instalacion", instalacionSel)}${qsPart("linea", lineaSel)}`;
  const base = `/ventas/consumos?anio=${anio}${qsPart("mes", meses)}${filtroQS}`;
  const ordenBase = `${base}&vista=${vista}`;
  const linkVista = (v: "ips" | "item") => `${base}&orden=${orden}&dir=${dir}&vista=${v}`;
  const thOrden = (key: OrdenCol, label: string, defDir: "asc" | "desc" = "desc") => {
    const activo = orden === key;
    const nuevaDir = activo ? (dir === "asc" ? "desc" : "asc") : defDir;
    return (
      <a href={`${ordenBase}&orden=${key}&dir=${nuevaDir}`} title="Ordenar" style={{ color: "inherit", textDecoration: "none", cursor: "pointer", whiteSpace: "nowrap" }}>
        {label}{activo ? (dir === "asc" ? " ▲" : " ▼") : ""}
      </a>
    );
  };

  const hayFiltro = meses.length || ipsSel.length || ciudadSel.length || listaSel.length || marcaSel.length || instalacionSel.length || lineaSel.length;

  const opMeses: OpcionMulti[] = mesesDisp.map((m) => ({ value: String(m), label: MESES[m]! }));
  const opListas: OpcionMulti[] = [...listasDisp.map((l) => ({ value: l, label: nombreLista(l) })), { value: SIN_LISTA, label: SIN_LISTA }];
  const opMarcas: OpcionMulti[] = marcasDisp.map((m) => ({ value: m, label: m }));
  const opCiudades: OpcionMulti[] = ciudades.map((c) => ({ value: c.ciudad, label: c.ciudad, sub: `${c.ips} IPS` }));
  const opIps: OpcionMulti[] = opcionesIps.map((o) => ({ value: o.ips, label: o.ips, sub: o.ciudad || undefined }));
  const opLineas: OpcionMulti[] = lineasDisp.map((l) => ({ value: l, label: l }));
  const opInstalaciones: OpcionMulti[] = instalacionesDisp.map((i) => ({ value: String(i.valor), label: i.label }));

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="eyebrow" style={{ fontSize: 15 }}>Informe de Consumos · {periodo} · {marcas.length} proveedores</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              {marcaSel.length ? <>Solo <b>{marcaSel.length === 1 ? marcaSel[0] : `${marcaSel.length} proveedores`}</b> · </> : null}
              {lineaSel.length ? <>Línea <b>{lineaSel.length === 1 ? lineaSel[0] : `${lineaSel.length} líneas`}</b> · </> : null}
              {instalacionSel.length ? <>Instalación <b>{instalacionSel.join(", ")}</b> · </> : null}
              {ipsSel.length ? <>Solo <b>{ipsSel.length === 1 ? ipsSel[0] : `${ipsSel.length} IPS`}</b></>
                : ciudadSel.length ? <>Solo <b>{ciudadSel.length === 1 ? ciudadSel[0] : `${ciudadSel.length} ciudades`}</b></>
                : <>Todas las IPS</>}
            </div>
          </div>
          <FiltroAuto className="toolbar">
            {/* Preserva vista/orden al cambiar cualquier filtro. */}
            <input type="hidden" name="vista" value={vista} />
            <input type="hidden" name="orden" value={orden} />
            <input type="hidden" name="dir" value={dir} />
            <span role="group" aria-label="Ver por" style={{ display: "inline-flex", gap: 4, alignSelf: "center" }}>
              <a href={linkVista("item")} className={`btn ${vista === "item" ? "primary" : ""}`}>Por Ítem</a>
              <a href={linkVista("ips")} className={`btn ${vista === "ips" ? "primary" : ""}`}>Por IPS</a>
            </span>
            <label className="flag" style={{ alignSelf: "center" }}>Año:</label>
            <select name="anio" defaultValue={anio} className="select">
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <label className="flag" style={{ alignSelf: "center" }}>Mes:</label>
            <MultiSelect name="mes" options={opMeses} selected={meses.map(String)} placeholder="Todos" />
            {/* Lista de precios: es la tarifa aplicada al renglón, y lo que
                permite ver qué tarifa deja el ítem en pérdida. Solo aparece
                cuando hay datos con lista cargada. */}
            {hayListas ? (
              <>
                <label className="flag" style={{ alignSelf: "center" }}>Lista:</label>
                <MultiSelect name="lista" options={opListas} selected={listaSel} placeholder="Todas" />
              </>
            ) : null}
            {/* Proveedor (MARCA): acota el informe entero —KPIs, tabla y listas—
                a uno o varios proveedores, para leer su utilidad al detalle. */}
            <label className="flag" style={{ alignSelf: "center" }}>Proveedor:</label>
            <MultiSelect name="marca" options={opMarcas} selected={marcaSel} placeholder="Todos" ancho={280} />
            {/* Instalación: bodega que despachó (101 propio · 102 consignación ·
                104 préstamo · 106 aprovechamiento), deducida contra el mismo
                catálogo de Compras/Osteosíntesis por nombre de bodega. */}
            {opInstalaciones.length ? (
              <>
                <label className="flag" style={{ alignSelf: "center" }}>Instalación:</label>
                <MultiSelect name="instalacion" options={opInstalaciones} selected={instalacionSel.map(String)} placeholder="Todas" ancho={200} />
              </>
            ) : null}
            {/* Línea de producto: acota todo el informe a una o varias líneas. */}
            {opLineas.length ? (
              <>
                <label className="flag" style={{ alignSelf: "center" }}>Línea:</label>
                <MultiSelect name="linea" options={opLineas} selected={lineaSel} placeholder="Todas" ancho={260} />
              </>
            ) : null}
            <label className="flag" style={{ alignSelf: "center" }}>Ciudad:</label>
            <MultiSelect name="ciudad" options={opCiudades} selected={ciudadSel} placeholder="Todas" />
            <label className="flag" style={{ alignSelf: "center" }}>IPS:</label>
            <MultiSelect name="ips" options={opIps} selected={ipsSel} placeholder="Todas" ancho={300} />
            {hayFiltro
              ? <a href={`/ventas/consumos?anio=${anio}&orden=${orden}&dir=${dir}&vista=${vista}`} className="btn">Limpiar filtros</a>
              : null}
          </FiltroAuto>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", marginBottom: 12 }}>
        <div className="card">
          <div className="chart-head">Venta Neta</div>
          <div className="card-body kpi-body"><div className="num kpi-val"><Monto value={venta} /></div></div>
        </div>
        <div className="card">
          <div className="chart-head">Costo</div>
          <div className="card-body kpi-body"><div className="num kpi-val"><Monto value={costo} /></div></div>
        </div>
        <div className="card">
          <div className="chart-head">Utilidad Bruta</div>
          <div className="card-body kpi-body"><div className="num kpi-val"><Monto value={utilidad} /></div></div>
        </div>
        <div className="card">
          <div className="chart-head">% Utilidad</div>
          <div className="card-body kpi-body"><div className="num kpi-val">{formatPorcentaje(margen(venta, costo))}</div></div>
        </div>
      </div>

      {/* % Utilidad por proveedor (MARCA), desplegable por IPS */}
      <div className="card">
        <div className="chart-head">Utilidad por Proveedor <span className="hact">{periodo} · {vista === "item" ? "por ítem" : "por IPS"} · clic en un proveedor para desplegar · clic en las columnas para ordenar</span></div>
        <div style={{ overflowX: "auto" }}>
          {/* Encabezado */}
          <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, alignItems: "center", padding: "8px 12px", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
            <span>{thOrden("marca", "Proveedor (marca)", "asc")}</span>
            <span style={{ textAlign: "right" }}>{thOrden("venta", "Venta neta")}</span>
            <span style={{ textAlign: "right" }}>{thOrden("costo", "Costo")}</span>
            <span style={{ textAlign: "right" }}>{thOrden("utilidad", "Utilidad")}</span>
            <span style={{ textAlign: "right" }}>{thOrden("margen", "% Utilidad")}</span>
            <span />
          </div>
          {marcas.length === 0 ? (
            <div className="empty">Sin datos por proveedor{periodo ? ` en ${periodo}` : ""}.</div>
          ) : (
            marcas.map((m) => {
              const pct = margen(m.valor, m.costo);
              return (
                <details key={m.marca} className="cons-det">
                  <summary>
                    <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, alignItems: "center", padding: "9px 12px" }}>
                      <span style={{ fontWeight: 600 }}><span className="cons-chev">▸</span> {m.marca} <span className="flag">({vista === "ips" ? `${m.ips.length} IPS` : `${itemsMap.get(m.marca)?.length ?? 0} ítems`})</span></span>
                      <span className="num" style={{ textAlign: "right" }}><Monto value={m.valor} /></span>
                      <span className="num flag" style={{ textAlign: "right" }}><Monto value={m.costo} /></span>
                      <span className="num" style={{ textAlign: "right" }}><Monto value={m.valor - m.costo} /></span>
                      <span className="num" style={{ textAlign: "right", fontWeight: 700, color: pct < 0 ? "var(--bad)" : undefined }}>{formatPorcentaje(pct)}</span>
                      <span><div className="rank-bar"><div style={{ width: `${Math.max(2, (m.valor / maxVenta) * 100)}%`, background: "var(--az-2)" }} /></div></span>
                    </div>
                  </summary>
                  {vista === "ips" ? (
                    <div style={{ background: "var(--surface-2, #f6f8fc)", paddingBottom: 4 }}>
                      {m.ips.map((x) => {
                        const p = margen(x.valor, x.costo);
                        return (
                          <div key={x.ips} style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, alignItems: "center", padding: "5px 12px", fontSize: 12.5 }}>
                            <span style={{ paddingLeft: 26 }}>{x.ips}</span>
                            <span className="num" style={{ textAlign: "right" }}><Monto value={x.valor} /></span>
                            <span className="num flag" style={{ textAlign: "right" }}><Monto value={x.costo} /></span>
                            <span className="num" style={{ textAlign: "right" }}><Monto value={x.valor - x.costo} /></span>
                            <span className="num" style={{ textAlign: "right", fontWeight: 600, color: p < 0 ? "var(--bad)" : undefined }}>{formatPorcentaje(p)}</span>
                            <span />
                          </div>
                        );
                      })}
                    </div>
                  ) : (itemsMap.get(m.marca)?.length ?? 0) > 0 ? (
                    <div style={{ background: "var(--surface-2, #f6f8fc)", padding: "2px 12px 12px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: GRID_ITEM, gap: 8, padding: "6px 0 4px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--muted)" }}>
                        <span>Descripción</span>
                        <span style={{ textAlign: "right" }}>Cantidad</span>
                        <span style={{ textAlign: "right" }}>Costo unit.</span>
                        <span style={{ textAlign: "right" }}>Costo total</span>
                        <span style={{ textAlign: "right" }}>Venta neta</span>
                        <span style={{ textAlign: "right" }}>Utilidad</span>
                        <span style={{ textAlign: "right" }}>% Utilidad</span>
                      </div>
                      {itemsMap.get(m.marca)!.map((it, k) => {
                        const pIt = margen(it.valor, it.costo);
                        return (
                          <div key={`${it.referencia}-${k}`} style={{ display: "grid", gridTemplateColumns: GRID_ITEM, gap: 8, alignItems: "start", padding: "5px 0", fontSize: 12, borderTop: "1px solid var(--line)" }}>
                            <span style={{ lineHeight: 1.3 }}><span className="flag" style={{ fontWeight: 700 }}>{it.referencia}</span> {it.descripcion}</span>
                            <span className="num" style={{ textAlign: "right" }}>{formatNumero(it.cantidad)}</span>
                            <span className="num flag" style={{ textAlign: "right" }}><Monto value={it.cantidad > 0 ? it.costo / it.cantidad : 0} /></span>
                            <span className="num" style={{ textAlign: "right" }}><Monto value={it.costo} /></span>
                            <span className="num" style={{ textAlign: "right", fontWeight: 600 }}><Monto value={it.valor} /></span>
                            <span className="num" style={{ textAlign: "right" }}><Monto value={it.valor - it.costo} /></span>
                            <span className="num" style={{ textAlign: "right", fontWeight: 700, color: pIt < 0 ? "var(--bad)" : pIt >= 40 ? "var(--ok)" : undefined }}>
                              {formatPorcentaje(pIt)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flag" style={{ background: "var(--surface-2, #f6f8fc)", padding: "8px 12px 10px", fontSize: 12 }}>Sin ítems para este proveedor en el período.</div>
                  )}
                </details>
              );
            })
          )}
        </div>
        {sinCiudad.length > 0 && (
          <div className="card-body" style={{ fontSize: 12, color: "var(--muted)", borderTop: "1px solid var(--line)" }}>
            El filtro de ciudad sale de la ciudad del tercero. Hay {sinCiudad.length} IPS con venta y sin ciudad
            registrada, así que ninguna ciudad las incluye (sí se pueden escoger una por una):{" "}
            {sinCiudad.map((o) => o.ips).join(" · ")}. Se completa en{" "}
            <a href="/admin/terceros">Administración → Terceros</a>.
          </div>
        )}
      </div>

      {/* Utilidad por Lista de Precios (abajo). Cada fila es un filtro: al
          hacer clic acota todo el informe a esa lista (reemplaza cualquier
          selección múltiple que hubiera arriba, para no confundir dos
          maneras de elegir lista al mismo tiempo). */}
      {hayListas ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="chart-head">
            Utilidad por Lista de Precios
            <span className="hact">{periodo} · {porLista.length} lista{porLista.length > 1 ? "s" : ""} · clic en una lista para desplegar las IPS</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            {/* Encabezado */}
            <div style={{ display: "grid", gridTemplateColumns: GRID_LISTA, gap: 8, alignItems: "center", padding: "8px 12px", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
              <span>Lista de precios</span>
              <span style={{ textAlign: "right" }}>Venta neta</span>
              <span style={{ textAlign: "right" }}>Costo</span>
              <span style={{ textAlign: "right" }}>Utilidad</span>
              <span style={{ textAlign: "right" }}>% Utilidad</span>
              <span style={{ textAlign: "right" }}>% de la venta</span>
            </div>
            {porLista.map((l) => {
              const u = l.valor - l.costo;
              const pct = margen(l.valor, l.costo);
              const activo = listaSel.length === 1 && listaSel[0] === l.lista;
              const href = activo
                ? `${base}&orden=${orden}&dir=${dir}&vista=${vista}`
                : `/ventas/consumos?anio=${anio}${qsPart("mes", meses)}${qsPart("ips", ipsSel)}${qsPart("ciudad", ciudadSel)}${qsPart("marca", marcaSel)}${qsPart("instalacion", instalacionSel)}${qsPart("linea", lineaSel)}&orden=${orden}&dir=${dir}&vista=${vista}&lista=${encodeURIComponent(l.lista)}`;
              const ipsList = ipsListaMap.get(l.lista) ?? [];
              return (
                <details key={l.lista} className="cons-det" open={activo}>
                  <summary>
                    <div style={{ display: "grid", gridTemplateColumns: GRID_LISTA, gap: 8, alignItems: "center", padding: "9px 12px", background: activo ? "var(--brand-tint)" : undefined }}>
                      <span style={{ fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span className="cons-chev">▸</span> {nombreLista(l.lista)}
                        <span className="flag" style={{ fontWeight: 500 }}>({ipsList.length} IPS)</span>
                      </span>
                      <span className="num" style={{ textAlign: "right" }}><Monto value={l.valor} /></span>
                      <span className="num flag" style={{ textAlign: "right" }}><Monto value={l.costo} /></span>
                      <span className="num" style={{ textAlign: "right", fontWeight: 600, color: u < 0 ? "var(--bad)" : undefined }}><Monto value={u} /></span>
                      <span className="num" style={{ textAlign: "right", fontWeight: 700, color: pct < 0 ? "var(--bad)" : pct >= 40 ? "var(--ok)" : undefined }}>{formatPorcentaje(pct)}</span>
                      <span className="num flag" style={{ textAlign: "right" }}>{ventaListas > 0 ? formatPorcentaje((l.valor / ventaListas) * 100) : "—"}</span>
                    </div>
                  </summary>
                  <div style={{ background: "var(--surface-2, #f6f8fc)", padding: "2px 12px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "flex-end", padding: "6px 0" }}>
                      <a href={href} className="btn" style={{ fontSize: 12 }}>{activo ? "✓ Quitar filtro de esta lista" : "Filtrar todo el informe por esta lista"}</a>
                    </div>
                    {ipsList.length === 0 ? <div className="flag" style={{ padding: "4px 0" }}>Sin IPS en el período.</div> : (
                      <>
                        <div style={{ display: "grid", gridTemplateColumns: GRID_IPSL, gap: 8, padding: "4px 0", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--muted)" }}>
                          <span>IPS / cliente</span>
                          <span style={{ textAlign: "right" }}>Venta neta</span>
                          <span style={{ textAlign: "right" }}>Costo</span>
                          <span style={{ textAlign: "right" }}>Utilidad</span>
                          <span style={{ textAlign: "right" }}>% Utilidad</span>
                        </div>
                        {ipsList.map((x) => {
                          const ui = x.valor - x.costo;
                          const pi = margen(x.valor, x.costo);
                          const items = itemsListaMap.get(l.lista)?.get(x.ips) ?? [];
                          return (
                            <details key={x.ips} className="cons-det">
                              <summary>
                                <div style={{ display: "grid", gridTemplateColumns: GRID_IPSL, gap: 8, alignItems: "center", padding: "5px 0", fontSize: 12.5 }}>
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                    <span className="cons-chev" style={{ fontSize: 11 }}>▸</span> {x.ips}
                                    <span className="flag" style={{ fontWeight: 500 }}>({formatNumero(items.length)} ítems)</span>
                                  </span>
                                  <span className="num" style={{ textAlign: "right" }}><Monto value={x.valor} /></span>
                                  <span className="num flag" style={{ textAlign: "right" }}><Monto value={x.costo} /></span>
                                  <span className="num" style={{ textAlign: "right" }}><Monto value={ui} /></span>
                                  <span className="num" style={{ textAlign: "right", fontWeight: 600, color: pi < 0 ? "var(--bad)" : undefined }}>{formatPorcentaje(pi)}</span>
                                </div>
                              </summary>
                              <div style={{ padding: "2px 0 8px 18px" }}>
                                <div style={{ display: "grid", gridTemplateColumns: GRID_ITL, gap: 8, padding: "4px 0", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--muted)" }}>
                                  <span>Referencia / descripción</span>
                                  <span style={{ textAlign: "right" }}>Cant.</span>
                                  <span style={{ textAlign: "right" }}>Costo</span>
                                  <span style={{ textAlign: "right" }}>Venta neta</span>
                                  <span style={{ textAlign: "right" }}>Utilidad</span>
                                  <span style={{ textAlign: "right" }}>% Util.</span>
                                </div>
                                {items.slice(0, TOPE_ITEMS).map((it, k) => {
                                  const uit = it.valor - it.costo;
                                  const pit = margen(it.valor, it.costo);
                                  return (
                                    <div key={`${it.referencia}-${k}`} style={{ display: "grid", gridTemplateColumns: GRID_ITL, gap: 8, alignItems: "start", padding: "4px 0", fontSize: 12, borderTop: "1px solid var(--line)" }}>
                                      <span style={{ lineHeight: 1.3 }}><span className="flag" style={{ fontWeight: 700 }}>{it.referencia}</span> {it.descripcion}</span>
                                      <span className="num" style={{ textAlign: "right" }}>{formatNumero(it.cantidad)}</span>
                                      <span className="num flag" style={{ textAlign: "right" }}><Monto value={it.costo} /></span>
                                      <span className="num" style={{ textAlign: "right", fontWeight: 600 }}><Monto value={it.valor} /></span>
                                      <span className="num" style={{ textAlign: "right" }}><Monto value={uit} /></span>
                                      <span className="num" style={{ textAlign: "right", fontWeight: 700, color: pit < 0 ? "var(--bad)" : pit >= 40 ? "var(--ok)" : undefined }}>{formatPorcentaje(pit)}</span>
                                    </div>
                                  );
                                })}
                                {items.length > TOPE_ITEMS && (
                                  <div className="flag" style={{ padding: "6px 0", fontStyle: "italic" }}>
                                    +{formatNumero(items.length - TOPE_ITEMS)} ítems más (usa los filtros de mes/IPS para acotar).
                                  </div>
                                )}
                              </div>
                            </details>
                          );
                        })}
                      </>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
