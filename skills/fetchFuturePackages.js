/**
 * fetchFuturePackages.js
 *
 * Scrapes future (Nov/Dec 2026) 7-day packages from YUL via Sunwing.
 *
 * Strategy:
 *   ONE browser session for ALL target dates:
 *   1. Organic navigation on www.sunwing.ca (select Montreal + All Countries)
 *   2. Route interceptor on handler.cgi POST — injects target departure date
 *   3. DataDome bypassed: session + cookies persist across all searches
 *   4. Extract hotel cards from resultspackage-plus.cgi server-rendered HTML
 *   5. Navigate back to www.sunwing.ca between dates (keeps session alive)
 *
 * Key insight: single long-lived session is more human-like than many short
 * sessions. DataDome cookies + behavioral fingerprint persist and accumulate.
 */

import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(stealthPlugin());

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// All destination IDs for "All Countries" from YUL (captured from live BSB widget)
const ALL_DEST_IDS =
  '3_4_6_8_10_12_13_14_15_21_25_26_27_30_33_34_40_47_57_70_73_76_83_87_92_115_116_140_162_163_164_170_175_YYT_2_5_7_9_17_18_20_24_31_32_36_39_43_44_48_51_59_62_65_69_71_77_79_80_81_82_84_85_147_148_154_156_176_178_179_185_186_191_197_207_226_247_248_1249_1843_2974_4244_569962_581510_710451_1341400_2750814_3049105_3049111_3049121_3049149_3049151_3049153';

const MAX_RETRIES_INITIAL = 3;  // retries for the FIRST date (fresh session)
const INTER_DATE_WAIT_MS = 45000; // 45s between dates — lets DataDome rate-limit window reset

/**
 * Run a single search within an existing page context.
 * Navigates to www.sunwing.ca, fills form, submits.
 * The route interceptor on handler.cgi handles date injection.
 *
 * Returns { success, packageCount, hotels, bodyText }
 */
async function runSearch(page) {
  await page.goto('https://www.sunwing.ca/en', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await sleep(rand(3000, 5000));

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

  // Click Search (route interceptor injects target date)
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
    return {
      success: false,
      reason: `not on results page (${finalUrl.split('/').pop()})`,
    };
  }

  const bodyText = await page.evaluate(() => document.body?.innerText || '');
  if (bodyText.length < 500) {
    return { success: false, reason: 'empty/blocked body', bodyLength: bodyText.length };
  }

  const packageMatch = bodyText.match(/(\d+)\s+packages?\s+found/i);
  const packageCount = parseInt(packageMatch?.[1] || '0');

  return { success: true, packageCount, bodyText };
}

/**
 * Scrape all target dates in ONE browser session.
 *
 * @param {string[]} targetDates - Array of YYYYMMDD strings
 * @returns {Promise<Map<string, {hotels, packageCount}>>}
 */
export async function scrapeAllDatesInSession(targetDates) {
  const results = new Map();

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

  // Mutable reference for current target date — updated before each search
  let _currentTargetDate = targetDates[0];

  // Install route interceptor ONCE — it reads _currentTargetDate dynamically
  await page.route('**/handler.cgi**', async (route, request) => {
    const postData = request.postData() || '';
    const params = new URLSearchParams(postData);

    // Fallback template if BSB didn't send params (edge case)
    if (!params.get('gateway_dep')) {
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

    params.set('date_dep', _currentTargetDate);
    params.set('duration', '7DAYS');

    await route.continue({ postData: params.toString() });
  });

  try {
    let sessionEstablished = false;

    for (let i = 0; i < targetDates.length; i++) {
      const date = targetDates[i];
      _currentTargetDate = date; // update route interceptor's date
      console.log(`  [Session] Searching date ${i + 1}/${targetDates.length}: ${date}`);

      // Retry logic per date
      const maxRetries = sessionEstablished ? 2 : MAX_RETRIES_INITIAL;
      let searchResult = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (attempt > 1) {
          const wait = rand(5000, 10000);
          console.log(`    Retry ${attempt}/${maxRetries} in ${Math.round(wait/1000)}s...`);
          await sleep(wait);
        }

        try {
          searchResult = await runSearch(page);
          if (searchResult.success) break;
          console.log(`    Attempt ${attempt} failed: ${searchResult.reason}`);
        } catch(e) {
          console.log(`    Attempt ${attempt} error: ${e.message}`);
          searchResult = { success: false, reason: e.message };
        }
      }

      if (!searchResult?.success) {
        console.log(`  ⚠️  ${date}: all attempts failed (${searchResult?.reason})`);
        results.set(date, { hotels: [], packageCount: 0 });

        // If this is the very first date and it failed, close session
        if (!sessionEstablished) {
          console.log('  First date failed — closing session and aborting.');
          break;
        }
      } else {
        sessionEstablished = true;
        const hotels = parseHotelsFromText(searchResult.bodyText);
        console.log(`  ✅ ${date}: ${searchResult.packageCount} packages, ${hotels.length} hotels parsed`);
        results.set(date, { hotels, packageCount: searchResult.packageCount });
      }

      // Wait between dates (let DataDome rate-limiting window reset)
      if (i < targetDates.length - 1) {
        const waitMs = sessionEstablished ? INTER_DATE_WAIT_MS : 5000;
        console.log(`  Waiting ${Math.round(waitMs/1000)}s before next date...`);
        await sleep(waitMs);
      }
    }
  } catch(e) {
    console.log(`  Session error: ${e.message}`);
  } finally {
    await browser.close();
  }

  return results;
}

/**
 * Main function: scrape packages for a single date with full retry logic.
 * Used when only one date needs to be refreshed.
 *
 * @param {string} targetDate - Format: YYYYMMDD
 * @returns {Promise<{hotels, packageCount, attempts}>}
 */
export async function fetchFuturePackages(targetDate) {
  console.log(`[fetchFuturePackages] ${targetDate} | 7 days | YUL → All Countries`);

  for (let attempt = 1; attempt <= MAX_RETRIES_INITIAL; attempt++) {
    if (attempt > 1) {
      const wait = rand(5000, 12000);
      console.log(`  Retry ${attempt}/${MAX_RETRIES_INITIAL} (${Math.round(wait/1000)}s)...`);
      await sleep(wait);
    }

    const sessionResult = await scrapeAllDatesInSession([targetDate]);
    const result = sessionResult.get(targetDate);

    if (result && result.hotels.length > 0) {
      console.log(`  ✅ ${targetDate}: found ${result.hotels.length} hotels`);
      return { ...result, attempts: attempt, targetDate };
    }

    console.log(`  ❌ Attempt ${attempt} failed`);
  }

  return { hotels: [], packageCount: 0, attempts: MAX_RETRIES_INITIAL, targetDate };
}

/**
 * Parse hotel cards from the results page text.
 */
function parseHotelsFromText(text) {
  const hotels = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Look for date line: "Day, DD Mon YYYY | N days | All Inclusive"
    const dateMatch = line.match(
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s*\|\s*(\d+)\s+days/i
    );

    if (!dateMatch) continue;

    const [, , day, month, year, duration] = dateMatch;
    if (parseInt(duration) !== 7) continue;

    // Find hotel name, location, and star rating (look back up to 12 lines)
    let hotelName = '';
    let location = '';
    let stars = 0; // 0 = unable to detect

    for (let j = i - 1; j >= Math.max(0, i - 12); j--) {
      const l = lines[j];
      if (!l || l === 'Our top pick' || l === 'Filter' || l === 'Sort' || l.startsWith('$')) continue;

      // Star rating line: ★★★★★ (filled), ☆ (empty), or "5 Stars" / "4 Stars"
      if (stars === 0) {
        const filledStars = (l.match(/★/g) || []).length;
        const emptyStars  = (l.match(/☆/g) || []).length;
        const totalStars  = filledStars + emptyStars;
        if (filledStars > 0 && totalStars >= 1 && totalStars <= 5) {
          stars = filledStars; // filled stars = hotel category
          continue;
        }
        const starsTextMatch = l.match(/^(\d)\s+Stars?$/i);
        if (starsTextMatch) {
          stars = parseInt(starsTextMatch[1]);
          continue;
        }
      }

      if (!location && l.match(/,\s*(Mexico|Dominican|Bahamas|Cuba|Jamaica|Costa Rica|Antigua|Barbados|Saint Lucia|Panama|Colombia|Aruba|Honduras|Nicaragua|St\.|Cancun|Riviera|Punta|Playa|Mazatlan|Cozumel|Los Cabos|Puerto Vallarta)/i)) {
        location = l.replace(/\s+(Very Good|Good|Excellent|Superior|Outstanding)\s+[\d.]+\s+\d+\+?\s*Reviews?.*$/i, '').trim();
        continue;
      }

      if (!hotelName && /^[A-Z]/.test(l) && l.length > 5 && l.length < 120) {
        if (!l.match(/\d\.\d\s+\d+/) && l !== location) {
          hotelName = l.replace(/\s+(Superior|Excellent|Very Good|Good|Outstanding).*$/i, '').trim();
          break;
        }
      }
    }

    if (!hotelName) continue;

    // Find price (look forward up to 20 lines)
    let pricePerAdult = 0;
    let total = 0;
    let seenPerAdult = false;

    for (let j = i + 1; j < Math.min(i + 22, lines.length); j++) {
      const l = lines[j];
      if (l.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+\d/i)) break;
      if (l === 'Select' || l === 'Compare') break;

      if (l === 'per adult') { seenPerAdult = true; continue; }

      if (!seenPerAdult) {
        const m = l.match(/^\$?([\d,]+)$/);
        if (m) {
          const val = parseInt(m[1].replace(/,/g, ''));
          if (val > 400 && val < 15000) pricePerAdult = val;
        }
      } else if (l === 'Total') {
        for (let k = j + 1; k < Math.min(j + 5, lines.length); k++) {
          const tm = lines[k]?.match(/^\$?([\d,]+)$/);
          if (tm) {
            total = parseInt(tm[1].replace(/,/g, ''));
            break;
          }
        }
        break;
      }
    }

    if (pricePerAdult === 0) continue;

    // Determine country
    const loc = location.toLowerCase();
    let country = '';
    if (loc.includes('mexico') || loc.includes('cancun') || loc.includes('riviera') ||
        loc.includes('mazatlan') || loc.includes('playa') || loc.includes('cozumel') ||
        loc.includes('los cabos') || loc.includes('puerto')) country = 'Mexico';
    else if (loc.includes('dominican') || loc.includes('punta cana') ||
             loc.includes('santo domingo') || loc.includes('romana') ||
             loc.includes('miches') || loc.includes('bayahibe') || loc.includes('juan dolio')) country = 'Dominican Republic';
    else if (loc.includes('bahamas') || loc.includes('nassau') || loc.includes('freeport')) country = 'Bahamas';
    else if (loc.includes('cuba')) country = 'Cuba';
    else if (loc.includes('jamaica')) country = 'Jamaica';
    else if (loc.includes('saint lucia') || loc.includes('st. lucia')) country = 'Saint Lucia';
    else country = location.split(',').pop()?.trim() || location;

    const monthIdx = monthNames.indexOf(month.charAt(0).toUpperCase() + month.slice(1).toLowerCase());
    const departureDate = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    hotels.push({
      name: hotelName,
      location,
      country,
      departureDate,
      duration: 7,
      pricePerAdult,
      total: total || pricePerAdult * 2,
      stars, // 0 = unable to detect from text (CSS/SVG icons not in innerText)
      source: 'sunwing',
    });
  }

  return hotels;
}

/**
 * Get all target dates for Nov/Dec 2026 monitoring.
 */
export function getFutureTargetDates() {
  return [
    '20261101', '20261108', '20261115', '20261122', '20261129',
    '20261206', '20261213', '20261220', '20261227',
  ];
}
