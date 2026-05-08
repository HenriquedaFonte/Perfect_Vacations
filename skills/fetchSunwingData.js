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
      
      // 4. Debug Mode: Log Title and URL
      console.log(`[Debug] Current URL: ${page.url()}`);
      console.log(`[Debug] Page Title: ${await page.title()}`);

      // 3. Wait for Network Idle to ensure dynamic prices are loaded
      try {
        console.log('[fetchSunwingData] Waiting for network idle...');
        await page.waitForLoadState('networkidle', { timeout: 30000 });
      } catch (e) {
        console.log('[fetchSunwingData] Network idle wait timed out, proceeding anyway...');
      }

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
        
        // 1. Targeted Selectors: Look specifically for package cards
        let cards = Array.from(document.querySelectorAll('[data-testid*="package"], [class*="PackageCard"], [class*="Package"], article'));
        
        // 2. Price-First Logic: If we found no targeted cards, look for the $ sign and traverse up
        if (cards.length === 0) {
          const allTextNodes = Array.from(document.querySelectorAll('*'))
            .filter(el => el.children.length === 0 && (el.textContent.includes('$') || (typeof el.className === 'string' && el.className.includes('Price__Value'))));
            
          cards = allTextNodes.map(node => {
            let parent = node.parentElement;
            // Look up the tree until we find a reasonable container or hit the body
            let depth = 0;
            while (parent && parent.tagName !== 'BODY' && depth < 5) {
              if (parent.className && typeof parent.className === 'string' && 
                 (parent.className.includes('card') || parent.className.includes('container') || parent.className.includes('Package'))) {
                break;
              }
              parent = parent.parentElement;
              depth++;
            }
            return parent && parent.tagName !== 'BODY' ? parent : node.parentElement.parentElement;
          }).filter(Boolean);
        }

        cards.forEach(card => {
          const text = card.innerText || '';
          
          if (text.includes('$') && text.length > 30) {
            
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
              stars = 5; 
            } else if (text.includes('4')) {
              stars = 4;
            }

            // Description
            const description = lines.join(' ').substring(0, 400);

            // Date 
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
      const currentDate = new Date();
      currentDate.setDate(currentDate.getDate() + 7);
      const currentMonthStr = `${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
      
      const nextMonthDate = new Date();
      nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
      const nextMonthStr = `${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-01`;
      
      const targetLastMinuteMonths = [currentMonthStr, nextMonthStr];
      
      for (const month of targetLastMinuteMonths) {
        // Use exact same URL structure as future bot to avoid 404s
        const url = `https://www.sunwing.ca/en/search?from=YUL&date=${month}&flexibility=month&adults=2`;
        const results = await processPage(url);
        deals = deals.concat(results);
      }
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
