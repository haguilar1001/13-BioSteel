// ==========================================================
// SUGERENCIAS DE COMPRA — el agente de reposición.
//
// Cruza tres fuentes que hasta ahora se miraban por separado: lo que el
// bloque quirúrgico PIDIÓ (Pedido), lo que HAY en bodega (InvBalance) y lo que
// YA VIENE en camino (CompraPendiente), y con eso propone qué comprar y
// cuánto. La fórmula completa y sus límites están documentados en
// lib/negocio/reposicion.ts.
//
// La pantalla está armada para que NADA haya que creérselo: los parámetros
// están arriba y se pueden mover, cada fila muestra los tres insumos del
// cálculo (consumo, existencia, en tránsito) al lado del resultado, y el
// pie explica de qué mes salió cada cosa. Una sugerencia de compra que no se
// puede auditar no la firma nadie.
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { formatNumero, formatFecha } from "@/lib/format";
import { Monto } from "../../_components/Monto";
import { FiltroAuto } from "../../_components/FiltroAuto";
import { MultiSelect, type OpcionMulti } from "../../_components/MultiSelect";
import {
  sugerenciaPorProveedor, sugerenciaPorModelo, SIN_MODELO,
  type EstadoRepo, type FilaReposicion,
} from "@/lib/negocio/reposicion";
import { MES_LARGO } from "@/lib/negocio/pedidos";
import { resolverSugerencias, OPCIONES, ESTADOS, type ParamsSugerencias } from "./_params";

/** Cuántas referencias se pintan; el Excel las trae todas. */
const TOPE_FILAS = 300;

const COLOR_ESTADO: Record<EstadoRepo, string> = {
  Agotado: "var(--bad)",
  "Crítico": "var(--w1)",
  Bajo: "var(--az-3)",
  OK: "var(--ok)",
  Exceso: "var(--muted)",
  "Sin consumo": "var(--muted)",
};

const un = (v: number) => formatNumero(Math.round(v * 10) / 10);
const meses = (v: number) => `${v.toString().replace(".", ",")} ${v === 1 ? "mes" : "meses"}`;

function Etiqueta({ estado }: { estado: EstadoRepo }) {
  return (
    <span className="flag" style={{ color: COLOR_ESTADO[estado], fontWeight: 700, whiteSpace: "nowrap" }}>
      <i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 99, background: COLOR_ESTADO[estado], marginRight: 6 }} />
      {estado}
    </span>
  );
}

/** Frase corta que explica por qué la fila está donde está. */
function porQue(f: FilaReposicion): string {
  if (f.estado === "Agotado") return "sin existencia ni pedido en camino";
  if (f.estado === "Crítico") return "por debajo del punto de reorden";
  if (f.estado === "Bajo") return "alcanza, pero no cubre el objetivo";
  if (f.estado === "Exceso") return "cobertura muy por encima del objetivo";
  if (f.estado === "Sin consumo") return "sin consumo en la ventana";
  return "cubierto";
}

export default async function SugerenciasPage({ searchParams }: { searchParams: Promise<ParamsSugerencias> }) {
  await requirePermiso("pedidos.view");
  const c = await resolverSugerencias(await searchParams);

  if (!c) {
    return (
      <div className="card"><div className="card-body">
        <div className="empty">
          Sin pedidos cargados: sin demanda no hay nada que reponer. Súbelos desde{" "}
          <a href="/cargar">Cargar archivos</a> o corre <code>npm run db:pedidos</code>.
        </div>
      </div></div>
    );
  }

  const { resultado: r, visibles, parametros: p, filtro } = c;
  const porProveedor = sugerenciaPorProveedor(r.filas);
  const porModelo = sugerenciaPorModelo(r.filas);
  const primero = r.ventana[0]!, ultimo = r.ventana[r.ventana.length - 1]!;
  const objetivoMeses = p.leadTimeMeses + p.seguridadMeses + p.coberturaMeses;
  const filas = visibles.slice(0, TOPE_FILAS);

  // Cuánto de lo sugerido es material que se compra por procedimiento. Si es
  // la mayoría, la lista no es una orden de compra: es una proyección de
  // consumo, y decirlo cambia por completo cómo se lee la pantalla.
  const valorPorProcedimiento = porModelo
    .filter((m) => m.modelo !== "MAYORITARIO" && m.modelo !== SIN_MODELO)
    .reduce((s, m) => s + m.valor, 0);
  const pctPorProcedimiento = r.resumen.valorSugerido > 0
    ? (valorPorProcedimiento / r.resumen.valorSugerido) * 100 : 0;

  // Enlace para quitar el filtro por defecto. El modelo vacío viaja explícito
  // para que no se vuelva a activar solo al recargar.
  const verTodos = new URLSearchParams(c.query);
  verTodos.set("modelo", "");

  const opProveedores: OpcionMulti[] = c.opciones.proveedores.map((x) => ({ value: x, label: x }));
  const opLineas: OpcionMulti[] = c.opciones.lineas.map((x) => ({ value: x, label: x }));
  const opCiudades: OpcionMulti[] = c.opciones.ciudades.map((x) => ({ value: x, label: x }));
  const opEstados: OpcionMulti[] = ESTADOS.map((e) => ({ value: e, label: e }));

  return (
    <>
      {/* ---------- Parámetros ---------- */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingBottom: 12 }}>
          <div style={{ marginBottom: 10 }}>
            <div className="eyebrow" style={{ fontSize: 15 }}>
              Sugerencias de Compra · consumo de {MES_LARGO[primero.mes]} {primero.anio} a {MES_LARGO[ultimo.mes]} {ultimo.anio}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              Reponer para cubrir <b>{meses(objetivoMeses)}</b> de consumo
              ({meses(p.leadTimeMeses)} de lead time + {meses(p.seguridadMeses)} de seguridad
              + {meses(p.coberturaMeses)} de cobertura)
              {filtro.modeloCompra ? ` · solo ${filtro.modeloCompra}` : ""}
              {filtro.proveedor?.length ? ` · ${filtro.proveedor.join(", ")}` : ""}
            </div>
          </div>

          <FiltroAuto className="toolbar">
            <label className="flag" style={{ alignSelf: "center" }}>Historia:</label>
            <select name="ventana" defaultValue={p.ventanaMeses} className="select" style={{ maxWidth: 120 }}>
              {OPCIONES.ventana.map((v) => <option key={v} value={v}>{v} meses</option>)}
            </select>

            <label className="flag" style={{ alignSelf: "center" }} title="Meses entre poner la orden y recibir el material">Lead time:</label>
            <select name="lead" defaultValue={p.leadTimeMeses} className="select" style={{ maxWidth: 110 }}>
              {OPCIONES.lead.map((v) => <option key={v} value={v}>{meses(v)}</option>)}
            </select>

            <label className="flag" style={{ alignSelf: "center" }} title="Colchón sobre el lead time">Seguridad:</label>
            <select name="seg" defaultValue={p.seguridadMeses} className="select" style={{ maxWidth: 110 }}>
              {OPCIONES.seguridad.map((v) => <option key={v} value={v}>{meses(v)}</option>)}
            </select>

            <label className="flag" style={{ alignSelf: "center" }} title="Meses de consumo que se quiere dejar en bodega">Cobertura:</label>
            <select name="cob" defaultValue={p.coberturaMeses} className="select" style={{ maxWidth: 110 }}>
              {OPCIONES.cobertura.map((v) => <option key={v} value={v}>{meses(v)}</option>)}
            </select>

            <label className="flag" style={{ alignSelf: "center" }}>Modelo:</label>
            <select name="modelo" defaultValue={filtro.modeloCompra ?? ""} className="select" style={{ maxWidth: 180 }}>
              <option value="">Todos</option>
              {c.opciones.modelos.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>

            <label className="flag" style={{ alignSelf: "center" }}>Proveedor:</label>
            <MultiSelect name="prov" options={opProveedores} selected={filtro.proveedor ?? []} placeholder="Todos" ancho={260} />

            <label className="flag" style={{ alignSelf: "center" }}>Línea:</label>
            <MultiSelect name="linea" options={opLineas} selected={filtro.linea ?? []} placeholder="Todas" ancho={200} />

            <label className="flag" style={{ alignSelf: "center" }}>Ciudad:</label>
            <MultiSelect name="ciudad" options={opCiudades} selected={filtro.ciudad ?? []} placeholder="Todas" ancho={170} />

            <label className="flag" style={{ alignSelf: "center" }}>Estado:</label>
            <MultiSelect name="estado" options={opEstados} selected={c.estados} placeholder="A comprar" ancho={150} />

            <label className="flag" style={{ alignSelf: "center", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" name="todo" value="1" defaultChecked={!c.soloAComprar} />
              Ver todas
            </label>

            <a href={`/pedidos/sugerencias/export?${c.query}`} className="btn">⬇️ Excel</a>
          </FiltroAuto>
        </div>
      </div>

      {/* ---------- Lo que hay que comprar ---------- */}
      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi kc k-egreso">
          <div className="klabel">🛒 Compra sugerida</div>
          <div className="kval num"><Monto value={r.resumen.valorSugerido} /></div>
          <div className="ksub flag">{formatNumero(r.resumen.unidades)} unidades</div>
        </div>
        <div className="kpi kc">
          <div className="klabel">🔖 Referencias a comprar</div>
          <div className="kval num">{formatNumero(r.resumen.aComprar)}</div>
          <div className="ksub flag">de {formatNumero(r.resumen.referencias)} con consumo</div>
        </div>
        <div className="kpi kc k-w">
          <div className="klabel">🚨 Agotadas</div>
          <div className="kval num">{formatNumero(r.resumen.agotadas)}</div>
          <div className="ksub flag">{formatNumero(r.resumen.criticas)} bajo el punto de reorden</div>
        </div>
        <div className="kpi kc">
          <div className="klabel">📦 Con exceso</div>
          <div className="kval num">{formatNumero(r.resumen.exceso)}</div>
          <div className="ksub flag">más del doble del objetivo en bodega</div>
        </div>
      </div>

      {/* La pantalla arranca filtrada. Decirlo es obligatorio: una cifra de
          compra que parece el total y no lo es se convierte en una decisión
          equivocada, y el camino de vuelta tiene que estar a un clic. */}
      {c.modeloPorDefecto ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-body" style={{ padding: "10px 14px", fontSize: 12.5, color: "var(--muted)" }}>
            📌 Estás viendo solo <b>MAYORITARIO</b>, que es el material que sí se mantiene en bodega
            y donde el punto de reorden produce una orden de compra que se puede firmar. En PXP y
            consignación se compra por procedimiento: ahí una referencia en cero es lo normal, no una
            alarma. <a href={`/pedidos/sugerencias?${verTodos.toString()}`}>Ver todos los modelos</a>{" "}
            para la proyección completa de consumo.
          </div>
        </div>
      ) : null}

      {/* Advertencia de lectura: el modelo de compra cambia qué significa
          "agotado", y callarlo haría que la cifra grande se lea mal. */}
      {!c.modeloPorDefecto && pctPorProcedimiento > 20 ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-body" style={{ padding: "10px 14px", fontSize: 12.5, color: "var(--muted)" }}>
            ⚠️ <b>Cómo leer esta cifra.</b> El {pctPorProcedimiento.toFixed(0)} % de lo sugerido
            (<Monto value={valorPorProcedimiento} />) es material de bodegas <b>PXP, consignación o
            aprovechamiento</b>, que se compra por procedimiento y no se mantiene en stock: ahí una
            referencia en cero es lo normal, no una alarma, y su &quot;sugerido&quot; es una
            proyección de consumo, no una orden de compra. Para la lista que sí se puede pedir hoy,
            filtra <b>Modelo = MAYORITARIO</b>.
          </div>
        </div>
      ) : null}

      <div className="grid two" style={{ marginBottom: 12, alignItems: "stretch" }}>
        {/* Reparto por modelo de compra. */}
        <div className="card">
          <div className="chart-head">
            Sugerido por Modelo de Compra
            <span className="hact">de dónde saldría el material</span>
          </div>
          <div className="tbl-wrap">
            <table className="tabla-fit">
              <thead>
                <tr><th>Modelo</th><th className="r">Referencias</th><th className="r">Unidades</th><th className="r">$ Sugerido</th><th className="r">%</th></tr>
              </thead>
              <tbody>
                {porModelo.map((m) => (
                  <tr key={m.modelo}>
                    <td style={{ fontWeight: 600 }}>{m.modelo}</td>
                    <td className="r num flag">{formatNumero(m.referencias)}</td>
                    <td className="r num flag">{formatNumero(m.unidades)}</td>
                    <td className="r num"><Monto value={m.valor} /></td>
                    <td className="r num flag">
                      {r.resumen.valorSugerido > 0 ? `${((m.valor / r.resumen.valorSugerido) * 100).toFixed(1).replace(".", ",")} %` : "—"}
                    </td>
                  </tr>
                ))}
                {porModelo.length === 0 ? (
                  <tr><td colSpan={5}><div className="empty">Nada por comprar con estos parámetros.</div></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {/* A quién habría que comprarle. */}
        <div className="card">
          <div className="chart-head">
            Sugerido por Proveedor
            <span className="hact">{formatNumero(porProveedor.length)} proveedores · clic para ordenar</span>
          </div>
          <div className="tbl-wrap" style={{ maxHeight: 320, overflowY: "auto" }}>
            <table className="tabla-fit">
              <thead>
                <tr><th>Proveedor</th><th className="r">Refs</th><th className="r">Unidades</th><th className="r">$ Sugerido</th><th className="r">Agotadas</th></tr>
              </thead>
              <tbody>
                {porProveedor.slice(0, 40).map((x) => (
                  <tr key={x.proveedor}>
                    <td style={{ fontWeight: 600 }}>{x.proveedor}</td>
                    <td className="r num flag">{formatNumero(x.referencias)}</td>
                    <td className="r num flag">{formatNumero(x.unidades)}</td>
                    <td className="r num"><Monto value={x.valor} /></td>
                    <td className="r num" style={{ color: x.agotadas ? "var(--bad)" : undefined, fontWeight: x.agotadas ? 700 : undefined }}>
                      {x.agotadas || "—"}
                    </td>
                  </tr>
                ))}
                {porProveedor.length === 0 ? (
                  <tr><td colSpan={5}><div className="empty">Nada por comprar con estos parámetros.</div></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ---------- Detalle por referencia ---------- */}
      <div className="card">
        <div className="chart-head">
          Detalle por Referencia
          <span className="hact">
            {formatNumero(visibles.length)} referencias
            {visibles.length > TOPE_FILAS ? ` · se muestran las primeras ${TOPE_FILAS}` : ""}
            {" · clic en las columnas para ordenar"}
          </span>
        </div>
        <div className="tbl-wrap">
          <table className="tabla-fit">
            <thead>
              <tr>
                <th>Referencia</th>
                <th>Descripción</th>
                <th>Proveedor</th>
                <th>Modelo</th>
                <th className="r" title="Clasificación ABC por costo consumido">ABC</th>
                <th className="r" title="Unidades pedidas en la ventana">Consumo</th>
                <th className="r" title="Consumo promedio mensual">CPM</th>
                <th className="r" title="Meses de la ventana con algún pedido">Meses</th>
                <th className="r">Existencia</th>
                <th className="r" title="Ordenado al proveedor y sin despachar">En tránsito</th>
                <th className="r" title="Meses de consumo que alcanza el disponible">Cobertura</th>
                <th className="r" title="CPM × (lead time + seguridad)">Reorden</th>
                <th className="r">Sugerido</th>
                <th className="r">$ Sugerido</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.referencia}>
                  <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{f.referencia}</td>
                  <td style={{ maxWidth: 280 }} title={`${f.descripcion}${f.ultimoPedido ? ` · último pedido ${formatFecha(f.ultimoPedido)}` : ""}`}>
                    {f.descripcion || "—"}
                  </td>
                  <td className="flag" style={{ maxWidth: 200 }}>{f.proveedor || "—"}</td>
                  <td className="flag">{f.modelo}</td>
                  <td className="r flag" style={{ fontWeight: 700 }}>{f.clase}</td>
                  <td className="r num flag">{formatNumero(f.consumo)}</td>
                  <td className="r num" data-orden={f.cpm}>{un(f.cpm)}</td>
                  <td className="r num flag" style={{ color: f.mesesConConsumo <= 1 ? "var(--w1)" : undefined }}
                      title={f.mesesConConsumo <= 1 ? "Se pidió en un solo mes: el promedio mensual es poco confiable" : undefined}>
                    {f.mesesConConsumo}{f.mesesConConsumo <= 1 ? " ⚠" : ""}
                  </td>
                  <td className="r num">{formatNumero(f.existencia)}</td>
                  <td className="r num flag">{f.enTransito ? formatNumero(f.enTransito) : "—"}</td>
                  <td className="r num" data-orden={f.cobertura ?? 9999}>
                    {f.cobertura == null ? "—" : `${f.cobertura.toFixed(1).replace(".", ",")} m`}
                  </td>
                  <td className="r num flag" data-orden={f.puntoReorden}>{un(f.puntoReorden)}</td>
                  <td className="r num" style={{ fontWeight: 700, color: f.sugerido > 0 ? "var(--brand)" : undefined }}>
                    {f.sugerido || "—"}
                  </td>
                  <td className="r num">{f.valorSugerido ? <Monto value={f.valorSugerido} /> : "—"}</td>
                  <td title={porQue(f)}><Etiqueta estado={f.estado} /></td>
                </tr>
              ))}
              {filas.length === 0 ? (
                <tr><td colSpan={15}><div className="empty">
                  Nada por comprar con estos parámetros. Marca <b>Ver todas</b> para revisar también
                  lo que está cubierto.
                </div></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* ---------- De dónde salió cada número ---------- */}
        <div className="card-body" style={{ padding: "10px 14px", fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
          <div>
            <b>Cómo se calcula.</b> Consumo promedio mensual = unidades pedidas en la ventana ÷{" "}
            {r.ventana.length} meses. Disponible = existencia + en tránsito. Punto de reorden ={" "}
            CPM × ({p.leadTimeMeses} + {p.seguridadMeses}). Sugerido = CPM × {objetivoMeses} − disponible,
            redondeado hacia arriba y nunca negativo. El $ usa el costo unitario promedio de lo pedido.
          </div>
          <div style={{ marginTop: 4 }}>
            <b>De dónde salen los datos.</b> Consumo: pedidos de {MES_LARGO[primero.mes]} {primero.anio} a{" "}
            {MES_LARGO[ultimo.mes]} {ultimo.anio} (estados cumplido, comprometido y aprobado; los borradores
            no cuentan). Existencia:{" "}
            {r.corteInventario
              ? <>balance de inventario de <b>{MES_LARGO[r.corteInventario.mes]} {r.corteInventario.anio}</b></>
              : <b style={{ color: "var(--bad)" }}>sin balance de inventario cargado — todas las existencias salen en cero</b>}.
            En tránsito:{" "}
            {r.hayTransito
              ? "pendientes por despacho de la última carga"
              : <b style={{ color: "var(--w1)" }}>sin pendientes por despacho cargados — el agente no sabe qué viene en camino</b>}.
          </div>
          <div style={{ marginTop: 4 }}>
            <b>Cuidado con.</b> El lead time es uno solo para todos los proveedores; el colchón de
            seguridad es fijo en meses, no depende de qué tan errática sea la demanda; y{" "}
            {formatNumero(r.resumen.consumoEsporadico)} referencias se pidieron en un solo mes de la
            ventana (van marcadas con ⚠): ahí el promedio mensual dice poco.
            {" "}{formatNumero(r.resumen.sinExistencia)} referencias no tienen ninguna existencia en el
            balance del corte.
          </div>
          {visibles.length > TOPE_FILAS ? (
            <div style={{ marginTop: 4 }}>
              La tabla muestra {TOPE_FILAS} de {formatNumero(visibles.length)} referencias;
              el <a href={`/pedidos/sugerencias/export?${c.query}`}>Excel</a> las trae todas.
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
