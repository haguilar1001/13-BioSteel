// Ayuda compartida para leer un filtro de selección múltiple desde la URL
// ("?marca=A,B,C"), igual convención que ya usaba "meses" y que adoptó
// Consumos para todos sus filtros.
export function listaDe(crudo: string | undefined, validos: Set<string>): string[] {
  if (!crudo) return [];
  return [...new Set(crudo.split(",").map((s) => s.trim()).filter(Boolean))].filter((v) => validos.has(v));
}
