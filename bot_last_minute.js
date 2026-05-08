import 'dotenv/config';
import { fetchSunwingData } from './skills/fetchSunwingData.js';
import { applyQualityFilters } from './skills/applyQualityFilters.js';
import { syncWithNeon } from './skills/syncWithNeon.js';
import { sendTelegramAlert } from './skills/sendTelegramAlert.js';

const main = async () => {
  console.log('--- Starting Bot: Last Minute Deals ---');
  
  // 1. Scrape last minute deals
  const deals = await fetchSunwingData('lastMinute');
  
  console.log(`Scraper found ${deals.length} raw deals from Sunwing.`);
  
  // 2. Apply relaxed quality filters (strictMode = false)
  // This just checks the budget and a lower minimum star rating
  const filteredDeals = applyQualityFilters(deals, false);
  
  console.log(`Found ${filteredDeals.length} deals matching the relaxed criteria.`);

  // 3. Sync with database
  const alerts = await syncWithNeon(filteredDeals);

  // 4. Send Telegram alerts
  if (alerts.length > 0) {
    await sendTelegramAlert(alerts, '🚨 LAST MINUTE DEAL:');
  }

  console.log('--- Finished Bot: Last Minute Deals ---');
};

main().catch(error => {
  console.error('Error in bot_last_minute:', error);
  process.exit(1);
});
