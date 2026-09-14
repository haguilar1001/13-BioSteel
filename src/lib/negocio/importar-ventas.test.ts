import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  limpiarMonto, parseFechaMDY, cantidadesSospechosas,
  normalizaBodega, mapaInstalacionPorBodega, resolverInstalacion,
  agregarVentas, type FilaVenta,
} from "./importar-ventas";

describe("limpiarMonto (ventas)", () => {
  it("limpia formato con $ y separadores", () => {
    assert.equal(limpiarMonto("$1,716,357.00"), 1716357);
    assert.equal(limpiarMonto("2565530"), 2565530);
  });
  it("acepta number y valores vacíos", () => {
    assert.equal(limpiarMonto(214706), 214706);
    assert.equal(limpiarMonto(""), 0);
    assert.equal(limpiarMonto(null), 0);
    assert.equal(limpiarMonto("abc"), 0);
  });
  it("paréntesis = negativo", () => assert.equal(limpiarMonto("(1500)"), -1500));

  // El libro se lee con raw:false, así que una celda con formato de porcentaje
  // llega como texto "200%" aunque su valor real sea 2. Sin esta regla la
  // cantidad se multiplica por cien: es lo que infló las unidades de 2026.
  describe("celdas con formato de porcentaje", () => {
    it("1 unidad formateada como porcentaje", () => assert.equal(limpiarMonto("100%"), 1));
    it("2 unidades", () => assert.equal(limpiarMonto("200%"), 2));
    it("4 unidades", () => assert.equal(limpiarMonto("400%"), 4));
    it("con separador de miles", () => assert.equal(limpiarMonto("1,500%"), 15));
    it("no toca las celdas normales", () => assert.equal(limpiarMonto("200"), 200));
  });
});

describe("cantidadesSospechosas (columna Cantidad ×100)", () => {
  const cant = (ns: number[]) => ns.map((cantidad) => ({ cantidad }));
  // Un archivo real: unidades sueltas, casi nunca redondas.
  const normal = cant([1, 2, 1, 6, 3, 14, 2, 1, 1, 4, 8, 2, 1, 5, 1, 2, 3, 1, 1, 2, 100, 200]);
  // Uno con la columna inflada: TODO múltiplo de 100.
  const inflado = cant([100, 200, 100, 600, 300, 1400, 200, 100, 100, 400, 800, 200,
    100, 500, 100, 200, 300, 100, 100, 200, 100, 300]);

  it("un archivo normal pasa", () => assert.equal(cantidadesSospechosas(normal), null));
  it("un archivo inflado se detiene", () => {
    const r = cantidadesSospechosas(inflado);
    assert.ok(r);
    assert.equal(r.conCantidad, 22);
    assert.equal(r.multiplos, 22);
  });
  it("los ceros no cuentan", () => assert.equal(cantidadesSospechosas(cant([0, 0, 0, 100, 200])), null));
  it("pocos renglones no alcanzan para acusar", () =>
    assert.equal(cantidadesSospechosas(cant([100, 200, 300])), null));
  it("una minoría redonda no basta", () =>
    assert.equal(cantidadesSospechosas(cant([...Array(19).fill(1), 100, 200, 300])), null));
});

describe("parseFechaMDY", () => {
  it("lee M/D/AA americano", () => {
    assert.deepEqual(parseFechaMDY("8/11/26"), { ms: Date.UTC(2026, 7, 11), anio: 2026, mes: 8 });
  });
  it("rechaza basura", () => assert.equal(parseFechaMDY("no es fecha"), null));
});

// Instalación de Consumos: el reporte de ventas solo trae el NOMBRE de la
// bodega (no el código), así que se cruza por descripción normalizada contra
// el mismo catálogo InvBodega de Compras/Osteosíntesis.
describe("normalizaBodega", () => {
  it("mayúsculas, sin tildes, espacios simples", () => {
    assert.equal(normalizaBodega("bodega   cAmpbéll"), "BODEGA CAMPBELL");
  });
});

// El reporte de SIESA trae la lista de precios a veces como código ("4") y a
// veces ya resuelta como nombre ("SOAT"), según el mes. Sin normalizar, la
// misma lista aparecía DOS veces en el filtro de Consumos —una por código y
// otra por nombre— con la utilidad partida entre las dos filas. Se arregla
// dentro de agregarVentas (no con un parche aparte sobre lo ya guardado: ese
// parche se deshacía solo en el siguiente recálculo, porque escribirAgregados
// reconstruye VentaItemIps entero cada vez).
describe("agregarVentas — normaliza la lista de precios (código → nombre)", () => {
  const fila = (over: Partial<FilaVenta>): FilaVenta => ({
    nro: "FET-1", tipo: "OTRO", aprobada: true, ms: Date.UTC(2026, 0, 15),
    anio: 2026, mes: 1, ips: "CLINICA X", suc: "", bod: "", notas: "TORNILLO", conv: "", proc: "", linea: "",
    subtotal: 100, costo: 60, cliente: "CLINICA X", nit: "900", marca: "1003 - SAMPEDRO",
    referencia: "REF1", cantidad: 1, lista: "",
    ...over,
  });

  it("código y nombre de la misma lista se funden en una sola fila", () => {
    const filas = [fila({ nro: "FET-1", lista: "4" }), fila({ nro: "FET-2", lista: "SOAT" })];
    const agg = agregarVentas(filas, [], new Set());
    assert.equal(agg.porItemIps.length, 1);
    assert.equal(agg.porItemIps[0]!.lista, "SOAT");
    assert.equal(agg.porItemIps[0]!.valor, 200);
    assert.equal(agg.porItemIps[0]!.cantidad, 2);
  });

  it("dos listas distintas NO se mezclan", () => {
    const filas = [fila({ nro: "FET-1", lista: "4" }), fila({ nro: "FET-2", lista: "5" })];
    const agg = agregarVentas(filas, [], new Set());
    assert.equal(agg.porItemIps.length, 2);
    assert.deepEqual(new Set(agg.porItemIps.map((f) => f.lista)), new Set(["SOAT", "ARL"]));
  });

  it("una lista sin catálogo (código desconocido) queda tal cual", () => {
    const agg = agregarVentas([fila({ lista: "777" })], [], new Set());
    assert.equal(agg.porItemIps[0]!.lista, "777");
  });
});

describe("mapaInstalacionPorBodega + resolverInstalacion", () => {
  const catalogo = [
    { descripcion: "BODEGA CAMPBELL", instalacion: 101 },
    { descripcion: "CONSIGNACION VALLESALUD", instalacion: 102 },
    { descripcion: "APROVECHAMIENTO CAMPBELL", instalacion: 106 },
    { descripcion: "PRESTAMO VALLESALUD SUR", instalacion: 104 },
    { descripcion: "BODEGA SAN FERNANDO", instalacion: 101 },
    { descripcion: "BODEGA UNDIDAD MEDICA TRAUMA DEL VALLE", instalacion: 101 },
    { descripcion: "BODEGA VALLE SALUD NORTE", instalacion: 101 },
    { descripcion: "BODEGA VALLE  SALUD SUR", instalacion: 101 },
  ];
  const mapa = mapaInstalacionPorBodega(catalogo);

  it("cruza exacto (insensible a mayúsculas/tildes)", () => {
    assert.equal(resolverInstalacion("Bodega Campbell", mapa), 101);
    assert.equal(resolverInstalacion("CONSIGNACION VALLESALUD", mapa), 102);
    assert.equal(resolverInstalacion("aprovechamiento campbell", mapa), 106);
    assert.equal(resolverInstalacion("PRESTAMO VALLESALUD SUR", mapa), 104);
  });

  // Los 4 nombres de VentaDoc.bod que no calzan letra por letra contra su
  // nombre en el catálogo (verificado el 2026-09-09 contra las 70 bodegas
  // reales de ventas: estos 4 son los únicos que necesitan alias).
  it("resuelve los 4 alias conocidos de ventas", () => {
    assert.equal(resolverInstalacion("SEDE SAN FERNANDO", mapa), 101);
    assert.equal(resolverInstalacion("UNIDAD MEDICA TRAUMA DEL VALLE", mapa), 101);
    assert.equal(resolverInstalacion("VALLE SALUD SEDE NORTE", mapa), 101);
    assert.equal(resolverInstalacion("VALLE SALUD SEDE SUR", mapa), 101);
    // Con tilde, como llega el dato real ("Notas ítem" del reporte no siempre la trae, pero la bodega sí).
    assert.equal(resolverInstalacion("UNIDAD MÉDICA TRAUMA DEL VALLE", mapa), 101);
  });

  it("una bodega que no está en el catálogo ni en los alias vuelve null", () => {
    assert.equal(resolverInstalacion("BODEGA NUEVA SIN CATALOGAR", mapa), null);
  });

  it("bodega vacía vuelve null", () => {
    assert.equal(resolverInstalacion("", mapa), null);
  });
});
