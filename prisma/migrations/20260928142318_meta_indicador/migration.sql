-- Metas de indicadores configurables desde Administración → Metas de
-- indicadores, en vez de quedar escritas a mano en el código.
CREATE TABLE "MetaIndicador" (
    "id" SERIAL NOT NULL,
    "clave" TEXT NOT NULL,
    "valor" DECIMAL(6,2) NOT NULL,
    "descripcion" TEXT NOT NULL DEFAULT '',
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "actualizadoPor" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "MetaIndicador_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaIndicador_clave_key" ON "MetaIndicador"("clave");
