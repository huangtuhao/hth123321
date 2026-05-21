const nodemailer = require('nodemailer');
const axios = require('axios');

async function sendEmail(settings, subject, body) {
  if (settings.email_enabled !== 'true') return;
  if (!settings.email_user || !settings.email_pass || !settings.email_to) return;

  const transporter = nodemailer.createTransport({
    host: settings.email_host || 'smtp.qq.com',
    port: parseInt(settings.email_port || '465'),
    secure: true,
    auth: { user: settings.email_user, pass: settings.email_pass },
  });

  await transporter.sendMail({
    from: settings.email_user,
    to: settings.email_to,
    subject,
    text: body,
  });
  console.log('📧 邮件已发送');
}

async function sendFeishu(settings, text) {
  if (settings.feishu_enabled !== 'true') return;
  if (!settings.feishu_webhook) return;

  await axios.post(settings.feishu_webhook, {
    msg_type: 'text',
    content: { text },
  });
  console.log('🚀 飞书消息已发送');
}

async function notify(settings, alerts) {
  if (!alerts || alerts.length === 0) return;

  const time = new Date().toLocaleString('zh-CN', { timeZone: 'America/New_York' });
  const lines = alerts.map(a => a.message).join('\n\n');
  const content = `🚨 Amazon 监控告警（${time} EST）\n共 ${alerts.length} 条\n\n${lines}`;

  await Promise.allSettled([
    sendEmail(settings, `🚨 Amazon 监控告警 - ${alerts.length} 条异常`, content).catch(e => console.error('邮件发送失败:', e.message)),
    sendFeishu(settings, content).catch(e => console.error('飞书发送失败:', e.message)),
  ]);
}

module.exports = { notify, sendEmail, sendFeishu };