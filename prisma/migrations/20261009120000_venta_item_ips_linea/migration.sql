-- Consumos y Ventas por Cliente filtrables por LÍNEA: el detalle por ítem × IPS
-- guarda la línea del renglón. Las filas existentes quedan con linea = ''
-- hasta correr `npm run db:ventas-recalcular` (reconstruye desde VentaDoc).
DROP INDEX "VentaItemIps_anio_mes_marca_referencia_ips_lista_instalac_key";

ALTER TABLE "VentaItemIps" ADD COLUMN "linea" TEXT NOT NULL DEFAULT '';

CREATE INDEX "VentaItemIps_linea_idx" ON "VentaItemIps"("linea");

CREATE UNIQUE INDEX "VentaItemIps_anio_mes_marca_referencia_ips_lista_instalacio_key" ON "VentaItemIps"("anio", "mes", "marca", "referencia", "ips", "lista", "instalacion", "linea");
