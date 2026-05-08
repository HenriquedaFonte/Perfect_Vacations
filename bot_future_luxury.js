import 'dotenv/config';
import { fetchSunwingData } from './skills/fetchSunwingData.js';
import { applyQualityFilters } from './skills/applyQualityFilters.js';
import { syncWithNeon } from './skills/syncWithNeon.js';
import { sendTelegramAlert } from './skills/sendTelegramAlert.js';

const main = async () => {
  console.log('--- Starting Bot: Future Luxury Deals ---');

  const targetMonths = process.env.TARGET_MONTHS 
    ? process.env.TARGET_MONTHS.split(',').map(m => m.trim())
    : ['2026-10', '2026-11', '2026-12'];

  // 1. Scrape future deals for specific months
  const deals = await fetchSunwingData('future', targetMonths);
  
  console.log(`Scraper found ${deals.length} raw deals from Sunwing.`);
  
  // 2. Apply strict quality filters (strictMode = true)
  // Strict 5-stars, All-Inclusive, Beachfront, under budget
  const filteredDeals = applyQualityFilters(deals, true);

  console.log(`Found ${filteredDeals.length} deals matching the strict luxury criteria.`);

  // 3. Sync with database
  const alerts = await syncWithNeon(filteredDeals);

  // 4. Send Telegram alerts
  if (alerts.length > 0) {
    await sendTelegramAlert(alerts, '🏖️ PERFECT VACATION FOUND:');
  }

  console.log('--- Finished Bot: Future Luxury Deals ---');
};

main().catch(error => {
  console.error('Error in bot_future_luxury:', error);
  process.exit(1);
});
