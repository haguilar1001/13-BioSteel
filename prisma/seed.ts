// ==========================================================
// Seed — Datos base de BioSteel
// Idempotente: se puede correr varias veces sin duplicar.
// Ejecutar: npm run db:seed
// ==========================================================
import { PrismaClient, type AlcancePermiso } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { PERMISOS, ROLES_BASE, MATRIZ_ROLES } from "../src/lib/rbac/permissions";
import { CATEGORIAS_FLUJO } from "../src/lib/negocio/categorias-flujo";

const prisma = new PrismaClient();

// Parámetros Argon2id recomendados (OWASP)
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

async function main() {
  console.log("🌱 Sembrando datos base de BioSteel...");

  // --- Monedas ---
  const monedas = [
    { codigo: "COP", nombre: "Peso colombiano", simbolo: "$" },
    { codigo: "USD", nombre: "Dólar estadounidense", simbolo: "US$" },
    { codigo: "EUR", nombre: "Euro", simbolo: "€" },
  ];
  for (const m of monedas) {
    await prisma.moneda.upsert({ where: { codigo: m.codigo }, update: {}, create: m });
  }

  // --- Empresa y sedes ---
  const empresa = await prisma.empresa.upsert({
    where: { nit: "900000000-0" },
    update: {},
    create: { razonSocial: "BioSteel de Colombia S.A.S", nit: "900000000-0" },
  });

  const sedes = [
    { nombre: "Barranquilla (Administrativa)", tipo: "administrativa" as const, ciudad: "Barranquilla" },
    { nombre: "Bodega Barranquilla", tipo: "bodega" as const, ciudad: "Barranquilla" },
    { nombre: "Bodega Cali", tipo: "bodega" as const, ciudad: "Cali" },
    { nombre: "Bodega Cartagena", tipo: "bodega" as const, ciudad: "Cartagena" },
    { nombre: "Bodega Santa Marta", tipo: "bodega" as const, ciudad: "Santa Marta" },
    { nombre: "Bodega Sincelejo", tipo: "bodega" as const, ciudad: "Sincelejo" },
    { nombre: "Bodega Yopal", tipo: "bodega" as const, ciudad: "Yopal" },
  ];
  for (const s of sedes) {
    const existe = await prisma.sede.findFirst({ where: { nombre: s.nombre, empresaId: empresa.id } });
    if (!existe) await prisma.sede.create({ data: { ...s, empresaId: empresa.id } });
  }

  // --- Conceptos de retención (ejemplo Colombia; ajustar % reales) ---
  const retenciones = [
    { nombre: "ReteFuente (servicios)", tipo: "retefuente" as const, porcentaje: "2.5000" },
    { nombre: "ReteIVA", tipo: "reteiva" as const, porcentaje: "15.0000" },
    { nombre: "ReteICA (Barranquilla)", tipo: "reteica" as const, porcentaje: "0.6900" },
  ];
  for (const r of retenciones) {
    const existe = await prisma.conceptoRetencion.findFirst({ where: { nombre: r.nombre } });
    if (!existe) await prisma.conceptoRetencion.create({ data: r });
  }

  // --- Categorías de flujo (para la clasificación automática del importador) ---
  for (const c of CATEGORIAS_FLUJO) {
    await prisma.categoriaFlujo.upsert({
      where: { nombre: c.nombre },
      update: { tipo: c.tipo, orden: c.orden },
      create: { nombre: c.nombre, tipo: c.tipo, orden: c.orden },
    });
  }

  // --- Permisos ---
  for (const p of PERMISOS) {
    await prisma.permiso.upsert({
      where: { clave: p.clave },
      update: { modulo: p.modulo, descripcion: p.descripcion },
      create: p,
    });
  }

  // --- Roles + matriz de permisos ---
  for (const rolDef of ROLES_BASE) {
    const rol = await prisma.rol.upsert({
      where: { nombre: rolDef.nombre },
      update: { sistema: rolDef.sistema },
      create: { nombre: rolDef.nombre, sistema: rolDef.sistema },
    });

    const matriz = MATRIZ_ROLES[rolDef.nombre];
    for (const [clave, alcance] of Object.entries(matriz)) {
      const permiso = await prisma.permiso.findUnique({ where: { clave } });
      if (!permiso) continue;
      await prisma.rolPermiso.upsert({
        where: { rolId_permisoId: { rolId: rol.id, permisoId: permiso.id } },
        update: { alcance: alcance as AlcancePermiso },
        create: { rolId: rol.id, permisoId: permiso.id, alcance: alcance as AlcancePermiso },
      });
    }
  }

  // --- Usuario administrador inicial ---
  const rolAdmin = await prisma.rol.findUniqueOrThrow({ where: { nombre: "Administrador" } });
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@biosteel.co";
  const clave = process.env.SEED_ADMIN_PASSWORD ?? "Cambiar-Esta-Clave-2026!";
  const nombre = process.env.SEED_ADMIN_NOMBRE ?? "Administrador BioSteel";

  const passwordHash = await hash(clave, ARGON);
  await prisma.usuario.upsert({
    where: { email },
    update: {},
    create: { nombre, email, passwordHash, rolId: rolAdmin.id, sedeId: null, activo: true },
  });

  console.log("✅ Seed completado.");
  console.log(`   Admin: ${email}  (cambia la contraseña tras el primer ingreso)`);
}

main()
  .catch((e) => {
    console.error("❌ Error en el seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
