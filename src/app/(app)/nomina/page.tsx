// ==========================================================
// Nómina · Resumen — costo de personal del año (solo BioSteel). El costo pondera
// el tiempo activo de cada persona en el año (ingreso/retiro), retirados incluidos.
// KPIs (costo mensual promedio/anual, empleados, salario promedio) con su variación contra el año
// anterior, anillo por tipo de contrato,
// composición del costo, ranking por proceso y por ciudad, y comparativo por
// proceso vs año anterior. Selector de año.
// ==========================================================
import { requirePermiso } from "@/server/auth-context";
import { formatCOP, formatCOPCorto, formatNumero } from "@/lib/format";
import { Monto } from "../_components/Monto";
import {
  aniosConNomina, resumenAnual, porProceso, porCiudad,
  composicionCosto, comparativoProceso,
} from "@/lib/negocio/nomina";
import { Donut } from "../_components/charts/Donut";
import { TopRanking } from "../_components/charts/TopRanking";
import { BarrasComparativas } from "../_components/charts/BarrasComparativas";
import { FiltroAuto } from "../_components/FiltroAuto";


export default async function NominaPage({ searchParams }: { searchParams: Promise<{ anio?: string }> }) {
  await requirePermiso("cxp.view");
  const sp = await searchParams;

  const anios = await aniosConNomina();
  if (anios.length === 0) {
    return <div className="card"><div className="card-body"><div className="empty">Sin nómina cargada. Corre <code>npm run db:nomina</code>.</div></div></div>;
  }
  const anio = sp.anio && anios.includes(Number(sp.anio)) ? Number(sp.anio) : anios[anios.length - 1]!;
  const anioAnt = anio - 1;
  const hayAnterior = anios.includes(anioAnt);

  const [kpi, kpiAnt, procesos, ciudades, comp, compProceso] = await Promise.all([
    resumenAnual(anio),
    // El año anterior solo se pide para poder mostrar la variación de cada KPI.
    hayAnterior ? resumenAnual(anioAnt) : Promise.resolve(null),
    porProceso(anio),
    porCiudad(anio),
    composicionCosto(anio),
    hayAnterior ? comparativoProceso(anio, anioAnt) : Promise.resolve([]),
  ]);

  // Composición del costo (mensual): salario base + auxilio + aportes + provisiones.
  const donutComp = [
    { label: "Salario base", valor: comp.baseSalarial },
    { label: "Auxilio transporte", valor: comp.auxTransporte },
    { label: "Seguridad social (patronal)", valor: comp.seguridadSocial },
    { label: "Prestaciones sociales", valor: comp.prestaciones },
  ].filter((s) => s.valor > 0);

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ paddingBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="eyebrow" style={{ fontSize: 15 }}>Costo de Personal · {anio}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              Incluye a los colaboradores retirados, por el tiempo que estuvieron activos en {anio}
              {kpi.retirados > 0 ? ` · ${formatNumero(kpi.activos)} activo(s) y ${formatNumero(kpi.retirados)} retirado(s)` : ""}
            </div>
          </div>
          <FiltroAuto className="toolbar">
            <label className="flag" style={{ alignSelf: "center" }}>Año:</label>
            <select name="anio" defaultValue={anio} className="select">
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </FiltroAuto>
        </div>
      </div>

      {/* KPIs, cada uno con su variación contra el año anterior. En costo de
          personal subir NO es bueno, así que el verde es para la baja; en
          empleados no hay bueno ni malo y va en gris. */}
      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi kc k-egreso">
          <div className="klabel">Costo mensual (prom.)</div>
          <div className="kval num"><Monto value={kpi.costoMensual} /></div>
          <Variacion actual={kpi.costoMensual} anterior={kpiAnt?.costoMensual} anioAnt={anioAnt} plata />
        </div>
        <div className="kpi kc k-egreso">
          <div className="klabel">Costo anual {anio}</div>
          <div className="kval num"><Monto value={kpi.costoAnual} /></div>
          <Variacion actual={kpi.costoAnual} anterior={kpiAnt?.costoAnual} anioAnt={anioAnt} plata />
        </div>
        <div className="kpi kc">
          <div className="klabel">Empleados en {anio}</div>
          <div className="kval num">{formatNumero(kpi.headcount)}</div>
          <Variacion actual={kpi.headcount} anterior={kpiAnt?.headcount} anioAnt={anioAnt} neutro sufijo=" empleado(s)" />
          {kpi.retirados > 0 && <div className="ksub" style={{ color: "var(--muted)" }}>{formatNumero(kpi.activos)} activos · {formatNumero(kpi.retirados)} retirados</div>}
        </div>
        <div className="kpi kc k-w">
          <div className="klabel">Salario base prom.</div>
          <div className="kval num"><Monto value={kpi.salarioPromedio} /></div>
          <Variacion actual={kpi.salarioPromedio} anterior={kpiAnt?.salarioPromedio} anioAnt={anioAnt} plata />
        </div>
      </div>

      {/* Composición + rankings por proceso y ciudad, en una sola fila. */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", marginBottom: 12, alignItems: "start" }}>
        {/* Composición del costo */}
        <div className="card">
          <div className="chart-head">Composición del Costo <span className="hact">mensual · {anio}</span></div>
          <div className="card-body" style={{ display: "grid", placeItems: "center" }}>
            {donutComp.length === 0 ? <div className="empty">Sin datos.</div> : (
              <Donut azul data={donutComp} size={220} centro={{ valor: formatCOP(kpi.costoMensual), valorCorto: formatCOPCorto(kpi.costoMensual), etiqueta: "costo/mes" }} />
            )}
          </div>
        </div>

        {/* Ranking por proceso */}
        <TopRanking
          titulo={`Costo por Proceso · ${anio}`}
          items={procesos.map((p) => ({ label: p.label, valor: p.costoMensual, sub: `${p.headcount} empl.` }))}
          inicial={8}
        />
        {/* Ranking por ciudad */}
        <TopRanking
          titulo={`Costo por Ciudad · ${anio}`}
          items={ciudades.map((c) => ({ label: c.label, valor: c.costoMensual, sub: `${c.headcount} empl.` }))}
          color="var(--w1)"
          inicial={8}
        />
      </div>

      {/* Comparativo por proceso vs año anterior */}
      {hayAnterior && compProceso.length > 0 && (
        <BarrasComparativas
          titulo="Costo mensual por Proceso · comparativo"
          items={compProceso}
          labelA={`${anio}`}
          labelB={`${anioAnt}`}
          inicial={10}
        />
      )}
    </>
  );
}

/**
 * Variación de un KPI contra el mismo dato del año anterior: cuánto y en qué
 * porcentaje. Sin año anterior cargado no se inventa nada, se dice.
 *
 * El color sigue el SIGNIFICADO, no el signo: en costo de personal subir es
 * malo y bajar es bueno. Los conteos (empleados) van en gris porque más o
 * menos gente no es en sí bueno ni malo.
 */
function Variacion({
  actual, anterior, anioAnt, plata = false, neutro = false, sufijo = "",
}: {
  actual: number;
  anterior?: number;
  anioAnt: number;
  plata?: boolean;
  neutro?: boolean;
  sufijo?: string;
}) {
  if (anterior == null) {
    return <div className="ksub" style={{ color: "var(--muted)" }}>sin {anioAnt} para comparar</div>;
  }
  const dif = actual - anterior;
  const pct = anterior !== 0 ? (dif / Math.abs(anterior)) * 100 : null;
  const color = neutro || dif === 0 ? "var(--muted)" : dif > 0 ? "var(--bad)" : "var(--ok)";
  const flecha = dif === 0 ? "=" : dif > 0 ? "▲" : "▼";
  const abs = Math.abs(dif);
  return (
    <div className="ksub" style={{ color }}>
      {flecha}{" "}
      {plata ? <Monto value={abs} /> : <>{formatNumero(abs)}{sufijo}</>}
      {pct != null ? ` (${Math.abs(pct).toFixed(1).replace(".", ",")} %)` : ""} vs {anioAnt}
    </div>
  );
}
