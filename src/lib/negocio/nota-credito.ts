// ==========================================================
// Motor de Notas Crédito (descuento financiero por IPS).
//
// Reconstrucción fiel del motor DAX documentado en
// "Documentacion_Modelo_Ventas_NotaCredito.docx". Calcula, renglón por
// renglón, el valor del descuento comercial (NOTA_CREDITO) de cada factura
// FET según IPS, sucursal, línea, procedimiento, convenio y la vigencia de
// los parámetros. Validado contra Power BI: 2024 exacto mes a mes; 2025/2026
// dentro de ~0,15% (la diferencia restante son las Exclusiones NC).
//
// Módulo PURO (sin `server-only` ni Prisma): lo usan tanto el script de
// carga (prisma/set-ventas.ts) como el importador in-app.
//
//   Venta Neta = Σ(Valor subtotal local) − Σ(NOTA_CREDITO)   [Power BI: "Venta Total"]
// ==========================================================

/** Parámetro de descuento con vigencia (fechas en epoch ms UTC). */
export interface ParamNC {
  ips: string;      // CAMPBELL, BARU, MOVID, VALLE, AZALUD, CM BAHIA, OTRAS_IPS
  concepto: string; // BRACE, ALTO_COSTO, MAXILO, APROVECHAMIENTO, MOS, ADRES
  pct: number;
  ini: number;      // FechaInicio (ms UTC, inclusive)
  fin: number;      // FechaFin (ms UTC, inclusive)
}

/** Renglón de venta ya normalizado (strings de matching en MAYÚSCULAS). */
export interface VentaRow {
  nro: string;          // Nro documento (p.ej. "FET-00109554")
  tipo: string;         // Prefijo del documento: FET / NAN / NDC
  aprobada: boolean;    // Estado === "Aprobada"
  ms: number;           // Fecha de la venta (ms UTC)
  anio: number;
  mes: number;          // 1–12
  ips: string | null;   // IPS agrupadora (ver ipsDe)
  suc: string;          // Desc. sucursal factura (MAYÚSCULAS)
  bod: string;          // Desc. bodega (MAYÚSCULAS)
  notas: string;        // Notas ítem (MAYÚSCULAS)
  conv: string;         // Convenio (MAYÚSCULAS)
  proc: string;         // Procedimiento (MAYÚSCULAS)
  linea: string;        // LÍNEA (exacto, p.ej. "2011 - FIJACIÓN EXTERNA")
  subtotal: number;     // Valor subtotal local
  fbd?: string;         // Factura base devolución (sólo relevante en NAN)
}

/** Contexto de cálculo compartido por todos los renglones de un período. */
export interface CtxNC {
  params: ParamNC[];
  /** Nro documento FET → set de "anio-mes" de las NAN vinculadas. */
  nanMeses: Map<string, Set<string>>;
  /** Núcleos numéricos (ver nroClave) de los documentos excluidos manualmente
   *  (Exclusiones NC, concepto TODOS). */
  excluidos: Set<string>;
}

const INT = Math.trunc; // DAX INT() trunca hacia cero

/** Núcleo numérico del Nro documento (sin prefijo ni ceros a la izquierda).
 *  "FET-00119966" → "119966"; "119966" → "119966". Hace robusta la comparación
 *  de exclusiones sin importar cómo se haya escrito el documento. */
export function nroClave(s: string): string {
  return s.replace(/\D/g, "").replace(/^0+/, "") || "0";
}

/**
 * Tipos de documento que SON venta: lo que trae la consulta "FACTURAS POR
 * ITEM" de SIESA y el Power BI — factura electrónica (FET) y nota crédito
 * (NAN). Cualquier otro prefijo (pedidos PED, cotizaciones, etc.) NO es venta:
 * si quedó en VentaDoc de una carga vieja, no debe sumar al neto ni aparecer
 * como cliente — por eso salían como la fila "(sin cliente)", que PBI nunca
 * trae porque su consulta es de facturas.
 */
export const TIPOS_VENTA: ReadonlySet<string> = new Set(["FET", "NAN"]);

/** ¿El renglón es un documento de venta (factura o nota crédito)? */
export function esDocumentoVenta(tipo: string): boolean {
  return TIPOS_VENTA.has(tipo);
}

/** ¿`hay` (MAYÚSCULAS) contiene el literal `needle` (MAYÚSCULAS)? */
function ct(hay: string, needle: string): boolean {
  return hay.includes(needle);
}

/** Identifica la IPS a partir de la razón social del cliente de despacho. */
export function ipsDe(cliente: string): string | null {
  const c = cliente.toUpperCase();
  if (c.includes("CAMPBELL")) return "CAMPBELL";
  if (c.includes("BARU")) return "BARU";
  if (c.includes("MOVID")) return "MOVID";
  if (c.includes("VALLE")) return "VALLE";
  if (c.includes("SERVISALUD")) return "VALLE";
  if (c.includes("URGETRAUMA")) return "VALLE";
  if (c.includes("AZALUD")) return "AZALUD";
  if (c.includes("BAHIA")) return "CM BAHIA";
  return null;
}

/** Porcentaje vigente para (IPS, Concepto) en la fecha dada, o null. */
export function buscarPct(params: ParamNC[], ips: string | null, concepto: string, ms: number): number | null {
  if (!ips) return null;
  for (const p of params) {
    if (p.ips === ips && p.concepto === concepto && p.ini <= ms && p.fin >= ms) return p.pct;
  }
  return null;
}

/** Bandera maestra de elegibilidad NC por IPS/estado/convenio/sucursal/ítem. */
export function aplicaNota(r: VentaRow): boolean {
  const ap = r.aprobada;
  const coos = ct(r.conv, "COOSALUD");
  const mut = ct(r.conv, "MUTUAL SER");
  const caj = ct(r.suc, "CAJA COPI");
  const arp = ct(r.suc, "ARP");
  const cor = ct(r.suc, "CORTESIA");
  const sv = ct(r.suc, "SALUD VIDA");
  const ins = ct(r.suc, "INSUMOS");
  const mal = ct(r.suc, "MALAMBO");
  const malB = mal && ct(r.suc, "BRAC");
  const sfa = ct(r.suc, "SAN FERNANDO - ALTO") || ct(r.suc, "SAN FERNANDO- ALTO") || ct(r.suc, "SAN FERNAND- ALTO");
  const alto = ct(r.suc, "ALTO");
  const itemExcl = ct(r.notas, "FRESA ") || ct(r.notas, "CUCHILLA") || ct(r.notas, "TUTOR TRANS");

  // Regla especial: CAMPBELL/AZALUD + sucursal "ALTO" fuerza TRUE si Aprobada.
  if ((r.ips === "CAMPBELL" || r.ips === "AZALUD") && ap && alto) return true;
  if (r.ips === "CAMPBELL") return ap && !coos && !mut && !caj && !arp && !cor && !sv && !ins && (!mal || malB);
  if (r.ips === "VALLE") return ap && !sfa && !itemExcl;
  if (!r.ips) return false;
  return ap; // AZALUD, BARU, MOVID, CM BAHIA
}

/** NOTA_CREDITO (descuento) del renglón. 0 si no es FET o no aplica. */
export function notaCredito(r: VentaRow, ctx: CtxNC): number {
  if (r.tipo !== "FET") return 0;

  const key = `${r.anio}-${r.mes}`;
  const meses = ctx.nanMeses.get(r.nro);
  const tieneNan = meses != null;
  const nanMismoMes = tieneNan && meses!.has(key);
  const gate = tieneNan && !nanMismoMes; // NAN de otro mes ⇒ anula el descuento
  const excluida = ctx.excluidos.has(nroClave(r.nro));
  const aplica = aplicaNota(r);
  const p = (concepto: string, ips: string | null = r.ips) => buscarPct(ctx.params, ips, concepto, r.ms);

  let brace = 0, altoCosto = 0, maxilo = 0, aprovechamiento = 0, mos = 0, fijadores = 0;

  if (!gate) {
    const pB = p("BRACE");
    if (ct(r.suc, "BRAC") && pB != null && !nanMismoMes && aplica && !excluida) brace = INT(r.subtotal * pB);

    const pA = p("ALTO_COSTO");
    if (ct(r.suc, "ALTO") && !ct(r.suc, "BRAC") && pA != null && !nanMismoMes && aplica && !excluida) altoCosto = INT(r.subtotal * pA);

    const pM = p("MAXILO", "VALLE");
    const esProcMaxilo =
      ["163", "164", "516"].includes(r.proc.slice(0, 3)) ||
      ct(r.proc, "MAXILAR") || ct(r.proc, "MALAR") || ct(r.proc, "MANDIBULAR") ||
      ct(r.proc, "DENTOALVEOLAR") || ct(r.proc, "ORBITA");
    if (r.ips === "VALLE" && pM != null && r.linea === "2003 - NEURO/MAXILO" &&
        !ct(r.proc, "CRANEO") && esProcMaxilo && aplica && !excluida && !nanMismoMes) {
      maxilo = INT(r.subtotal * pM);
    }

    const sinOtros = brace + altoCosto + maxilo === 0;
    const coos = ct(r.conv, "COOSALUD");

    const pAp = p("APROVECHAMIENTO");
    const aplAV = (r.ips === "AZALUD" || r.ips === "VALLE") && !coos;
    const aplCB = r.ips === "CAMPBELL" && !coos;
    const aplBA = r.ips === "BARU";
    if ((aplAV || aplCB || aplBA) && sinOtros && ct(r.bod, "APROVECHA") &&
        r.linea === "2011 - FIJACIÓN EXTERNA" && pAp != null && aplica && !excluida && !nanMismoMes) {
      aprovechamiento = INT(r.subtotal * pAp);
    }

    const pMos = p("MOS");
    const itemExcl = ct(r.notas, "FRESA ") || ct(r.notas, "CUCHILLA") || ct(r.notas, "TUTOR TRANS");
    const aplC = r.ips === "CAMPBELL" && !coos;
    const aplAz = r.ips === "AZALUD" && !coos;
    const aplO = r.ips === "BARU" || r.ips === "MOVID" || r.ips === "VALLE";
    if (!nanMismoMes && (aplC || aplAz || aplO) && sinOtros && !itemExcl && pMos != null && aplica && !excluida) {
      mos = INT(r.subtotal * pMos);
    }

    // FIJADORES ADRES: sólo nov–dic 2025, línea fijación externa, convenio ADRES.
    const esFijAdres =
      r.linea === "2011 - FIJACIÓN EXTERNA" &&
      r.conv === "ADMINISTRADORA DE LOS RECURSOS ADRES" &&
      r.ms >= Date.UTC(2025, 10, 1) && r.ms <= Date.UTC(2025, 11, 31) &&
      aplica && !excluida;
    if (esFijAdres) {
      const pc = p("ADRES", "CAMPBELL");
      const po = p("ADRES", "OTRAS_IPS");
      const pct = r.ips === "CAMPBELL" ? (pc != null ? pc : 0.735) : (po != null ? po : 0.7);
      fijadores = INT(r.subtotal * pct);
    }
  }

  const bruto = brace + altoCosto + maxilo + fijadores + mos + aprovechamiento;
  // Gate final: CAMPBELL/VALLE sólo conservan bruto si aplicaNota; se anula si
  // no es FET o hay NAN del mismo mes (en cuyo caso los subdescuentos ya son 0).
  const resultado = !(r.ips === "CAMPBELL" || r.ips === "VALLE") || aplica ? bruto : 0;
  if (r.tipo !== "FET" || nanMismoMes) return 0;
  return resultado;
}

/** Construye el mapa NAN (FET → meses de sus NAN) a partir de los renglones. */
export function construirNanMeses(rows: Pick<VentaRow, "tipo" | "nro" | "anio" | "mes">[], fbdDe: (i: number) => string): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  rows.forEach((r, i) => {
    if (r.tipo !== "NAN") return;
    const fbd = fbdDe(i);
    if (!fbd || fbd === "0") return;
    let s = m.get(fbd);
    if (!s) { s = new Set(); m.set(fbd, s); }
    s.add(`${r.anio}-${r.mes}`);
  });
  return m;
}
