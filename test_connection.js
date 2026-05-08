import 'dotenv/config';
import { syncWithNeon } from './skills/syncWithNeon.js';
import { sendTelegramAlert } from './skills/sendTelegramAlert.js';

const runTest = async () => {
  console.log('--- Running Connection Test ---');
  
  // Use a random number for the price to ensure it triggers a 'PRICE_DROP' if the hotel already exists,
  // or add a timestamp to the hotel name to ensure it's always treated as a 'NEW' deal.
  const uniqueHotelName = `TEST Hotel - ${Date.now()}`;
  
  const dummyDeals = [
    {
      hotelName: uniqueHotelName,
      price: 1.00,
      date: '2026-12-31',
      link: 'https://example.com',
      stars: 5,
      description: 'This is a test deal to verify the DB and Telegram connections.'
    }
  ];

  try {
    // 1. Sync with DB
    console.log('Testing Neon DB Connection...');
    const alerts = await syncWithNeon(dummyDeals);
    console.log(`DB Sync complete. Generated ${alerts.length} alert(s).`);

    // 2. Send Telegram Alert
    console.log('Testing Telegram Bot Connection...');
    if (alerts.length > 0) {
      await sendTelegramAlert(alerts, '🛠️ TEST NOTIFICATION:');
      console.log('Telegram alert sent successfully!');
    } else {
      console.log('No new alerts were generated (deal might already exist in the database with a lower price).');
      console.log('Forcing Telegram alert test...');
      await sendTelegramAlert([{ type: 'NEW', deal: dummyDeals[0] }], '🛠️ FORCED TEST NOTIFICATION:');
      console.log('Forced Telegram alert sent successfully!');
    }
  } catch (error) {
    console.error('Test failed:', error);
  }
};

runTest();
