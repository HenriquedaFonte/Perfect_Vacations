/**
 * bot_future_luxury.js — Monitor de preços de pacotes futuros Nov/Dez 2026
 *
 * Estratégia de scraping:
 *   1. UMA única sessão de browser para todas as datas (preserva cookies DataDome)
 *   2. Navega organicamente via BSB widget (www.sunwing.ca → formulário)
 *   3. Intercepta POST para handler.cgi e injeta a data-alvo (Nov/Dez 2026)
 *   4. DataDome não bloqueia (comportamento orgânico + sessão persistente)
 *   5. Extrai todos os hotéis com preços do resultspackage-plus.cgi
 *   6. Compara com DB e alerta em quedas de preço
 *
 * Mudança principal: scrapeAllDatesInSession() roda uma única sessão de browser
 * para todas as 9 datas com 45s entre cada busca. Isso preserva os cookies
 * DataDome e o fingerprint comportamental, evitando bloqueios.
 */

import 'dotenv/config';
import { scrapeAllDatesInSession, getFutureTargetDates } from './skills/fetchFuturePackages.js';
import { syncWithNeon } from './skills/syncWithNeon.js';
import { sendTelegramAlert } from './skills/sendTelegramAlert.js';

/**
 * Convert scrapeAllDatesInSession hotel object → syncWithNeon deal format.
 */
function hotelToDeal(hotel) {
  // Build a consistent Sunwing link from hotel name (for DB reference)
  const nameSlug = hotel.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const link = `https://www.sunwing.ca/en/hotel/${nameSlug}`;

  // Rating: use 4 as default (would need HTML parsing for exact stars)
  const stars = hotel.stars || 4;

  // Country for filtering
  const country = hotel.country || hotel.location?.split(',').pop()?.trim() || 'Unknown';

  return {
    hotelName: hotel.name,
    date: hotel.departureDate,           // YYYY-MM-DD
    price: hotel.pricePerAdult,          // price per person
    total: hotel.total,                  // 2-adult total
    link,
    stars,
    description: `${hotel.duration} days | All Inclusive | ${hotel.location}`,
    destination: hotel.location,
    country,
    departureDate: hotel.departureDate,
    duration: hotel.duration,
  };
}

const main = async () => {
  const startTime = Date.now();
  console.log('--- 🏖️ Bot Future Luxury (Nov/Dez 2026) iniciado ---');
  console.log(`   Gateway: YUL (Montreal) | Duração: 7 dias`);
  console.log(`   Budget: $${process.env.MAX_BUDGET || 'sem limite'}`);

  // Target dates: key weeks in November and December 2026
  const targetDates = getFutureTargetDates();
  console.log(`   Datas-alvo (${targetDates.length}): ${targetDates.join(', ')}`);
  console.log(`   Estratégia: sessão única de browser (DataDome bypass)`);

  const maxBudget = process.env.MAX_BUDGET ? parseFloat(process.env.MAX_BUDGET) : Infinity;

  let totalHotels = 0;
  let totalAlerts = 0;
  const failedDates = [];

  try {
    // ─────────────────────────────────────────────────────────────
    // SINGLE browser session for ALL dates — preserves DataDome
    // session cookies and behavioural fingerprint across searches.
    // scrapeAllDatesInSession() handles 45s inter-date delays.
    // ─────────────────────────────────────────────────────────────
    console.log(`\n🚀 Iniciando sessão única de browser para ${targetDates.length} datas...`);
    const allResults = await scrapeAllDatesInSession(targetDates);
    console.log(`\n✅ Scraping concluído. Processando resultados...\n`);

    // Process results per date (scraping already done — now DB sync + alerts)
    for (const [date, { hotels, packageCount }] of allResults) {
      const prettyDate = `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}`;
      console.log(`\n==== ${prettyDate} ====`);

      if (!hotels || hotels.length === 0) {
        console.log(`  ⚠️  Nenhum hotel encontrado. Pulando.`);
        failedDates.push(date);
        continue;
      }

      console.log(`  Encontrou ${hotels.length} hotéis (${packageCount} pacotes totais)`);
      totalHotels += hotels.length;

      // Convert to deal format
      const deals = hotels.map(hotelToDeal);

      // Filter by budget (stars filter removed — future bot tracks everything)
      const filteredDeals = deals.filter(d => {
        if (d.price > maxBudget) {
          console.log(`  [SKIP] ${d.hotelName} — $${d.price} > budget $${maxBudget}`);
          return false;
        }
        return true;
      });

      console.log(`  ${filteredDeals.length} hotéis dentro do budget`);

      if (filteredDeals.length === 0) continue;

      // Sync with DB and detect price drops
      const alerts = await syncWithNeon(filteredDeals);
      const priceDrop = alerts.filter(a => a.type === 'PRICE_DROP');
      const newDeals  = alerts.filter(a => a.type === 'NEW');

      console.log(`  DB sync: ${newDeals.length} novos, ${priceDrop.length} quedas de preço`);

      // Send Telegram alerts for new deals and price drops
      const importantAlerts = alerts.filter(a => a.type === 'PRICE_DROP' || a.type === 'NEW');
      if (importantAlerts.length > 0) {
        const prefix = `🏖️ FUTURE (${prettyDate} | 7 dias | YUL):`;
        await sendTelegramAlert(importantAlerts, prefix);
        totalAlerts += importantAlerts.length;
      }
    }

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n=== RESUMO ===`);
    console.log(`Datas pesquisadas: ${targetDates.length} | Falhas: ${failedDates.length}`);
    console.log(`Total hotéis encontrados: ${totalHotels}`);
    console.log(`Total alertas enviados: ${totalAlerts}`);
    if (failedDates.length > 0) {
      console.log(`Datas com falha: ${failedDates.join(', ')}`);
    }
    console.log(`--- ✅ Bot Future finalizado em ${elapsed}s ---`);

  } catch (error) {
    console.error('❌ Erro no bot_future_luxury:', error.message, error.stack?.substring(0, 300));
    try {
      await sendTelegramAlert([{
        type: 'ERROR',
        deal: {
          hotelName: 'bot_future_luxury.js',
          date: new Date().toISOString(),
          price: 0,
          stars: 0,
          link: '',
        },
        message: error.message,
      }], '⚠️ ERRO NO BOT FUTURE');
    } catch {}
    process.exit(1);
  }
};

main().catch(error => {
  console.error('Erro fatal:', error);
  process.exit(1);
});
