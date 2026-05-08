import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(stealthPlugin());

export const fetchSunwingData = async (mode, targetMonths = []) => {
  console.log(`[fetchSunwingData] Starting scrape from YUL. Mode: ${mode}`);
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'en-CA',
    timezoneId: 'America/Montreal',
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();
  
  let deals = [];
  
  try {
    const processPage = async (url) => {
      console.log(`[fetchSunwingData] Navigating to ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      // Wait for dynamic React content to render prices
      await page.waitForTimeout(12000); 

      // Scroll down to trigger lazy loading
      await page.evaluate(async () => {
        for (let i = 0; i < 5; i++) {
          window.scrollBy(0, 1000);
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      });

      // Extract deals directly from the DOM
      const extractedDeals = await page.evaluate(() => {
        const results = [];
        // Look for typical deal card structures
        const cards = document.querySelectorAll('article, [class*="card"], [class*="package"], [class*="Result"]');
        
        cards.forEach(card => {
          const text = card.innerText || '';
          
          // Basic heuristic: a valid deal card usually has a $ price and mentions days/nights or all inclusive
          if (text.includes('$') && (text.toLowerCase().includes('night') || text.toLowerCase().includes('all inclusive') || text.toLowerCase().includes('star'))) {
            
            // Extract Link
            const linkElement = card.querySelector('a');
            const href = linkElement ? linkElement.href : window.location.href;
            
            // Extract Price
            const priceMatch = text.match(/\$[\d,]+/);
            if (!priceMatch) return;
            const price = parseFloat(priceMatch[0].replace('$', '').replace(',', ''));

            // Extract Hotel Name
            const lines = text.split('\\n').map(l => l.trim()).filter(l => l.length > 0);
            const hotelName = lines.length > 0 ? lines[0] : 'Unknown Resort';

            // Extract Stars
            let stars = 3; // Default fallback
            const starMatch = text.match(/(\d(\.\d)?)\s*star/i);
            if (starMatch) {
              stars = parseFloat(starMatch[1]);
            } else if (text.includes('5')) {
              stars = 5; // Rough heuristic if explicit '5 star' text is missing but rating is visually 5
            } else if (text.includes('4')) {
              stars = 4;
            }

            // Description
            const description = lines.join(' ').substring(0, 400);

            // Date (Default to today if unparseable, Neon DB expects a date string)
            let date = new Date().toISOString().split('T')[0];
            const dateMatch = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i);
            if (dateMatch) {
              date = dateMatch[0]; 
            }

            // Filter out junk
            if (price > 100 && hotelName.length > 3) {
              results.push({
                hotelName,
                price,
                date,
                link: href,
                stars,
                description
              });
            }
          }
        });

        // Deduplicate by hotel name
        const unique = [];
        const seen = new Set();
        results.forEach(r => {
          if (!seen.has(r.hotelName)) {
            seen.add(r.hotelName);
            unique.push(r);
          }
        });

        return unique;
      });
      
      return extractedDeals;
    };

    if (mode === 'lastMinute') {
      const url = 'https://www.sunwing.ca/en/promotion/last-minute-deals';
      const results = await processPage(url);
      deals = deals.concat(results);
    } else if (mode === 'future') {
      for (const month of targetMonths) {
        // Construct search URLs based on the target months
        const url = `https://www.sunwing.ca/en/search?from=YUL&date=${month}-01&flexibility=month&adults=2`;
        const results = await processPage(url);
        deals = deals.concat(results);
      }
    } else {
      throw new Error(`Invalid mode: ${mode}. Must be 'lastMinute' or 'future'.`);
    }

  } catch (error) {
    console.error('[fetchSunwingData] Error during scraping:', error);
  } finally {
    await browser.close();
  }

  return deals;
};
