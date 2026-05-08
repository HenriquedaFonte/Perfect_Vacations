import pg from 'pg';
const { Client } = pg;

export const syncWithNeon = async (deals) => {
  console.log(`[syncWithNeon] Syncing ${deals.length} deals to database...`);
  
  if (!process.env.DATABASE_URL) {
    console.error('[syncWithNeon] DATABASE_URL is not set.');
    return [];
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const alerts = [];

  try {
    await client.connect();

    // Ensure the table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS travel_deals (
        id SERIAL PRIMARY KEY,
        hotel_name TEXT NOT NULL,
        departure_date DATE NOT NULL,
        price NUMERIC NOT NULL,
        link TEXT NOT NULL,
        stars NUMERIC,
        description TEXT,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (hotel_name, departure_date)
      )
    `);

    for (const deal of deals) {
      // Check if deal exists to determine if it's new or if price dropped
      const checkResult = await client.query(
        'SELECT price FROM travel_deals WHERE hotel_name = $1 AND departure_date = $2',
        [deal.hotelName, deal.date]
      );

      const existingDeal = checkResult.rows[0];

      if (!existingDeal) {
        // New deal
        await client.query(
          `INSERT INTO travel_deals (hotel_name, departure_date, price, link, stars, description)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [deal.hotelName, deal.date, deal.price, deal.link, deal.stars, deal.description]
        );
        
        alerts.push({
          type: 'NEW',
          deal: deal
        });
      } else if (deal.price < parseFloat(existingDeal.price)) {
        // Price dropped
        await client.query(
          'UPDATE travel_deals SET price = $1, last_seen = CURRENT_TIMESTAMP WHERE hotel_name = $2 AND departure_date = $3',
          [deal.price, deal.hotelName, deal.date]
        );

        alerts.push({
          type: 'PRICE_DROP',
          oldPrice: parseFloat(existingDeal.price),
          deal: deal
        });
      } else {
        // Just update last_seen
        await client.query(
          'UPDATE travel_deals SET last_seen = CURRENT_TIMESTAMP WHERE hotel_name = $1 AND departure_date = $2',
          [deal.hotelName, deal.date]
        );
      }
    }
  } catch (error) {
    console.error('[syncWithNeon] Database error:', error);
  } finally {
    await client.end();
  }

  return alerts;
};
