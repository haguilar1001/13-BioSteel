"use client";
// Anillo (donut) SVG con tooltip estilizado por segmento.
// - Modo `azul`: rampa azul institucional + agrupa los menores en "Otros
//   menores" (para muchas categorías). Ordena de mayor a menor.
// - `detalle` por segmento: se muestra como desglose en el tooltip (p. ej. las
//   IPS de una ciudad). Al agrupar, "Otros menores" desglosa las categorías.
// Formateo local (no importa @/lib/format para no arrastrar Prisma al bundle).
import { useRef, useState } from "react";

const nf = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const cop = (v: number) => `$ ${nf.format(Math.round(v))}`;
const pct = (v: number) => `${v.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;

export interface DetalleItem { label: string; valor: number; }
export interface SegmentoDonut {
  label: string;
  valor: number;
  color?: string; // opcional en modo azul
  detalle?: DetalleItem[]; // desglose para el tooltip
}
type Seg = Required<Pick<SegmentoDonut, "label" | "valor" | "color">> & { detalle?: DetalleItem[] };

const AZULES = ["var(--az-1)", "var(--az-2)", "var(--az-3)", "var(--az-4)", "var(--az-5)", "var(--az-6)", "var(--az-7)", "var(--az-8)"];
const AZUL_OTROS = "var(--az-otros)";

function polar(cx: number, cy: number, r: number, ang: number): [number, number] {
  const a = ((ang - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function arco(cx: number, cy: number, r: number, ir: number, s: number, e: number): string {
  const [x1, y1] = polar(cx, cy, r, s), [x2, y2] = polar(cx, cy, r, e);
  const [x3, y3] = polar(cx, cy, ir, e), [x4, y4] = polar(cx, cy, ir, s);
  const large = e - s > 180 ? 1 : 0;
  return `M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${ir} ${ir} 0 ${large} 0 ${x4} ${y4} Z`;
}

export function segmentosAzules(data: SegmentoDonut[], minPct = 1): Seg[] {
  const total = data.reduce((s, d) => s + Math.abs(d.valor), 0) || 1;
  const orden = [...data].sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  const mayores = orden.filter((d) => (Math.abs(d.valor) / total) * 100 >= minPct).slice(0, AZULES.length);
  const mayoresSet = new Set(mayores);
  const menores = orden.filter((d) => !mayoresSet.has(d));
  const restoValor = menores.reduce((s, d) => s + Math.abs(d.valor), 0);
  const segs: Seg[] = mayores.map((d, i) => ({ label: d.label, valor: d.valor, color: AZULES[i]!, detalle: d.detalle }));
  if (restoValor > 0) {
    segs.push({
      label: `Otros menores (${menores.length})`,
      valor: restoValor,
      color: AZUL_OTROS,
      detalle: menores.map((m) => ({ label: m.label, valor: Math.abs(m.valor) })),
    });
  }
  return segs;
}

export function Donut({
  data,
  centro,
  size = 300,
  legend = true,
  azul = false,
  agruparBajo = 1,
  valores = false,
}: {
  data: SegmentoDonut[];
  /**
   * Texto del hueco. `valorCorto` activa el toggle global de cifras: se
   * pintan las dos variantes y el CSS (data-montos en <html>) muestra una,
   * igual que hace el componente Monto.
   */
  centro?: { valor: string; valorCorto?: string; etiqueta: string };
  size?: number;
  legend?: boolean;
  azul?: boolean;
  agruparBajo?: number;
  /** En modo azul la leyenda solo trae %; con `valores` agrega también el monto. */
  valores?: boolean;
}) {
  const segs: Seg[] = azul
    ? segmentosAzules(data, agruparBajo)
    : data.map((d) => ({ label: d.label, valor: d.valor, color: d.color ?? "var(--brand)", detalle: d.detalle }));

  const total = segs.reduce((s, d) => s + Math.abs(d.valor), 0) || 1;
  const cx = size / 2, cy = size / 2, r = size / 2 - 4, ir = r * 0.62;
  const gap = 2;

  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; w: number; seg: Seg } | null>(null);
  const mover = (seg: Seg) => (e: React.MouseEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, seg });
  };

  // El texto del hueco se encoge si la cifra es larga: un valor completo
  // ($ 9.533.771.914) a tamaño fijo se salía del anillo y quedaba cortado.
  // 0,55 em por carácter es el ancho aproximado de la fuente con cifras
  // tabulares; se deja un 6 % de margen contra el borde del hueco.
  const propsCentro = (txt: string) => ({
    x: cx,
    y: cy - 2,
    textAnchor: "middle" as const,
    fontSize: Math.min(size * 0.11, (ir * 2 * 0.94) / Math.max(txt.length * 0.55, 1)),
    fontWeight: 800,
    fill: "var(--ink)",
    style: { fontVariantNumeric: "tabular-nums" as const },
  });

  let ang = 0;
  const arcos = segs.map((d) => {
    const frac = Math.abs(d.valor) / total;
    const s = ang + gap / 2;
    const e = ang + frac * 360 - gap / 2;
    ang += frac * 360;
    return { d, s, e, frac };
  });

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ maxWidth: "100%", flex: "0 0 auto" }}>
        {arcos.map(({ d, s, e }) =>
          e <= s ? null : (
            <path
              key={d.label}
              d={arco(cx, cy, r, ir, s, e)}
              fill={d.color}
              style={{ cursor: "pointer", transition: "opacity .12s", opacity: tip && tip.seg.label !== d.label ? 0.55 : 1 }}
              onMouseMove={mover(d)}
              onMouseEnter={mover(d)}
              onMouseLeave={() => setTip(null)}
            />
          ),
        )}
        {centro && (
          <>
            {centro.valorCorto ? (
              <>
                <text {...propsCentro(centro.valor)} className="monto-full">{centro.valor}</text>
                <text {...propsCentro(centro.valorCorto)} className="monto-short">{centro.valorCorto}</text>
              </>
            ) : (
              <text {...propsCentro(centro.valor)}>{centro.valor}</text>
            )}
            <text x={cx} y={cy + size * 0.1} textAnchor="middle" fontSize={size * 0.06} fill="var(--muted)">{centro.etiqueta}</text>
          </>
        )}
      </svg>

      {tip && <Tooltip tip={tip} total={total} />}

      <div style={{ width: "100%", display: legend ? "flex" : "none", flexDirection: "column", gap: 2 }}>
        {segs.map((d) => (
          <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, padding: "6px 4px", borderTop: "1px solid var(--line)" }}>
            <i style={{ width: 12, height: 12, borderRadius: 3, background: d.color, flex: "0 0 auto" }} />
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
            {(!azul || valores) && <span className="num" style={{ fontWeight: 700 }}>{cop(d.valor)}</span>}
            <span className="num" style={{ color: "var(--muted)", minWidth: 58, textAlign: "right" }}>{pct((Math.abs(d.valor) / total) * 100)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Tooltip({ tip, total }: { tip: { x: number; y: number; w: number; seg: Seg }; total: number }) {
  const { seg } = tip;
  const ancho = 260;
  const flip = tip.x > tip.w - ancho - 8; // si no cabe a la derecha, va a la izquierda
  const left = flip ? tip.x - ancho - 12 : tip.x + 14;
  const det = seg.detalle ?? [];
  const top = det.slice(0, 8);
  const resto = det.length - top.length;

  return (
    <div
      style={{
        position: "absolute", left: Math.max(4, left), top: Math.max(4, tip.y + 12), width: ancho, zIndex: 20,
        pointerEvents: "none", background: "var(--surface)", border: "1px solid var(--line)",
        borderRadius: "var(--r-sm)", boxShadow: "var(--elev)", overflow: "hidden", fontSize: 12.5,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--brand)", color: "#fff" }}>
        <i style={{ width: 11, height: 11, borderRadius: 3, background: seg.color, flex: "0 0 auto", boxShadow: "0 0 0 1.5px rgba(255,255,255,.5)" }} />
        <span style={{ fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{seg.label}</span>
        <span className="num" style={{ fontWeight: 700 }}>{pct((Math.abs(seg.valor) / total) * 100)}</span>
      </div>
      <div style={{ padding: "6px 10px", display: "flex", justifyContent: "space-between", borderBottom: det.length ? "1px solid var(--line)" : undefined, fontWeight: 700 }}>
        <span>Venta</span><span className="num">{cop(seg.valor)}</span>
      </div>
      {det.length > 0 && (
        <div style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: 3 }}>
          {top.map((it) => (
            <div key={it.label} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <span style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
              <span className="num" style={{ flex: "0 0 auto" }}>{cop(it.valor)}</span>
            </div>
          ))}
          {resto > 0 && <div style={{ color: "var(--muted)", fontStyle: "italic" }}>+{resto} más…</div>}
        </div>
      )}
    </div>
  );
}
