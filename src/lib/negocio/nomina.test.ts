import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mesesActivos, estaActivo } from "./nomina";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

// El costo del año de cada persona = costo mensual × meses activos en ese año.
describe("mesesActivos", () => {
  it("todo el año sin fechas = 12", () => {
    assert.equal(mesesActivos(2026, null, null), 12);
  });
  it("ingresó antes del año y sigue = 12", () => {
    assert.equal(mesesActivos(2026, d("2024-07-06"), null), 12);
  });
  it("retirado a fin de mes cuenta los meses completos (28/02 = 2 meses)", () => {
    assert.equal(mesesActivos(2026, d("2024-11-19"), d("2026-02-28")), 2);
  });
  it("retiro a mitad de mes cuenta la fracción de ese mes", () => {
    // 1/1 a 15/3 = 2 meses + 15/31
    assert.ok(Math.abs(mesesActivos(2026, null, d("2026-03-15")) - (2 + 15 / 31)) < 1e-9);
  });
  it("ingresó el 1 de septiembre = 4 meses", () => {
    assert.equal(mesesActivos(2026, d("2026-09-01"), null), 4);
  });
  it("retiro futuro (año siguiente) no recorta el año", () => {
    assert.equal(mesesActivos(2026, d("2026-01-01"), d("2027-03-01")), 12);
  });
  it("retirado el mismo día que ingresó cuenta ese día", () => {
    assert.ok(Math.abs(mesesActivos(2026, d("2026-01-09"), d("2026-01-09")) - 1 / 31) < 1e-9);
  });
  it("retirado antes del año = 0", () => {
    assert.equal(mesesActivos(2026, null, d("2025-12-31")), 0);
  });
  it("ingresó después del año = 0", () => {
    assert.equal(mesesActivos(2025, d("2026-01-01"), null), 0);
  });
});

describe("estaActivo", () => {
  const hoy = d("2026-10-08");
  it("sin retiro está activo", () => assert.equal(estaActivo(null, hoy), true));
  it("retiro futuro sigue activo", () => assert.equal(estaActivo(d("2027-03-01"), hoy), true));
  it("retiro hoy sigue activo ese día", () => assert.equal(estaActivo(d("2026-10-08"), hoy), true));
  it("retiro pasado ya no está activo", () => assert.equal(estaActivo(d("2026-02-28"), hoy), false));
});
