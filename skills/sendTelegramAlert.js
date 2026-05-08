import TelegramBot from 'node-telegram-bot-api';

export const sendTelegramAlert = async (alerts, customPrefix = '') => {
  const token = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error('[sendTelegramAlert] TELEGRAM_TOKEN or TELEGRAM_CHAT_ID is missing.');
    return;
  }

  if (alerts.length === 0) {
    console.log('[sendTelegramAlert] No new alerts to send.');
    return;
  }

  console.log(`[sendTelegramAlert] Sending ${alerts.length} alerts to Telegram...`);

  const bot = new TelegramBot(token, { polling: false });

  for (const alert of alerts) {
    let message = '';

    const prefix = customPrefix ? \`\${customPrefix}\` : (alert.type === 'NEW' ? '🌟 *NEW DEAL ALERT* 🌟' : '📉 *PRICE DROP ALERT* 📉');

    message += \`\${prefix}\\n\\n\`;

    if (alert.type === 'NEW') {
      message += \`🏨 *Hotel:* \${alert.deal.hotelName}\\n\`;
      message += \`💰 *Price:* $\${alert.deal.price}\\n\`;
    } else if (alert.type === 'PRICE_DROP') {
      message += \`🏨 *Hotel:* \${alert.deal.hotelName}\\n\`;
      message += \`💰 *Price:* ~$\${alert.oldPrice}~ ➡️ *$\${alert.deal.price}*\\n\`;
    }

    message += \`📅 *Date:* \${alert.deal.date}\\n\`;
    message += \`⭐ *Stars:* \${alert.deal.stars}\\n\\n\`;
    message += \`🔗 [Book Here](\${alert.deal.link})\`;

    try {
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
      console.error('[sendTelegramAlert] Failed to send message:', error.message);
    }
  }
};
