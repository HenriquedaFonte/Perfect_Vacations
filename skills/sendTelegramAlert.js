import TelegramBot from 'node-telegram-bot-api';

export const sendTelegramAlert = async (alerts, customPrefix = '') => {
  const token = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error('[sendTelegramAlert] TELEGRAM_TOKEN ou TELEGRAM_CHAT_ID ausente.');
    return;
  }

  if (alerts.length === 0) {
    console.log('[sendTelegramAlert] Nenhum alerta para enviar.');
    return;
  }

  console.log(`[sendTelegramAlert] Enviando ${alerts.length} alertas...`);

  const bot = new TelegramBot(token, { polling: false });

  for (const alert of alerts) {
    let message = '';

    // Prefixo customizado ou padrão por tipo
    const prefix = customPrefix || (
      alert.type === 'NEW'        ? '🌟 *NOVO DEAL* 🌟' :
      alert.type === 'PRICE_DROP' ? '📉 *QUEDA DE PREÇO* 📉' :
      alert.type === 'ERROR'      ? '⚠️ *ERRO NO BOT* ⚠️' :
      '📢 *ALERTA*'
    );

    message += `${prefix}\n\n`;

    if (alert.type === 'ERROR') {
      message += `🤖 *Bot:* ${alert.deal.hotelName}\n`;
      message += `❌ *Erro:* ${alert.message || 'Erro desconhecido'}\n`;
      message += `📅 *Quando:* ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Toronto' })}`;
    } else {
      // NEW ou PRICE_DROP
      message += `🏨 *Hotel:* ${alert.deal.hotelName}\n`;
      message += `📍 *Destino:* ${alert.deal.destination || alert.deal.date}\n`;
      message += `⭐ *Estrelas:* ${alert.deal.stars || '?'}\n`;

      if (alert.type === 'NEW') {
        message += `💰 *Preço:* $${alert.deal.price}\n`;
      } else if (alert.type === 'PRICE_DROP') {
        message += `💰 *Preço:* ~$${alert.oldPrice}~ ➡️ *$${alert.deal.price}*\n`;
        const saving = alert.oldPrice - alert.deal.price;
        const pct = ((saving / alert.oldPrice) * 100).toFixed(0);
        message += `💸 *Economia:* $${saving.toFixed(0)} (${pct}% off)\n`;
      }

      message += `📅 *Data:* ${alert.deal.date}\n`;

      if (alert.deal.isAllInclusive) {
        message += `✅ All Inclusive\n`;
      }

      if (alert.deal.link) {
        message += `\n🔗 [Reservar agora](${alert.deal.link})`;
      }
    }

    try {
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      await new Promise(resolve => setTimeout(resolve, 400)); // evitar rate limit
    } catch (error) {
      console.error('[sendTelegramAlert] Falha ao enviar:', error.message);
    }
  }
};
