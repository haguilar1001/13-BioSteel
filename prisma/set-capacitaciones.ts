// ==========================================================
// Carga el CONSOLIDADO DE CAPACITACIONES (Gestión Humana) desde el Excel,
// más el plan de formación del periodo.
//
// Mismo parser que la carga web (/cargar → "Capacitaciones · Consolidado"),
// por consola para la carga inicial y para volver a correrla sin depender del
// formulario. Reemplaza los meses que trae el archivo, así que es repetible.
//
// El PLAN (capacitaciones planeadas por mes) no viene en el consolidado: es
// el denominador del indicador de ejecución y se lleva aparte. Los valores de
// abajo son los del informe de indicadores del I semestre 2026; se siembran
// solo si el mes todavía no tiene plan, para no pisar un ajuste posterior.
//
// Uso:   npm run db:capacitaciones
//        ARCHIVO_CAPACITACIONES="D:/otra/ruta/archivo.xlsx" npm run db:capacitaciones
// ==========================================================
import "./_env";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { parseCapacitaciones, persistirCronograma } from "../src/lib/negocio/importar-capacitaciones";

const prisma = new PrismaClient();

const ARCHIVO = process.env.ARCHIVO_CAPACITACIONES
  ?? "D:/Escritorio/CONSOLIDADO_DE_CAPACITACIONES_2026.xlsx";

/** Plan de formación I semestre 2026 (informe de indicadores de Gestión Humana). */
const PLAN_2026: Record<number, number> = { 1: 3, 2: 2, 3: 5, 4: 3, 5: 4, 6: 2 };

async function main() {
  if (!fs.existsSync(ARCHIVO)) {
    throw new Error(`No encontré el archivo: ${ARCHIVO}\n   Pásalo con ARCHIVO_CAPACITACIONES="ruta/al/archivo.xlsx".`);
  }
  const nombre = ARCHIVO.split(/[\\/]/).pop()!;
  const p = parseCapacitaciones(fs.readFileSync(ARCHIVO), nombre);
  console.log(`🎓 Capacitaciones · hoja "${p.hoja}" · ${p.filas} fila(s) leídas, ${p.omitidas} omitida(s)`);

  for (const periodo of p.periodos) {
    const [anio, mes] = periodo.split("-").map(Number) as [number, number];
    await prisma.capacitacion.deleteMany({ where: { anio, mes } });
  }
  const res = await prisma.capacitacion.createMany({ data: p.datos, skipDuplicates: true });
  console.log(`   ✓ ${res.count} registro(s) en ${p.periodos.length} periodo(s): ${p.periodos.join(", ")}`);

  const nCrono = await persistirCronograma(p);
  console.log(`   ✓ cronograma: ${nCrono} capacitación(es) con su detalle`);

  // Plan de formación: solo los meses que aún no lo tienen.
  const anio = p.datos[0]!.anio;
  let sembrados = 0;
  for (const [mes, planeadas] of Object.entries(PLAN_2026)) {
    const existe = await prisma.capacitacionPlan.findUnique({ where: { anio_mes: { anio, mes: Number(mes) } } });
    if (existe) continue;
    await prisma.capacitacionPlan.create({ data: { anio, mes: Number(mes), planeadas } });
    sembrados++;
  }
  console.log(`   ✓ plan de formación: ${sembrados} mes(es) sembrado(s)`);

  const porCap = await prisma.capacitacion.groupBy({ by: ["capacitacion"], _count: true });
  const colaboradores = await prisma.capacitacion.groupBy({ by: ["colaborador"] });
  console.log(`\n📊 ${porCap.length} capacitaciones · ${colaboradores.length} colaboradores`);
  for (const c of porCap.sort((a, b) => b._count - a._count)) {
    console.log(`   ${c.capacitacion} · ${c._count} participante(s)`);
  }
}

main()
  .catch((e) => { console.error("❌", e instanceof Error ? e.message : e); process.exit(1); })
  .finally(() => prisma.$disconnect());
