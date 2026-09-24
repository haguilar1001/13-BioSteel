// ==========================================================
// Osteosíntesis · Movimientos — el detalle por documento, con filtros de
// bodega, instalación, tipo de movimiento y proveedor (columna MARCA).
//
// Es la única vista del módulo que tiene BODEGA: el balance mensual solo
// llega hasta instalación, así que el saldo valorizado no se puede abrir por
// bodega, pero el movimiento sí. Por eso el saldo inicial/final de la primera
// fila desaparece en cuanto se elige una bodega: no existe ese dato.
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { formatNumero } from "@/lib/format";
import { Monto } from "../../_components/Monto";
import { FiltroAuto } from "../../_components/FiltroAuto";
import { MultiSelect, type OpcionMulti } from "../../_components/MultiSelect";
import { listaDe } from "../../_components/filtro-multi";
import {
  aniosConMovimientos, mesesConMovimientos, bodegas, marcasConMovimientos,
  resumenMovimientos, movimientosPorTipo, movimientosPorBodegaFiltrado, detalleMovimientos,
  saldoDelPeriodo, mesesConBodega, bodegasConSaldo,
  NOMBRE_INSTALACION, INSTALACIONES_CON_MATERIAL, MES_CORTO, type FiltroMovimientos,
} from "@/lib/negocio/inventario-osteo";

const MES_LARGO = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const LIMITE = 300;

export default async function MovimientosPage({
  searchParams,
}: { searchParams: Promise<{ anio?: string; mes?: string; bodega?: string; inst?: string; tipo?: string; marca?: string }> }) {
  await requirePermiso("osteo.view");
  const sp = await searchParams;

  const anios = await aniosConMovimientos();
  if (!anios.length) {
    return (
      <div className="card"><div className="card-body">
        <div className="empty">Sin movimientos cargados. Corre <code>npm run db:inventario-osteo</code>.</div>
      </div></div>
    );
  }

  const anio = sp.anio && anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios[anios.length - 1]!;
  const meses = await mesesConMovimientos(anio);
  const mes = listaDe(sp.mes, new Set(meses.map(String))).map(Number);
  const catalogo = await bodegas();
  const bodegasValidas = new Set(catalogo.map((b) => b.codigo));
  const bodega = listaDe(sp.bodega, bodegasValidas);
  const instalacionesValidas = new Set(INSTALACIONES_CON_MATERIAL.map(String));
  const instalacion = listaDe(sp.inst, instalacionesValidas).map(Number);
  const marcas = await marcasConMovimientos(anio);
  const marcasValidas = new Set(marcas);
  const marca = listaDe(sp.marca, marcasValidas);

  const filtro: FiltroMovimientos = { anio, mes, bodega, instalacion, tipoDoc: [], marca };
  // Opciones de tipo de documento: sin el propio filtro de tipo, para que
  // elegir uno no le borre las demás opciones al selector (mismo criterio de Consumos).
  const tiposOpciones = await movimientosPorTipo(filtro);
  const tiposValidos = new Set(tiposOpciones.map((t) => t.tipoDoc));
  const tipoDoc = listaDe(sp.tipo, tiposValidos);
  filtro.tipoDoc = tipoDoc;

  const [kpi, tipos, porBodega, detalle, saldo] = await Promise.all([
    resumenMovimientos(filtro),
    tipoDoc.length ? movimientosPorTipo(filtro) : Promise.resolve(tiposOpciones),
    movimientosPorBodegaFiltrado(filtro),
    detalleMovimientos(filtro, LIMITE),
    saldoDelPeriodo(filtro),
  ]);

  // Saldo por bodega: solo existe en los meses cargados con el export nuevo
  // (el viejo llegaba hasta instalación). Se toma el mes filtrado si tiene
  // detalle, y si no el último del año que sí lo tenga, diciéndolo en pantalla.
  // El NETO en cambio siempre se puede: sale del propio movimiento.
  const mesesBodega = await mesesConBodega(anio);
  // Con varios meses elegidos se muestra el saldo del más reciente que sí
  // tenga detalle por bodega (el saldo es un corte, no algo que se sume).
  const mesSaldo = mes.length
    ? [...mesesBodega].filter((m) => mes.includes(m)).pop()
    : mesesBodega[mesesBodega.length - 1];
  const saldoBodega = new Map<string, number>();
  if (mesSaldo) {
    for (const b of await bodegasConSaldo(anio, mesSaldo)) {
      if (instalacion.length && !instalacion.includes(b.instalacion)) continue;
      saldoBodega.set(b.codigo, b.valor);
    }
  }

  const bodegaSel = bodega.length === 1 ? catalogo.find((b) => b.codigo === bodega[0]) : undefined;
  const etiqueta = mes.length === 1 ? `${MES_LARGO[mes[0]!]} ${anio}`
    : mes.length > 1 ? `${mes.map((m) => MES_CORTO[m]).join(", ")} ${anio}`
    : `${anio}`;
  const neto = kpi.costoEntradas - kpi.costoSalidas;

  // El saldo sale del balance, que va por su propio calendario: si el mes
  // pedido aún no está cargado, se dice qué corte se está mostrando.
  const rangoSaldo = saldo.disponible
    ? (saldo.mesInicial === saldo.mesFinal
        ? `corte ${MES_LARGO[saldo.mesFinal]}`
        : `${MES_CORTO[saldo.mesInicial]}–${MES_CORTO[saldo.mesFinal]}`)
    : "";
  const notaSaldo = saldo.motivo === "bodega"
    ? "mes sin detalle por bodega"
    : saldo.motivo === "sin-balance" ? "balance no cargado" : "";

  // El balance suele ir un mes atrás del movimiento: si el saldo no alcanza
  // el último mes con movimientos, inicial + entradas − salidas no da el final.
  const ultimoMov = meses[meses.length - 1] ?? 0;
  const saldoRezagado = saldo.disponible && saldo.mesFinal < ultimoMov;

  const opMeses: OpcionMulti[] = meses.map((m) => ({ value: String(m), label: MES_LARGO[m]! }));
  const opBodegas: OpcionMulti[] = catalogo.map((b) => ({ value: b.codigo, label: `${b.codigo} · ${b.descripcion}`, sub: b.ciudad || undefined }));
  const opInstalaciones: OpcionMulti[] = INSTALACIONES_CON_MATERIAL.map((i) => ({ value: String(i), label: `${i} · ${NOMBRE_INSTALACION[i]}` }));
  const opTipos: OpcionMulti[] = tiposOpciones.map((t) => ({ value: t.tipoDoc, label: `${t.tipoDoc} · ${t.descripcion}` }));
  const opMarcas: OpcionMulti[] = marcas.map((m) => ({ value: m, label: m }));

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingBottom: 12 }}>
          <div style={{ marginBottom: 10 }}>
            <div className="eyebrow" style={{ fontSize: 15 }}>Movimientos de Inventario · {etiqueta}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              {bodegaSel
                ? <>Bodega {bodegaSel.codigo} · {bodegaSel.descripcion} · {bodegaSel.ciudad || "sin ciudad"} · {bodegaSel.modeloCompra || "sin modelo"}</>
                : bodega.length ? `${bodega.length} bodegas` : "Todas las bodegas"}
              {instalacion.length ? ` · instalación ${instalacion.join(", ")}` : ""}
              {tipoDoc.length ? ` · ${tipoDoc.join(", ")}` : ""}
              {marca.length ? ` · ${marca.length === 1 ? marca[0] : `${marca.length} proveedores`}` : ""}
            </div>
          </div>
          <FiltroAuto className="toolbar">
            <label className="flag" style={{ alignSelf: "center" }}>Año:</label>
            <select name="anio" defaultValue={anio} className="select">
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <label className="flag" style={{ alignSelf: "center" }}>Mes:</label>
            <MultiSelect name="mes" options={opMeses} selected={mes.map(String)} placeholder="Todo el año" />
            <label className="flag" style={{ alignSelf: "center" }}>Bodega:</label>
            <MultiSelect name="bodega" options={opBodegas} selected={bodega} placeholder="Todas" ancho={300} />
            <label className="flag" style={{ alignSelf: "center" }}>Instalación:</label>
            <MultiSelect name="inst" options={opInstalaciones} selected={instalacion.map(String)} placeholder="Todas" />
            <label className="flag" style={{ alignSelf: "center" }}>Tipo:</label>
            <MultiSelect name="tipo" options={opTipos} selected={tipoDoc} placeholder="Todos" ancho={260} />
            <label className="flag" style={{ alignSelf: "center" }}>Proveedor (marca):</label>
            <MultiSelect name="marca" options={opMarcas} selected={marca} placeholder="Todos" ancho={300} />
          </FiltroAuto>
        </div>
      </div>

      <div className="kpis k6" style={{ marginBottom: 12 }}>
        <div className="kpi kc">
          <div className="klabel">Saldo Inicial</div>
          <div className="kval num">{saldo.disponible ? <Monto value={saldo.inicial} /> : "—"}</div>
          <div className="ksub" style={{ color: "var(--muted)" }}>
            {saldo.disponible ? rangoSaldo : notaSaldo}
          </div>
        </div>
        <div className="kpi kc">
          <div className="klabel">Movimientos</div>
          <div className="kval num">{formatNumero(kpi.movimientos)}</div>
          <div className="ksub" style={{ color: "var(--muted)" }}>
            {formatNumero(kpi.documentos)} documentos · {formatNumero(kpi.referencias)} referencias
          </div>
        </div>
        <div className="kpi kc k-ingreso">
          <div className="klabel">Entradas</div>
          <div className="kval num"><Monto value={kpi.costoEntradas} /></div>
          <div className="ksub" style={{ color: "var(--muted)" }}>{formatNumero(kpi.cantEntradas)} unidades</div>
        </div>
        <div className="kpi kc k-egreso">
          <div className="klabel">Salidas</div>
          <div className="kval num"><Monto value={kpi.costoSalidas} /></div>
          <div className="ksub" style={{ color: "var(--muted)" }}>{formatNumero(kpi.cantSalidas)} unidades</div>
        </div>
        <div className={`kpi kc ${neto < 0 ? "k-bad" : "k-ok"}`}>
          <div className="klabel">Neto</div>
          <div className="kval num">{neto >= 0 ? "▲ " : "▼ "}<Monto value={Math.abs(neto)} /></div>
          <div className="ksub" style={{ color: "var(--muted)" }}>{neto >= 0 ? "entró más de lo que salió" : "salió más de lo que entró"}</div>
        </div>
        <div className="kpi kc">
          <div className="klabel">Saldo Final</div>
          <div className="kval num">{saldo.disponible ? <Monto value={saldo.final} /> : "—"}</div>
          <div className="ksub" style={{ color: "var(--muted)" }}>
            {saldo.disponible ? rangoSaldo : notaSaldo}
          </div>
        </div>
      </div>
      {(saldo.motivo || saldoRezagado || (saldo.disponible && tipoDoc.length > 0)) && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-body" style={{ fontSize: 12, color: "var(--muted)", padding: "10px 14px", display: "grid", gap: 4 }}>
            {saldo.motivo === "bodega" && <div>Este periodo se cargó con el export viejo del balance, que solo llegaba hasta instalación: por eso no hay <b>saldo por bodega</b>. Vuelve a cargar el balance del mes con la columna Bodega y aparece.</div>}
            {saldo.motivo === "sin-balance" && <div>No hay <b>balance</b> cargado para este periodo, así que no hay saldo inicial ni final. Carga el balance del mes para verlos.</div>}
            {saldoRezagado && <div>El balance va hasta <b>{MES_LARGO[saldo.mesFinal]}</b> y los movimientos llegan a <b>{MES_LARGO[ultimoMov]}</b>: por eso inicial + entradas − salidas no da exactamente el saldo final.</div>}
            {!saldo.motivo && tipoDoc.length > 0 && <div>El <b>saldo</b> es la existencia completa: no se filtra por tipo de documento. Entradas y salidas sí muestran solo <b>{tipoDoc.join(", ")}</b>.</div>}
          </div>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", marginBottom: 12, alignItems: "start" }}>
        <div className="card">
          <div className="chart-head">Por Tipo de Movimiento <span className="hact">{etiqueta}</span></div>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr><th>Tipo</th><th className="r">Movtos.</th><th className="r">Entradas</th><th className="r">Salidas</th></tr>
              </thead>
              <tbody>
                {tipos.length === 0 && <tr><td colSpan={4}><div className="empty">Sin movimientos con estos filtros.</div></td></tr>}
                {tipos.map((t) => (
                  <tr key={t.tipoDoc}>
                    <td style={{ whiteSpace: "normal" }}>
                      <b>{t.tipoDoc}</b> · {t.descripcion}
                    </td>
                    <td className="r num">{formatNumero(t.movimientos)}</td>
                    <td className="r num"><Monto value={t.costoEntradas} /></td>
                    <td className="r num"><Monto value={t.costoSalidas} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="chart-head">
            Por Bodega
            <span className="hact">
              {etiqueta} · {porBodega.length} bodega(s)
              {mesSaldo ? " · saldo a " + MES_CORTO[mesSaldo] : ""}
            </span>
          </div>
          <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Bodega</th><th>Ciudad</th><th className="r">Movtos.</th>
                  <th className="r">Entradas</th><th className="r">Salidas</th>
                  <th className="r">Neto</th>
                  {mesSaldo ? <th className="r">Saldo</th> : null}
                </tr>
              </thead>
              <tbody>
                {porBodega.length === 0 && <tr><td colSpan={mesSaldo ? 7 : 6}><div className="empty">Sin movimientos con estos filtros.</div></td></tr>}
                {porBodega.map((b) => {
                  const neto = b.entradas - b.salidas;
                  const saldo = saldoBodega.get(b.codigo);
                  return (
                    <tr key={b.codigo}>
                      <td style={{ whiteSpace: "normal" }}>
                        <b>{b.codigo}</b> · {b.descripcion}
                        {b.inferida && <span className="tag t-w1" style={{ marginLeft: 6 }} title="No venía en el catálogo">inferida</span>}
                      </td>
                      <td>{b.ciudad || "—"}</td>
                      <td className="r num">{formatNumero(b.movimientos)}</td>
                      <td className="r num"><Monto value={b.entradas} /></td>
                      <td className="r num"><Monto value={b.salidas} /></td>
                      <td className="r num" style={{ fontWeight: 600, color: neto < 0 ? "var(--bad)" : "var(--ok)" }}>
                        {neto < 0 ? "▼ " : "▲ "}<Monto value={Math.abs(neto)} />
                      </td>
                      {mesSaldo ? (
                        <td className="r num" style={{ fontWeight: 600 }}>
                          {saldo == null
                            ? <span className="flag" title="La bodega no tiene saldo en el balance de ese mes">—</span>
                            : <Monto value={saldo} />}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Decir de qué corte es el saldo evita leerlo como si fuera del
              mismo periodo que los movimientos, que casi nunca coinciden. */}
          <div className="card-body" style={{ padding: "8px 14px", fontSize: 12, color: "var(--muted)" }}>
            {mesSaldo ? (
              <>El <b>Neto</b> es entradas − salidas del periodo filtrado. El <b>Saldo</b> es el
                valorizado del balance al cierre de <b>{MES_CORTO[mesSaldo]} {anio}</b>, el último
                mes con detalle por bodega — no del periodo mostrado.</>
            ) : (
              <>El <b>Neto</b> es entradas − salidas del periodo filtrado. El saldo por bodega no se
                puede mostrar: el balance de {mes.length ? mes.map((m) => MES_CORTO[m]).join(", ") + " " : ""}{anio} se cargó con el
                export viejo, que solo llega hasta instalación.</>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="chart-head">
          Detalle
          <span className="hact">
            {kpi.movimientos > LIMITE
              ? `los ${LIMITE} más recientes de ${formatNumero(kpi.movimientos)} · afine los filtros para ver el resto`
              : `${formatNumero(detalle.length)} movimiento(s)`}
          </span>
        </div>
        <div style={{ overflowX: "auto", maxHeight: 600, overflowY: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Fecha</th><th>Documento</th><th>Bodega</th><th>Inst.</th>
                <th>Referencia</th><th>Descripción</th><th>Lote</th>
                <th className="r">Ent.</th><th className="r">Sal.</th>
                <th className="r">$ Entrada</th><th className="r">$ Salida</th>
              </tr>
            </thead>
            <tbody>
              {detalle.length === 0 && <tr><td colSpan={11}><div className="empty">Sin movimientos con estos filtros.</div></td></tr>}
              {detalle.map((m, i) => (
                <tr key={`${m.documento}-${m.referencia}-${i}`}>
                  <td>{m.fecha.toISOString().slice(0, 10)}</td>
                  <td title={m.descTipoDoc}><b>{m.tipoDoc}</b> {m.documento.slice(4)}</td>
                  <td style={{ whiteSpace: "normal" }}>{m.bodegaCodigo} · {m.bodegaDesc}</td>
                  <td>{m.instalacion}</td>
                  <td style={{ fontWeight: 600 }}>{m.referencia}</td>
                  <td style={{ whiteSpace: "normal" }}>{m.descripcion}</td>
                  <td>{m.lote || "—"}</td>
                  <td className="r num">{m.cantEntradas || ""}</td>
                  <td className="r num">{m.cantSalidas || ""}</td>
                  <td className="r num">{m.costoEntradas ? <Monto value={m.costoEntradas} /> : ""}</td>
                  <td className="r num">{m.costoSalidas ? <Monto value={m.costoSalidas} /> : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ fontSize: 12, color: "var(--muted)", borderTop: "1px solid var(--line)" }}>
          Esta es la única vista del módulo con bodega: el balance mensual solo llega hasta instalación,
          así que el <a href="/osteosintesis/valorizado">saldo valorizado</a> no se puede abrir por bodega, pero el movimiento sí.
        </div>
      </div>
    </>
  );
}
