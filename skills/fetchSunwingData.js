/**
 * fetchSunwingData.js — Sunwing scraper (v2 — seletores reais)
 *
 * Estratégia descoberta via inspeção de rede:
 * - URL base: www.sunwing.ca/en/promotion/packages/{page}  (NÃO o /search que retorna 404)
 * - Seletor de preço: [class*="hotelDetailsAmount"]
 * - Stars: .swg-icon-star (full) e .swg-icon-star-half (half)
 * - Links: a[href*="book.sunwing.ca"] com gateway_dep={GATEWAY}
 * - Dados por linha do card text: Destino, Hotel, Data, Duração, Features, Saving, was $X, $Y
 */

import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(stealthPlugin());

const GATEWAY = 'YUL'; // Montreal

const PAGES = {
  lastMinute: 'https://www.sunwing.ca/en/promotion/packages/last-minute-vacations',
  luxury:     'https://www.sunwing.ca/en/promotion/packages/luxury-vacations',
};

// Aguarda até o texto de um elemento aparecer na página (para confirmar que o clique funcionou)
const waitForCity = async (page, cityText, timeout = 15000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const priceCount = await page.evaluate(() =>
      document.querySelectorAll('[class*="hotelDetailsAmount"]').length
    );
    if (priceCount > 0) return true;
    await page.waitForTimeout(500);
  }
  return false;
};

const clickMontreal = async (page) => {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*')).filter(el => {
      const t = el.textContent.trim();
      return (t === 'Montréal' || t === 'Montreal') && el.children.length === 0;
    });
    if (els.length > 0) {
      els[0].click();
      if (els[0].parentElement) els[0].parentElement.click();
      return true;
    }
    return false;
  });
};

const extractCardsFromPage = async (page) => {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[class*="CardType-module--card"]'));
    const results = [];

    for (const card of cards) {
      try {
        // --- PREÇO ATUAL ---
        const priceEl = card.querySelector('[class*="hotelDetailsAmount"]');
        if (!priceEl) continue; // Sem preço = card inválido

        const priceText = priceEl.textContent.trim();
        const price = parseFloat(priceText.replace('$', '').replace(',', ''));
        if (isNaN(price) || price < 100) continue;

        // --- WAS PRICE ---
        const wasEl = card.querySelector('[class*="hotelDetailsWas"]');
        const wasText = wasEl?.textContent?.trim() || '';
        const wasMatch = wasText.match(/\$(\d[\d,]*)/);
        const wasPrice = wasMatch ? parseFloat(wasMatch[1].replace(',', '')) : null;

        // --- LINK E HOTEL CODE ---
        const linkEl = card.querySelector('a[href*="sunwing"]');
        let href = linkEl?.href || '';
        // Garantir que o gateway é YUL (não YYZ padrão)
        href = href.replace('gateway_dep=YYZ', 'gateway_dep=YUL');
        const hotelCodeMatch = href.match(/no_hotel=(\d+)/);
        const hotelCode = hotelCodeMatch ? hotelCodeMatch[1] : null;

        // --- ESTRELAS ---
        // Contar spans com classe específica de estrela
        const allStarEls = Array.from(card.querySelectorAll('[class*="swg-icon"]'));
        const fullStars = allStarEls.filter(el =>
          el.className.includes('swg-icon-star') && !el.className.includes('star-half')
        ).length;
        const halfStars = allStarEls.filter(el =>
          el.className.includes('swg-icon-star-half')
        ).length;
        const stars = fullStars + halfStars * 0.5;

        // --- DADOS DO CARD (PARSING DO TEXTO) ---
        const rawText = card.innerText || '';
        // Remover linhas com HTML, pegar só texto limpo
        const lines = rawText
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 0 && !l.startsWith('<'));

        // As primeiras linhas têm o padrão: Destination, Hotel, Date, Duration, Features...
        // Mas podem aparecer duplicadas (hotel name repete no final). Pegamos as primeiras 10.
        const cleanLines = lines.slice(0, 12);

        // Linha 0: Destino (ex: "Riviera Maya, Mexico")
        const destination = cleanLines[0] || '';

        // Linha 1: Nome do hotel
        const hotelName = cleanLines[1] || '';

        // Data: encontrar linha no formato "May 28, 2026" ou "Jun 16, 2026"
        const datePattern = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}$/i;
        const dateLine = cleanLines.find(l => datePattern.test(l));
        const departureDate = dateLine || '';

        // Extrair data no formato YYYY-MM-DD para o DB
        let departureDateISO = null;
        if (dateLine) {
          try {
            const d = new Date(dateLine);
            if (!isNaN(d.getTime())) {
              departureDateISO = d.toISOString().split('T')[0];
            }
          } catch {}
        }

        // Duração: linha com "X days"
        const durationLine = cleanLines.find(l => /^\d+ days?$/i.test(l));
        const duration = durationLine ? parseInt(durationLine) : 7;

        // Features: All Inclusive, etc.
        const isAllInclusive = rawText.toLowerCase().includes('all inclusive') ||
                               rawText.toLowerCase().includes('all-inclusive');

        // País/destino
        const destLower = destination.toLowerCase();
        const country = destLower.includes('mexico')               ? 'Mexico'
                      : destLower.includes('dominican republic')   ? 'Dominican Republic'
                      : destLower.includes('bahamas')              ? 'Bahamas'
                      : destLower.includes('cuba')                 ? 'Cuba'
                      : destLower.includes('jamaica')              ? 'Jamaica'
                      : destLower.includes('costa rica')           ? 'Costa Rica'
                      : destLower.includes('aruba')                ? 'Aruba'
                      : destLower.includes('barbados')             ? 'Barbados'
                      : destLower.includes('saint lucia')          ? 'Saint Lucia'
                      : destination;

        if (!hotelName || !destination) continue;

        results.push({
          hotelName,
          destination,
          country,
          date: departureDateISO || departureDate,
          duration,
          price,
          wasPrice,
          stars,
          isAllInclusive,
          hotelCode,
          link: href,
          description: `${destination} | ${duration} days | Stars: ${stars} | AllInclusive: ${isAllInclusive}`,
        });
      } catch (e) {
        // Ignorar cards com erro de parse
      }
    }

    // Deduplicar por hotelCode + date
    const seen = new Set();
    return results.filter(r => {
      const key = `${r.hotelCode}-${r.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
};

export const fetchSunwingData = async (mode, targetMonths = []) => {
  const pageUrl = mode === 'lastMinute' ? PAGES.lastMinute : PAGES.luxury;

  console.log(`[fetchSunwingData] Mode: ${mode} | URL: ${pageUrl}`);
  console.log(`[fetchSunwingData] Gateway: ${GATEWAY} (Montreal)`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'en-CA',
    timezoneId: 'America/Montreal',
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  let deals = [];

  try {
    // 1. Navegar para a página correta
    console.log(`[fetchSunwingData] Navegando...`);
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // 2. Clicar em Montréal para filtrar por YUL
    console.log(`[fetchSunwingData] Selecionando Montréal...`);
    const clicked = await clickMontreal(page);
    if (!clicked) {
      console.warn('[fetchSunwingData] Aba Montréal não encontrada — usando dados padrão da página');
    }

    // 3. Aguardar preços carregarem (12 segundos confirmados como suficiente)
    console.log('[fetchSunwingData] Aguardando preços de Montreal carregarem (12s)...');
    await waitForCity(page, 'Montreal', 15000);
    await page.waitForTimeout(3000); // buffer adicional

    // 4. Extrair todos os cards
    console.log('[fetchSunwingData] Extraindo deals...');
    const rawDeals = await extractCardsFromPage(page);
    console.log(`[fetchSunwingData] ${rawDeals.length} deals extraídos (antes de filtrar por mês)`);

    // 5. Filtrar por meses-alvo (só para o modo future)
    if (mode === 'future' && targetMonths.length > 0) {
      deals = rawDeals.filter(deal => {
        if (!deal.date) return false;
        // deal.date pode ser "2026-11-15" ou "Nov 15, 2026"
        return targetMonths.some(month => deal.date.includes(month));
      });
      console.log(`[fetchSunwingData] ${deals.length} deals após filtro de meses: ${targetMonths.join(', ')}`);
    } else {
      deals = rawDeals;
    }

  } catch (error) {
    console.error('[fetchSunwingData] Erro durante scraping:', error.message);
  } finally {
    await browser.close();
  }

  return deals;
};
