/**
 * bot_last_minute.js — Monitor de ofertas last minute
 *
 * Critérios:
 *   - Partindo de Montreal (YUL)
 *   - 5 estrelas
 *   - Destinos: México, República Dominicana, Bahamas
 *   - Dentro do MAX_BUDGET
 */

import 'dotenv/config';
import { fetchSunwingData } from './skills/fetchSunwingData.js';
import { applyQualityFilters } from './skills/applyQualityFilters.js';
import { syncWithNeon } from './skills/syncWithNeon.js';
import { sendTelegramAlert } from './skills/sendTelegramAlert.js';

const main = async () => {
  const startTime = Date.now();
  console.log('--- 🚨 Bot Last Minute iniciado ---');
  console.log(`   Destinos: México, República Dominicana, Bahamas`);
  console.log(`   Critério: 5★, All Inclusive, YUL`);
  console.log(`   Budget: $${process.env.MAX_BUDGET || 'sem limite'}`);

  try {
    // 1. Scrape da página real de last-minute (YUL, pós-clique Montreal)
    const deals = await fetchSunwingData('lastMinute');
    console.log(`\nScraper encontrou ${deals.length} deals brutos`);

    // 2. Filtro estrito: 5★ + destinos específicos + budget
    const filteredDeals = applyQualityFilters(deals, true);
    console.log(`${filteredDeals.length} deals passaram no filtro (5★, destino, budget)`);

    // Log dos deals encontrados
    if (filteredDeals.length > 0) {
      console.log('\nDeals qualificados:');
      filteredDeals.forEach(d => {
        console.log(`  ★ ${d.hotelName} (${d.destination}) — $${d.price} | ${d.stars}★ | ${d.date}`);
      });
    }

    // 3. Sincronizar com DB (detecta NEW e PRICE_DROP)
    const alerts = await syncWithNeon(filteredDeals);

    // 4. Enviar alertas Telegram
    if (alerts.length > 0) {
      await sendTelegramAlert(alerts, '🚨 LAST MINUTE DEAL (5★ YUL):');
      console.log(`\n${alerts.length} alertas enviados pelo Telegram`);
    } else {
      console.log('\nNenhum deal novo ou queda de preço — sem alertas.');
    }

  } catch (error) {
    console.error('❌ Erro no bot_last_minute:', error.message);
    // Notificar falha via Telegram para visibilidade
    try {
      await sendTelegramAlert([{
        type: 'ERROR',
        deal: { hotelName: 'bot_last_minute.js', date: new Date().toISOString(), price: 0, stars: 0, link: '' },
        message: error.message
      }], '⚠️ ERRO NO BOT LAST MINUTE');
    } catch {}
    process.exit(1);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n--- ✅ Bot Last Minute finalizado em ${elapsed}s ---`);
};

main().catch(error => {
  console.error('Erro fatal:', error);
  process.exit(1);
});
