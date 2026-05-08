export const applyQualityFilters = (deals, strictMode = true) => {
  console.log(`[applyQualityFilters] Filtering ${deals.length} deals. Strict mode: ${strictMode}`);
  
  const maxBudget = process.env.MAX_BUDGET ? parseFloat(process.env.MAX_BUDGET) : Infinity;

  return deals.filter(deal => {
    // Always filter by MAX_BUDGET
    if (deal.price > maxBudget) {
      return false;
    }

    if (strictMode) {
      // 5-stars, All-Inclusive, Beachfront
      const isFiveStars = deal.stars >= 5;
      const isAllInclusive = deal.description.toLowerCase().includes('all-inclusive') || deal.description.toLowerCase().includes('all inclusive');
      const isBeachfront = deal.description.toLowerCase().includes('beachfront') || deal.description.toLowerCase().includes('oceanfront');

      return isFiveStars && isAllInclusive && isBeachfront;
    }

    // Relaxed mode: just budget filter (already applied above) and maybe basic checks
    return deal.stars >= 4; 
  });
};
