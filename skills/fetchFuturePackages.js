/**
 * fetchFuturePackages.js
 *
 * Scrapes future (Nov/Dec 2026) 7-day packages from YUL via Sunwing.
 *
 * Strategy:
 *   1. Organic navigation on www.sunwing.ca (select Montreal + All Countries)
 *   2. Intercept handler.cgi POST body — inject target departure date
 *   3. DataDome sees legitimate organic session (bypassed)
 *   4. Extract hotel cards from resultspackage-plus.cgi server-rendered HTML
 *   5. Retry on block (up to MAX_RETRIES, different browser context each time)
 */

import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(stealthPlugin());

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// All destination IDs for "All Countries" from YUL (captured from live BSB widget)
const ALL_DEST_IDS =
  '3_4_6_8_10_12_13_14_15_21_25_26_27_30_33_34_40_47_57_70_73_76_83_87_92_115_116_140_162_163_164_170_175_YYT_2_5_7_9_17_18_20_24_31_32_36_39_43_44_48_51_59_62_65_69_71_77_79_80_81_82_84_85_147_148_154_156_176_178_179_185_186_191_197_207_226_247_248_1249_1843_2974_4244_569962_581510_710451_1341400_2750814_3049105_3049111_3049121_3049149_3049151_3049153';

const MAX_RETRIES = 5;
const MAX_PAGES = 3; // scrape first 30 hotels per date

/**
 * Single attempt: navigate organically, intercept POST, extract results.
 * Returns { success, hotels, packageCount } or { success: false, reason }
 */
async function attemptScrape(targetDate, pageNum = 1) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  const context = await browser.newContext({
    locale: 'en-CA',
    timezoneId: 'America/Montreal',
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'en-CA,en;q=0.9,fr-CA;q=0.8' },
  });

  const page = await context.newPage();

  // Intercept handler.cgi POST — inject our target date (keep all other params)
  await page.route('**/handler.cgi**', async (route, request) => {
    const postData = request.postData() || '';
    const params = new URLSearchParams(postData);

    // If BSB widget params are present (expected), just override the date
    // If the POST body is empty (edge case), build from known template
    if (!params.get('gateway_dep')) {
      // Fallback: construct full POST body from the template captured on 2026-05-27
      params.set('language', 'en');
      params.set('code_ag', 'rds');
      params.set('alias', 'btd');
      params.set('engine', 'S');
      params.set('searchtype', 'PA');
      params.set('gateway_dep', 'YUL');
      params.set('dest_dep', ALL_DEST_IDS);
      params.set('nb_rooms', '1');
      params.set('nb_adult_forf', '2');
      params.set('nb_child', '0');
    }

    // Override date and ensure correct duration format
    params.set('date_dep', targetDate);
    params.set('duration', '7DAYS');

    await route.continue({ postData: params.toString() });
  });

  try {
    // Load home page
    await page.goto('https://www.sunwing.ca/en', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await sleep(rand(3000, 5500));

    // Human-like pre-interaction
    await page.mouse.move(rand(300, 900), rand(200, 600));
    await sleep(rand(200, 500));
    await page.evaluate(() =>
      window.scrollBy(0, Math.floor(Math.random() * 100) + 30)
    );
    await sleep(rand(300, 600));

    // Select Montreal
    const fromInput = await page.$('#booking-search-box-wrapper >> #packages-from-input');
    if (!fromInput) throw new Error('From input not found');

    await fromInput.click({ clickCount: 3 });
    await fromInput.type('Montreal', { delay: rand(40, 90) });
    await sleep(rand(1200, 2000));

    const montrealOk = await page.evaluate(() => {
      const host = document.getElementById('booking-search-box-wrapper');
      if (!host?.shadowRoot) return false;
      const els = Array.from(host.shadowRoot.querySelectorAll('*'));
      const el = els.find(
        e =>
          (e.textContent?.trim() === 'Montréal' ||
            e.textContent?.trim() === 'Montreal, QC' ||
            e.textContent?.trim() === 'Montreal') &&
          e.children.length === 0
      );
      if (el) { el.click(); return true; }
      return false;
    });
    if (!montrealOk) throw new Error('Montreal suggestion not found');
    await sleep(rand(800, 1300));

    // Select All Countries destination
    const toInput = await page.$('#booking-search-box-wrapper >> #packages-to-input');
    if (!toInput) throw new Error('Destination input not found');
    await toInput.click({ clickCount: 3 });
    await sleep(rand(500, 900));

    const destOk = await page.evaluate(() => {
      const host = document.getElementById('booking-search-box-wrapper');
      if (!host?.shadowRoot) return false;
      const els = Array.from(host.shadowRoot.querySelectorAll('*'));
      const el =
        els.find(e => e.textContent?.trim() === 'All Countries' && e.children.length === 0) ||
        els.find(e => e.tagName === 'LI' && e.textContent?.trim().length > 2);
      if (el) { el.click(); return true; }
      return false;
    });
    if (!destOk) throw new Error('Destination dropdown not found');
    await sleep(rand(700, 1200));

    // Click Search (handler.cgi POST will be intercepted to inject November date)
    const searchBtn = await page.$('#booking-search-box-wrapper >> button[type="submit"]');
    if (!searchBtn) throw new Error('Search button not found');

    const navPromise = page
      .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 })
      .catch(() => null);
    await searchBtn.click();
    await navPromise;
    await sleep(rand(4000, 7000));

    const finalUrl = page.url();
    if (!finalUrl.includes('resultspackage-plus')) {
      const body = await page.evaluate(() => document.body?.innerText?.substring(0, 100) || '');
      return {
        success: false,
        reason: `not on results page (${finalUrl.split('/').pop()})`,
        body,
      };
    }

    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    if (bodyText.length < 500) {
      return { success: false, reason: 'empty/blocked body', bodyLength: bodyText.length };
    }

    const packageMatch = bodyText.match(/(\d+)\s+packages?\s+found/i);
    const packageCount = parseInt(packageMatch?.[1] || '0');

    // Extract hotel data from page text
    const hotels = parseHotelsFromText(bodyText, targetDate);

    // If we need more pages, paginate
    if (pageNum > 1) {
      // Navigate to subsequent pages via the sid
      // (Implementation for page 2+ would require extracting the sid from the page
      // and making additional requests — skipping for now, page 1 gives top deals)
    }

    return { success: true, packageCount, hotels, url: finalUrl, bodyText };
  } catch (e) {
    return { success: false, reason: e.message };
  } finally {
    await browser.close();
  }
}

/**
 * Parse hotel cards from the results page text.
 * Each card pattern:
 *   [Hotel Name]
 *   [City, Country] [Rating?] [N Reviews?]
 *   [Weekday, DD Mon YYYY] | [N] days | All Inclusive
 *   [Room info]
 *   ...
 *   $[price] per adult
 *   Total $[total]
 */
function parseHotelsFromText(text, targetDate) {
  const hotels = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // e.g. targetDate=20261101 → "Nov"
  const targetMonthName = monthNames[parseInt(targetDate.substring(4, 6)) - 1];
  const targetYear = targetDate.substring(0, 4);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Look for the date line: "Day, DD Mon YYYY | N days | All Inclusive"
    const dateMatch = line.match(
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s*\|\s*(\d+)\s+days/i
    );

    if (!dateMatch) continue;

    const [, weekday, day, month, year, duration] = dateMatch;
    if (parseInt(duration) !== 7) continue; // only 7-day packages

    // Find hotel name and location: look back up to 8 lines before the date line
    let hotelName = '';
    let location = '';
    let stars = 0;

    for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
      const l = lines[j];

      // Skip non-useful lines
      if (!l || l === 'Our top pick' || l === 'Filter' || l === 'Sort' || l.startsWith('$')) continue;

      // Location pattern: "City, Country" with optional rating/reviews
      if (!location && l.match(/,\s*(Mexico|Dominican|Dominican Republic|Bahamas|Cuba|Jamaica|Costa Rica|Antigua|Barbados|Saint Lucia|Panama|Colombia|Aruba|Honduras|Nicaragua|St\.|Cancun|Riviera|Punta|Playa)/i)) {
        location = l.replace(/\s+(Very Good|Good|Excellent|Superior|Outstanding)\s+[\d.]+\s+\d+\+?\s*Reviews?.*$/i, '').trim();
        continue;
      }

      // Look for star ratings from the line content
      if (l.match(/\d\.\d\s+\d+\+?\s*Reviews?/i)) continue; // skip review lines

      // Hotel name: starts with capital, reasonable length, after location is set
      if (!hotelName && /^[A-Z]/.test(l) && l.length > 5 && l.length < 100) {
        // This is likely the hotel name
        hotelName = l.replace(/\s+(Superior|Excellent|Very Good|Good|Outstanding).*$/i, '').trim();
        break;
      }
    }

    if (!hotelName) continue;

    // Find price after the date line: look for "$XXXX" followed by "per adult"
    let pricePerAdult = 0;
    let total = 0;
    let foundPerAdult = false;

    for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
      const l = lines[j];

      // Stop at next hotel card or alternate dates section
      if (l.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/i)) break;
      if (l === 'Select' || l === 'Compare') break;

      if (l === 'per adult') {
        foundPerAdult = true;
        continue;
      }

      if (foundPerAdult && l === 'Total') {
        // Next dollar amount after "Total" is the total
        for (let k = j + 1; k < Math.min(j + 5, lines.length); k++) {
          const totalMatch = lines[k]?.match(/^\$?([\d,]+)$/);
          if (totalMatch) {
            total = parseInt(totalMatch[1].replace(/,/g, ''));
            break;
          }
        }
        break;
      }

      // Dollar amount before "per adult"
      if (!foundPerAdult) {
        const priceMatch = l.match(/^\$?([\d,]+)$/);
        if (priceMatch) {
          const val = parseInt(priceMatch[1].replace(/,/g, ''));
          if (val > 500 && val < 10000) {
            pricePerAdult = val;
          }
        }
      }
    }

    if (pricePerAdult === 0) continue; // skip if no price found

    // Extract destination country for filtering
    const locationLower = location.toLowerCase();
    let country = '';
    if (locationLower.includes('mexico') || locationLower.includes('cancun') ||
        locationLower.includes('riviera') || locationLower.includes('mazatlan') ||
        locationLower.includes('playa')) country = 'Mexico';
    else if (locationLower.includes('dominican') || locationLower.includes('punta cana') ||
             locationLower.includes('santo domingo') || locationLower.includes('romana') ||
             locationLower.includes('miches') || locationLower.includes('bayahibe')) country = 'Dominican Republic';
    else if (locationLower.includes('bahamas') || locationLower.includes('nassau') ||
             locationLower.includes('freeport')) country = 'Bahamas';
    else if (locationLower.includes('cuba')) country = 'Cuba';
    else if (locationLower.includes('jamaica')) country = 'Jamaica';
    else if (locationLower.includes('saint lucia') || locationLower.includes('st. lucia')) country = 'Saint Lucia';
    else country = location.split(',').pop()?.trim() || location;

    hotels.push({
      name: hotelName,
      location,
      country,
      departureDate: `${year}-${String(monthNames.indexOf(month) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      duration: parseInt(duration),
      pricePerAdult,
      total: total || pricePerAdult * 2,
      stars,
      source: 'sunwing',
    });
  }

  return hotels;
}

/**
 * Main function: scrape packages for a given departure date with retries.
 * @param {string} targetDate - Format: YYYYMMDD (e.g., '20261101')
 * @param {number} durationDays - Duration (always 7 for this bot)
 * @returns {Promise<{hotels: Array, packageCount: number, attempts: number}>}
 */
export async function fetchFuturePackages(targetDate, durationDays = 7) {
  console.log(`[fetchFuturePackages] Searching: ${targetDate}, ${durationDays} days, YUL → All Countries`);

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      const wait = rand(3000, 8000);
      console.log(`  Retry ${attempt}/${MAX_RETRIES} (waiting ${Math.round(wait/1000)}s)...`);
      await sleep(wait);
    }

    const result = await attemptScrape(targetDate, 1);

    if (result.success) {
      console.log(`  ✅ Success on attempt ${attempt}. Packages: ${result.packageCount}, Hotels parsed: ${result.hotels.length}`);
      return {
        hotels: result.hotels,
        packageCount: result.packageCount,
        attempts: attempt,
        targetDate,
      };
    }

    lastError = result.reason;
    console.log(`  ❌ Attempt ${attempt} failed: ${lastError}`);
  }

  console.log(`  ⚠️  All ${MAX_RETRIES} attempts failed for ${targetDate}: ${lastError}`);
  return { hotels: [], packageCount: 0, attempts: MAX_RETRIES, targetDate };
}

/**
 * Get all target dates for future monitoring (Nov/Dec 2026).
 * Returns departure dates in YYYYMMDD format.
 */
export function getFutureTargetDates() {
  // Key Saturdays in November and December 2026
  return [
    '20261101', // Nov 1 (Saturday)
    '20261108', // Nov 8 (Sunday — nearby search for the week)
    '20261115', // Nov 15
    '20261122', // Nov 22
    '20261129', // Nov 29
    '20261206', // Dec 6
    '20261213', // Dec 13
    '20261220', // Dec 20
    '20261227', // Dec 27
  ];
}
