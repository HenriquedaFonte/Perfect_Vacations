/**
 * bot_future_luxury.js — Monitor de preços de pacotes de luxo futuros
 *
 * Lógica:
 *   - Scrapa a página de luxury resorts do Sunwing (YUL)
 *   - Filtra por meses-alvo (Nov/Dez 2026)
 *   - Sempre que encontra preço MENOR que o registrado no DB → alerta
 *   - Guarda o novo preço no DB
 */

import 'dotenv/config';
import { fetchSunwingData } from './skills/fetchSunwingData.js';
import { applyQualityFilters } from './skills/applyQualityFilters.js';
import { syncWithNeon } from './skills/syncWithNeon.js';
import { sendTelegramAlert } from './skills/sendTelegramAlert.js';

const main = async () => {
  const startTime = Date.now();
  console.log('--- 🏖️ Bot Future Luxury iniciado ---');

  // Meses-alvo: Nov e Dez 2026
  const targetMonths = process.env.TARGET_MONTHS
    ? process.env.TARGET_MONTHS.split(',').map(m => m.trim())
    : ['2026-11', '2026-12'];

  console.log(`   Meses-alvo: ${targetMonths.join(', ')}`);
  console.log(`   Gateway: YUL (Montreal)`);
  console.log(`   Budget: $${process.env.MAX_BUDGET || 'sem limite'}`);

  try {
    // 1. Scrape da página de luxury resorts (4+ estrelas, YUL)
    const deals = await fetchSunwingData('future', targetMonths);
    console.log(`\nScraper encontrou ${deals.length} deals para os meses-alvo`);

    if (deals.length === 0) {
      console.log('ℹ️  Nenhum deal encontrado para os meses-alvo.');
      console.log('   (Normal se os meses-alvo ainda estão longe — deals aparecem conforme a data se aproxima)');
      console.log(`--- ✅ Bot Future finalizado ---`);
      return;
    }

    // 2. Filtro relaxado: 4+ estrelas, dentro do budget
    const filteredDeals = applyQualityFilters(deals, false);
    console.log(`${filteredDeals.length} deals após filtro (4★+, budget)`);

    filteredDeals.forEach(d => {
      console.log(`  ★ ${d.hotelName} (${d.destination}) — $${d.price} | ${d.stars}★ | ${d.date}`);
    });

    // 3. Sincronizar com DB
    //    syncWithNeon detecta: NEW deal → alerta
    //                         PRICE_DROP → alerta (isso é o core do future bot!)
    //                         price igual → silêncio (só atualiza last_seen)
    const alerts = await syncWithNeon(filteredDeals);

    // 4. Filtrar só PRICE_DROP para o future bot (o que importa)
    const priceDropAlerts = alerts.filter(a => a.type === 'PRICE_DROP' || a.type === 'NEW');

    if (priceDropAlerts.length > 0) {
      await sendTelegramAlert(priceDropAlerts, '🏖️ FUTURE LUXURY DEAL (YUL):');
      console.log(`\n${priceDropAlerts.length} alertas enviados (${alerts.filter(a=>a.type==='PRICE_DROP').length} quedas de preço, ${alerts.filter(a=>a.type==='NEW').length} novos)`);
    } else {
      console.log('\nPreços estáveis — sem alertas.');
    }

  } catch (error) {
    console.error('❌ Erro no bot_future_luxury:', error.message);
    try {
      await sendTelegramAlert([{
        type: 'ERROR',
        deal: { hotelName: 'bot_future_luxury.js', date: new Date().toISOString(), price: 0, stars: 0, link: '' },
        message: error.message
      }], '⚠️ ERRO NO BOT FUTURE');
    } catch {}
    process.exit(1);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n--- ✅ Bot Future finalizado em ${elapsed}s ---`);
};

main().catch(error => {
  console.error('Erro fatal:', error);
  process.exit(1);
});
