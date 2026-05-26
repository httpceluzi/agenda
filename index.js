const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'http://localhost:3000';

const DATA_FILE = './tasks.json';
const TOKEN_FILE = './google_token.json';
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ── OAuth2 client ─────────────────────────────────────────────────────────────
const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  `${BASE_URL}/auth/callback`
);

function loadGoogleToken() {
  try {
    const token = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    oauth2Client.setCredentials(token);
    return true;
  } catch { return false; }
}

function saveGoogleToken(token) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(token));
  oauth2Client.setCredentials(token);
}

// ── Persistencia de tareas ────────────────────────────────────────────────────
function loadTasks() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}
function saveTasks(tasks) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2));
}

// ── Google Calendar ───────────────────────────────────────────────────────────
async function addToCalendar(task) {
  if (!loadGoogleToken()) return null;
  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const date = task.due || new Date().toISOString().split('T')[0];
    const event = {
      summary: `[${task.proj.toUpperCase()}] ${task.title}`,
      description: `Prioridad: ${task.prio}\nProyecto: ${task.proj}`,
      start: { date },
      end: { date },
      colorId: task.prio === 'Alta' ? '11' : task.prio === 'Media' ? '5' : '2',
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 60 },
          { method: 'email', minutes: 1440 }
        ]
      }
    };
    const res = await calendar.events.insert({ calendarId: 'primary', resource: event });
    return res.data.htmlLink;
  } catch (e) {
    console.error('Calendar error:', e.message);
    return null;
  }
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
  const cal = t.calendarLink ? ` [📆](${t.calendarLink})` : '';
  const status = { pendiente: '⬜', 'en-progreso': '🔄', listo: '✅' }[t.status] || '⬜';
  return `${status} *[${t.id}]* ${t.title}${due}${cal} _(${t.proj}, ${t.prio})_`;
}

// ── Comandos ──────────────────────────────────────────────────────────────────
async function handleCommand(msg) {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const tasks = loadTasks();

  if (text.startsWith('/nueva ')) {
    const raw = text.replace('/nueva ', '').trim();

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

    let prio = 'Media';
    if (/alta|urgente/i.test(raw)) prio = 'Alta';
    else if (/baja/i.test(raw)) prio = 'Baja';

    let proj = 'ia';
    if (/youtube|yt|canal/i.test(raw)) proj = 'yt';
    else if (/celuzi|panadería|pan|fermenta/i.test(raw)) proj = 'cel';
    else if (/ebook|infoproducto|gumroad|hotmart|guía/i.test(raw)) proj = 'inf';

    const title = raw
      .replace(/\bmañana\b|\bhoy\b|\d{4}-\d{2}-\d{2}/gi, '')
      .replace(/prioridad\s+(alta|media|baja|urgente)/gi, '')
      .trim();

    const newTask = { id: Date.now(), title, proj, prio, due, status: 'pendiente' };

    // Agregar a Google Calendar si hay fecha
    if (due) {
      const link = await addToCalendar(newTask);
      if (link) newTask.calendarLink = link;
    }

    tasks.push(newTask);
    saveTasks(tasks);

    const calMsg = newTask.calendarLink ? `\n📆 [Ver en Google Calendar](${newTask.calendarLink})` : '';
    await sendMsg(`✅ *Tarea creada*\n\n${formatTask(newTask)}${calMsg}`, chatId);
    return;
  }

  if (text === '/hoy') {
    const dueHoy = tasks.filter(t => t.due === today() && t.status !== 'listo');
    if (dueHoy.length === 0) {
      await sendMsg('🎉 No hay tareas que venzan hoy.', chatId);
    } else {
      await sendMsg(`📅 *Tareas de hoy (${today()})*\n\n${dueHoy.map(formatTask).join('\n')}`, chatId);
    }
    return;
  }

  if (text === '/semana') {
    const d = new Date();
    const week = Array.from({length: 7}, (_, i) => {
      const dd = new Date(d); dd.setDate(d.getDate() + i);
      return dd.toISOString().split('T')[0];
    });
    const upcoming = tasks.filter(t => t.due && week.includes(t.due) && t.status !== 'listo');
    if (upcoming.length === 0) {
      await sendMsg('📅 No hay tareas para los próximos 7 días.', chatId);
    } else {
      await sendMsg(`📅 *Próximos 7 días*\n\n${upcoming.map(formatTask).join('\n')}`, chatId);
    }
    return;
  }

  if (text === '/lista') {
    const activas = tasks.filter(t => t.status !== 'listo');
    if (activas.length === 0) {
      await sendMsg('🎉 No tenés tareas pendientes.', chatId);
    } else {
      await sendMsg(`📋 *Tareas activas (${activas.length})*\n\n${activas.map(formatTask).join('\n')}`, chatId);
    }
    return;
  }

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

  if (text === '/resumen') {
    const total = tasks.length;
    const pending = tasks.filter(t => t.status === 'pendiente').length;
    const inprog = tasks.filter(t => t.status === 'en-progreso').length;
    const done = tasks.filter(t => t.status === 'listo').length;
    const dueHoy = tasks.filter(t => t.due === today() && t.status !== 'listo').length;
    const calConnected = loadGoogleToken() ? '✅ Conectado' : '❌ No conectado';
    await sendMsg(
      `📊 *Resumen de proyectos*\n\n` +
      `⬜ Pendientes: ${pending}\n` +
      `🔄 En progreso: ${inprog}\n` +
      `✅ Completadas: ${done}\n` +
      `📅 Vencen hoy: ${dueHoy}\n` +
      `📁 Total: ${total}\n\n` +
      `📆 Google Calendar: ${calConnected}`,
      chatId
    );
    return;
  }

  if (text === '/conectarcalendar') {
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth` +
  `?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(`${BASE_URL}/auth/callback`)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent('https://www.googleapis.com/auth/calendar.events')}` +
  `&access_type=offline` +
  `&prompt=consent`;
      `📆 *Conectar Google Calendar*\n\nAbrí este link para autorizar:\n${authUrl}\n\n_Una vez autorizado las tareas con fecha se agregarán automáticamente a tu calendario._`,
      chatId
    );
    return;
  }

  if (text === '/start' || text === '/ayuda' || text === '/help') {
    const calStatus = loadGoogleToken() ? '✅' : '❌ (usá /conectarcalendar)';
    await sendMsg(
      `👋 *Hola Bárbara\\!* Soy tu gestor de proyectos\\.\n\n` +
      `📆 Google Calendar: ${calStatus}\n\n` +
      `*Comandos:*\n\n` +
      `/nueva _título_ — Crear tarea\n` +
      `_Ej: /nueva Editar video YT mañana prioridad alta_\n\n` +
      `/hoy — Tareas que vencen hoy\n` +
      `/semana — Próximos 7 días\n` +
      `/lista — Todas las activas\n` +
      `/listo _id_ — Marcar completada\n` +
      `/resumen — Estadísticas\n` +
      `/conectarcalendar — Conectar Google Calendar\n` +
      `/ayuda — Este menú`,
      chatId
    );
    return;
  }

  await sendMsg('No entendí ese comando. Escribí /ayuda para ver los disponibles.', chatId);
}

// ── Auth callback de Google ───────────────────────────────────────────────────
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    saveGoogleToken(tokens);
    await sendMsg('✅ *Google Calendar conectado correctamente\\!*\n\nAhora las tareas con fecha se agregarán automáticamente a tu calendario\\.');
    res.send('<h2 style="font-family:sans-serif;text-align:center;margin-top:100px">✅ Google Calendar conectado. Podés cerrar esta pestaña.</h2>');
  } catch (e) {
    res.send('<h2 style="font-family:sans-serif;text-align:center;margin-top:100px">❌ Error al conectar. Intentá de nuevo con /conectarcalendar</h2>');
  }
});

// ── Webhook / Polling ─────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const { message } = req.body;
  if (message?.text) await handleCommand(message);
});

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
cron.schedule('0 12 * * *', async () => {
  const tasks = loadTasks();
  const dueHoy = tasks.filter(t => t.due === today() && t.status !== 'listo');
  const activas = tasks.filter(t => t.status !== 'listo');
  let msg = `☀️ *Buenos días\\! Resumen de hoy*\n\n📁 Activas: ${activas.length}\n`;
  if (dueHoy.length > 0) {
    msg += `⚠️ Vencen HOY: ${dueHoy.length}\n\n${dueHoy.map(formatTask).join('\n')}`;
  } else {
    msg += `✅ Nada vence hoy`;
  }
  await sendMsg(msg);
});

cron.schedule('0 11 * * 1', async () => {
  const tasks = loadTasks();
  const d = new Date();
  const week = Array.from({length: 7}, (_, i) => {
    const dd = new Date(d); dd.setDate(d.getDate() + i);
    return dd.toISOString().split('T')[0];
  });
  const upcoming = tasks.filter(t => t.due && week.includes(t.due) && t.status !== 'listo');
  const msg = upcoming.length > 0
    ? `📅 *Plan de la semana*\n\n${upcoming.map(formatTask).join('\n')}`
    : `📅 *Plan de la semana*\n\n✅ No hay tareas programadas`;
  await sendMsg(msg);
});

// ── API para app web ──────────────────────────────────────────────────────────
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

// ── Inicio ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
  loadGoogleToken();
  await axios.post(`${TG}/deleteWebhook`).catch(() => {});
  console.log('Modo polling activo');
  setInterval(poll, 2000);
  await sendMsg('🚀 *Bot actualizado con Google Calendar\\!*\n\nEscribí /conectarcalendar para vincular tu calendario\\.');
});
