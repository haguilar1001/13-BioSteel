// ==========================================================
// Hoja de un soporte de novedad de inventario (marca BioSteel).
// Server component puro: recibe los datos ya resueltos.
// ==========================================================
import { formatFechaHoraSeg, formatNumero, formatFechaSello, formatFecha } from "@/lib/format";
import {
  novedadLabel, novedadIcono, estadoLabel, tipoLabel, type SoporteNovedad, type ItemSoporte,
} from "@/lib/negocio/inventario";
import type { EstadoInventario } from "@prisma/client";

const NIT = "900.230.040-6";
const EMPRESA = "BioSteel de Colombia S.A.S";

function Badge({ estado }: { estado: EstadoInventario }) {
  return <span className={`sop-badge ${estado}`}>{estadoLabel(estado)}</span>;
}

function Campo({ k, v, full = false, big = false }: { k: string; v: React.ReactNode; full?: boolean; big?: boolean }) {
  return (
    <div className={`sop-f${full ? " full" : ""}`}>
      <span className="k">{k}</span>
      <span className={`v${big ? " big" : ""}`}>{v}</span>
    </div>
  );
}

function TablaItems({ items, titulo }: { items: ItemSoporte[]; titulo: string }) {
  return (
    <div className="sop-sec">
      <h3>{titulo}</h3>
      <table className="sop-tabla">
        <thead>
          <tr><th>Descripción</th><th>Tipo</th><th>Lote / Serial</th><th style={{ textAlign: "right" }}>Cant.</th><th>Estado</th></tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td>{it.descripcion}</td>
              <td>{tipoLabel(it.tipo)}</td>
              <td>{it.lote ?? "—"}</td>
              <td className="num">{formatNumero(it.cantidad)}</td>
              <td><Badge estado={it.estado} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SoporteDoc({ s }: { s: SoporteNovedad }) {
  const esTraslado = s.tipo === "traslado";
  const cambiaEstado = s.estadoNuevo != null;

  return (
    <div className="sop-hoja">
      {/* Encabezado institucional */}
      <div className="sop-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/BIOSTEEL.png" alt={EMPRESA} className="sop-logo" />
        <div className="sop-emp">
          <b>{EMPRESA}</b>
          <span>NIT {NIT}</span>
          <span>Material de osteosíntesis · Barranquilla, Colombia</span>
        </div>
        <div className="sop-doc">
          <div className="t">Soporte de novedad</div>
          <div className="c">{s.consecutivo}</div>
        </div>
      </div>

      {/* Cinta con el tipo de novedad */}
      <div className="sop-tipo">
        <span className="ico">{novedadIcono(s.tipo)}</span>
        <span className="lbl">{novedadLabel(s.tipo)}</span>
        <span className="meta">
          {s.tipo === "ingreso_existente" ? "Fecha de ingreso al inventario" : "Fecha de la novedad"}<br /><b>{formatFechaSello(s.fecha)}</b>
        </span>
      </div>

      <div className="sop-body">
        {/* Datos de la novedad */}
        <div className="sop-sec">
          <h3>Datos de la novedad</h3>
          <div className="sop-grid">
            <Campo k="Tipo de novedad" v={`${novedadIcono(s.tipo)} ${novedadLabel(s.tipo)}`} big />
            <Campo k={s.tipo === "ingreso_existente" ? "Fecha de ingreso al inventario" : "Fecha de la novedad"} v={formatFechaSello(s.fecha)} big />
            {s.fechaCompraOriginal && (
              <Campo k="Fecha de compra original" v={formatFecha(s.fechaCompraOriginal)} />
            )}
            {cambiaEstado && (
              <Campo
                k="Cambio de estado"
                v={
                  <>
                    {s.estadoAnterior ? <Badge estado={s.estadoAnterior} /> : <span className="sop-badge pendiente">Sin estado</span>}
                    <span className="sop-flecha">→</span>
                    {s.estadoNuevo ? <Badge estado={s.estadoNuevo} /> : "—"}
                  </>
                }
              />
            )}
            {esTraslado && (
              <Campo
                k="Traslado entre sedes"
                v={<>{s.sedeOrigen ?? "—"} <span className="sop-flecha">→</span> <b>{s.sedeDestino ?? "—"}</b></>}
              />
            )}
            <Campo k="Descripción / motivo" v={s.descripcion ?? "—"} full />
          </div>
        </div>

        {/* Equipo */}
        <div className="sop-sec">
          <h3>Equipo</h3>
          <div className="sop-grid">
            <Campo k="Código de inventario" v={s.equipoCodigo ?? "—"} big />
            <Campo k="Categoría" v={s.categoria} big />
            <Campo k="Marca / Modelo" v={s.marca} />
            <Campo k="Nombre" v={s.nombre ?? "—"} />
            <Campo k="Sede actual" v={s.sedeActual} />
            <Campo k="Ciudad" v={s.ciudad} />
          </div>
        </div>

        {/* Ítem afectado o todo el equipo */}
        {s.item ? (
          <TablaItems items={[s.item]} titulo="Ítem afectado" />
        ) : (
          <TablaItems items={s.equipoItems} titulo="Ítems del equipo (todo el equipo)" />
        )}
      </div>

      {/* Firmas */}
      <div className="sop-firmas">
        <div className="sop-firma">
          <div className="linea" />
          <div className="nom">{s.usuario ?? "—"}</div>
          <div className="rol">Elaborado por (usuario del sistema)</div>
        </div>
        <div className="sop-firma">
          <div className="linea" />
          <div className="nom">&nbsp;</div>
          <div className="rol">Recibido / Vo. Bo.</div>
        </div>
      </div>

      {/* Pie de trazabilidad */}
      <div className="sop-foot">
        <span>Registrado por <b>{s.usuario ?? "—"}</b> el {formatFechaHoraSeg(s.createdAt)} · ID interno {s.id}</span>
        <span>Documento generado por el sistema BioSteel</span>
      </div>
    </div>
  );
}
