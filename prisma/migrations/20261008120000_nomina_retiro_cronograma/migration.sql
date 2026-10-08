-- Nómina: fecha de ingreso y de retiro (columnas FECHA INGRESO / FECHA RETIRO).
ALTER TABLE "Nomina" ADD COLUMN "fechaIngreso" DATE;
ALTER TABLE "Nomina" ADD COLUMN "fechaRetiro" DATE;

-- Capacitaciones: cronograma con el detalle de cada capacitación.
CREATE TABLE "CapacitacionCronograma" (
    "id" SERIAL NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "dia" INTEGER,
    "capacitacion" TEXT NOT NULL,
    "objetivo" TEXT NOT NULL DEFAULT '',
    "dirigidoA" TEXT NOT NULL DEFAULT '',
    "dirigidoPor" TEXT NOT NULL DEFAULT '',
    "modalidad" TEXT NOT NULL DEFAULT '',
    "estado" TEXT NOT NULL DEFAULT '',
    "evaluados" INTEGER NOT NULL DEFAULT 0,
    "promedioPre" DECIMAL(6,2),
    "promedioPost" DECIMAL(6,2),
    "promedioFinal" DECIMAL(6,2),
    "observaciones" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "CapacitacionCronograma_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CapacitacionCronograma_anio_mes_capacitacion_key" ON "CapacitacionCronograma"("anio", "mes", "capacitacion");
CREATE INDEX "CapacitacionCronograma_anio_mes_idx" ON "CapacitacionCronograma"("anio", "mes");

-- Novedades de inventario: las fechas elegidas en el formulario se guardaban a
-- medianoche UTC (= 7 p. m. del día ANTERIOR en Colombia) y los soportes salían
-- con fecha de ayer. Se mueven a mediodía UTC (7 a. m. hora Colombia).
UPDATE "NovedadInventario" SET "fecha" = "fecha" + INTERVAL '12 hours'
 WHERE "fecha"::time = TIME '00:00:00';
