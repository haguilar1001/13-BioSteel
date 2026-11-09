// Barra de descarga de un tablero de indicadores: Excel (los números) + PDF
// (el tablero tal como se ve, vía la hoja @media print). Es .no-print, así
// que no sale en el propio PDF. El href del Excel lo arma cada página con sus
// filtros vigentes.
import { BotonImprimir } from "./BotonImprimir";

export function AccionesDescarga({
  excelHref,
  excelTitle = "Descargar los números en Excel",
}: {
  excelHref: string;
  excelTitle?: string;
}) {
  return (
    <div className="toolbar no-print" style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <a className="btn" href={excelHref} title={excelTitle}>⬇️ Excel</a>
      <BotonImprimir />
    </div>
  );
}
