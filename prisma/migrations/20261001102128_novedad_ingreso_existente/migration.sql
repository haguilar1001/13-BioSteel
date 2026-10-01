-- Nueva novedad "Ingreso de equipo existente": equipos que ya eran de la
-- empresa y estaban pendientes por ingresar al inventario (distinto de
-- "compra", que es un equipo nuevo).
ALTER TYPE "TipoNovedad" ADD VALUE 'ingreso_existente';

-- Fecha de compra ORIGINAL, opcional: en "ingreso_existente" la fecha
-- principal (`fecha`) pasa a significar fecha de ingreso al inventario, y
-- esta columna guarda la fecha de compra si se conoce.
ALTER TABLE "NovedadInventario" ADD COLUMN "fechaCompraOriginal" DATE;
