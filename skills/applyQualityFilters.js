/**
 * applyQualityFilters.js — Filtros de qualidade para deals do Sunwing
 *
 * Mode lastMinute (strictMode=true):
 *   - 5 estrelas EXATO (ou 4.5+)
 *   - Destinos: México, República Dominicana, Bahamas
 *   - Dentro do MAX_BUDGET
 *
 * Mode future (strictMode=false):
 *   - Qualquer destino
 *   - Dentro do MAX_BUDGET
 *   - Filtro leve de qualidade (stars >= 4)
 */

const LAST_MINUTE_DESTINATIONS = [
  'Mexico',
  'Dominican Republic',
  'Bahamas',
];

export const applyQualityFilters = (deals, strictMode = true) => {
  console.log(`[applyQualityFilters] Filtrando ${deals.length} deals | strictMode: ${strictMode}`);

  const maxBudget = process.env.MAX_BUDGET ? parseFloat(process.env.MAX_BUDGET) : Infinity;

  const filtered = deals.filter(deal => {
    // Filtro de budget (sempre aplicado)
    if (deal.price > maxBudget) {
      return false;
    }

    if (strictMode) {
      // LAST MINUTE: 5 estrelas + destino específico
      const is5Stars = deal.stars >= 5;
      const isTargetDest = LAST_MINUTE_DESTINATIONS.some(dest =>
        deal.country === dest || deal.destination.includes(dest)
      );

      if (!is5Stars) {
        console.log(`  [SKIP] ${deal.hotelName} — ${deal.stars} estrelas (precisa 5)`);
        return false;
      }
      if (!isTargetDest) {
        console.log(`  [SKIP] ${deal.hotelName} — destino "${deal.country}" fora do filtro`);
        return false;
      }
      return true;

    } else {
      // FUTURE: filtro leve — 4+ estrelas
      if (deal.stars < 4) {
        return false;
      }
      return true;
    }
  });

  console.log(`[applyQualityFilters] ${filtered.length} deals passaram no filtro`);

  // Ordenar por preço (menor primeiro)
  filtered.sort((a, b) => a.price - b.price);

  return filtered;
};
