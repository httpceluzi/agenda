const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN || '8957766160:AAFHrOTbpYp9mzGeq1jZoZ7gcgK24qaOftI';
const CHAT_ID = process.env.CHAT_ID || '6603562807';
const DATA_FILE = './tasks.json';
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ── Persistencia ──────────────────────────────────────────────────────────────
function loadTasks() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}
function saveTasks(tasks) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2));
}

// ── Telegram helpers ──────────────────────────────────────────────────────────
async function sendMsg(text, chatId = CHAT_ID) {
  try {
    await axios.post(`${TG}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown'
    });
  } catch (e) {
    console.error('Telegram error:', e.response?.data || e.message);
  }
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function formatTask(t) {
  const due = t.due ? ` — 📅 ${t.due}` : '';
  const status = { pendiente: '⬜', 'en-progreso': '🔄', listo: '✅' }[t.status] || '⬜';
  return `${status} *[${t.id}]* ${t.title}${due} _(${t.proj}, ${t.prio})_`;
}

// ── Comandos ──────────────────────────────────────────────────────────────────
async function handleCommand(msg) {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const tasks = loadTasks();

  // /nueva Editar video YT mañana prioridad alta
  if (text.startsWith('/nueva ')) {
    const raw = text.replace('/nueva ', '').trim();

    // Detectar fecha
    let due = '';
    const manana = raw.match(/\bmañana\b/i);
    const hoyMatch = raw.match(/\bhoy\b/i);
    const fechaMatch = raw.match(/(\d{4}-\d{2}-\d{2})/);
    if (manana) {
      const d = new Date(); d.setDate(d.getDate() + 1);
      due = d.toISOString().split('T')[0];
    } else if (hoyMatch) {
      due = today();
    } else if (fechaMatch) {
      due = fechaMatch[1];
    }

    // Detectar prioridad
    let prio = 'Media';
    if (/alta|urgente/i.test(raw)) prio = 'Alta';
    else if (/baja/i.test(raw)) prio = 'Baja';

    // Detectar proyecto
    let proj = 'ia';
    if (/youtube|yt|canal/i.test(raw)) proj = 'yt';
    else if (/celuzi|panadería|pan|fermenta/i.test(raw)) proj = 'cel';
    else if (/ebook|infoproducto|gumroad|hotmart|guía/i.test(raw)) proj = 'inf';

    // Limpiar título
    const title = raw
      .replace(/\bmañana\b|\bhoy\b|\d{4}-\d{2}-\d{2}/gi, '')
      .replace(/prioridad\s+(alta|media|baja|urgente)/gi, '')
      .trim();

    const newTask = {
      id: Date.now(),
      title,
      proj,
      prio,
      due,
      status: 'pendiente'
    };
    tasks.push(newTask);
    saveTasks(tasks);

    await sendMsg(`✅ *Tarea creada*\n\n${formatTask(newTask)}\n\n_Usá /lista para ver todas_`, chatId);
    return;
  }

  // /hoy
  if (text === '/hoy') {
    const dueHoy = tasks.filter(t => t.due === today() && t.status !== 'listo');
    if (dueHoy.length === 0) {
      await sendMsg('🎉 No hay tareas que venzan hoy.', chatId);
    } else {
      const lines = dueHoy.map(formatTask).join('\n');
      await sendMsg(`📅 *Tareas de hoy (${today()})*\n\n${lines}`, chatId);
    }
    return;
  }

  // /semana
  if (text === '/semana') {
    const d = new Date();
    const week = [];
    for (let i = 0; i < 7; i++) {
      const dd = new Date(d); dd.setDate(d.getDate() + i);
      week.push(dd.toISOString().split('T')[0]);
    }
    const upcoming = tasks.filter(t => t.due && week.includes(t.due) && t.status !== 'listo');
    if (upcoming.length === 0) {
      await sendMsg('📅 No hay tareas para los próximos 7 días.', chatId);
    } else {
      const lines = upcoming.map(formatTask).join('\n');
      await sendMsg(`📅 *Próximos 7 días*\n\n${lines}`, chatId);
    }
    return;
  }

  // /lista
  if (text === '/lista') {
    const activas = tasks.filter(t => t.status !== 'listo');
    if (activas.length === 0) {
      await sendMsg('🎉 No tenés tareas pendientes.', chatId);
    } else {
      const lines = activas.map(formatTask).join('\n');
      await sendMsg(`📋 *Tareas activas (${activas.length})*\n\n${lines}`, chatId);
    }
    return;
  }

  // /listo [id]
  if (text.startsWith('/listo')) {
    const id = parseInt(text.split(' ')[1]);
    const task = tasks.find(t => t.id === id);
    if (!task) {
      await sendMsg('❌ No encontré esa tarea. Usá /lista para ver los IDs.', chatId);
    } else {
      task.status = 'listo';
      saveTasks(tasks);
      await sendMsg(`✅ *Completada:* ${task.title}`, chatId);
    }
    return;
  }

  // /resumen
  if (text === '/resumen') {
    const total = tasks.length;
    const pending = tasks.filter(t => t.status === 'pendiente').length;
    const inprog = tasks.filter(t => t.status === 'en-progreso').length;
    const done = tasks.filter(t => t.status === 'listo').length;
    const dueHoy = tasks.filter(t => t.due === today() && t.status !== 'listo').length;
    await sendMsg(
      `📊 *Resumen de proyectos*\n\n` +
      `⬜ Pendientes: ${pending}\n` +
      `🔄 En progreso: ${inprog}\n` +
      `✅ Completadas: ${done}\n` +
      `📅 Vencen hoy: ${dueHoy}\n` +
      `📁 Total: ${total}`,
      chatId
    );
    return;
  }

  // /start o /ayuda
  if (text === '/start' || text === '/ayuda' || text === '/help') {
    await sendMsg(
      `👋 *Hola Bárbara\\!* Soy tu gestor de proyectos\\.\n\n` +
      `*Comandos disponibles:*\n\n` +
      `/nueva _título_ — Crear tarea\n` +
      `_Ej: /nueva Editar video YT mañana prioridad alta_\n\n` +
      `/hoy — Tareas que vencen hoy\n` +
      `/semana — Tareas de los próximos 7 días\n` +
      `/lista — Todas las tareas activas\n` +
      `/listo _id_ — Marcar tarea como completada\n` +
      `/resumen — Estadísticas generales\n` +
      `/ayuda — Ver este menú`,
      chatId
    );
    return;
  }

  await sendMsg('No entendí ese comando. Escribí /ayuda para ver los disponibles.', chatId);
}

// ── Webhook / Polling ─────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const { message } = req.body;
  if (message?.text) await handleCommand(message);
});

// Polling como fallback (si no se configura webhook)
let lastUpdateId = 0;
async function poll() {
  try {
    const { data } = await axios.get(`${TG}/getUpdates?offset=${lastUpdateId + 1}&timeout=10`);
    for (const update of data.result || []) {
      lastUpdateId = update.update_id;
      if (update.message?.text) await handleCommand(update.message);
    }
  } catch {}
}

// ── Notificaciones automáticas ────────────────────────────────────────────────

// Recordatorio diario 9:00 AM hora Argentina (UTC-3 = 12:00 UTC)
cron.schedule('0 12 * * *', async () => {
  const tasks = loadTasks();
  const dueHoy = tasks.filter(t => t.due === today() && t.status !== 'listo');
  const activas = tasks.filter(t => t.status !== 'listo');

  let msg = `☀️ *Buenos días\\! Resumen de hoy*\n\n`;
  msg += `📁 Tareas activas: ${activas.length}\n`;
  if (dueHoy.length > 0) {
    msg += `⚠️ Vencen HOY: ${dueHoy.length}\n\n`;
    msg += dueHoy.map(formatTask).join('\n');
  } else {
    msg += `✅ Nada vence hoy`;
  }
  await sendMsg(msg);
});

// Alerta 1 hora antes de vencimiento (cada hora en punto)
cron.schedule('0 * * * *', async () => {
  const tasks = loadTasks();
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
  const targetDate = inOneHour.toISOString().split('T')[0];

  if (targetDate === today()) {
    const alertas = tasks.filter(t => t.due === today() && t.status !== 'listo');
    if (alertas.length > 0) {
      const lines = alertas.map(formatTask).join('\n');
      await sendMsg(`⏰ *Recordatorio — tareas de hoy*\n\n${lines}`);
    }
  }
});

// Resumen semanal lunes 8:00 AM (UTC-3 = 11:00 UTC)
cron.schedule('0 11 * * 1', async () => {
  const tasks = loadTasks();
  const d = new Date();
  const week = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(d); dd.setDate(d.getDate() + i);
    week.push(dd.toISOString().split('T')[0]);
  }
  const upcoming = tasks.filter(t => t.due && week.includes(t.due) && t.status !== 'listo');
  const msg = upcoming.length > 0
    ? `📅 *Plan de la semana*\n\n${upcoming.map(formatTask).join('\n')}`
    : `📅 *Plan de la semana*\n\n✅ No hay tareas programadas para esta semana`;
  await sendMsg(msg);
});

// ── API para la app web ───────────────────────────────────────────────────────
app.get('/tasks', (req, res) => res.json(loadTasks()));

app.post('/tasks', (req, res) => {
  const tasks = loadTasks();
  const task = { id: Date.now(), ...req.body };
  tasks.push(task);
  saveTasks(tasks);
  res.json(task);
});

app.patch('/tasks/:id', (req, res) => {
  const tasks = loadTasks();
  const idx = tasks.findIndex(t => t.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  tasks[idx] = { ...tasks[idx], ...req.body };
  saveTasks(tasks);
  res.json(tasks[idx]);
});

app.delete('/tasks/:id', (req, res) => {
  let tasks = loadTasks();
  tasks = tasks.filter(t => t.id !== parseInt(req.params.id));
  saveTasks(tasks);
  res.json({ ok: true });
});

// ── Inicio ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);

  // Intentar configurar webhook si hay URL pública
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    const webhookUrl = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/webhook`;
    await axios.post(`${TG}/setWebhook`, { url: webhookUrl });
    console.log('Webhook configurado:', webhookUrl);
  } else {
    // Modo polling
    console.log('Modo polling activo');
    setInterval(poll, 2000);
  }

  // Mensaje de inicio
  await sendMsg('🚀 *Bot iniciado correctamente\\!*\n\nEscribí /ayuda para ver los comandos disponibles\\.');
});
