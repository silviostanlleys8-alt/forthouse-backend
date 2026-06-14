const express = require('express');
const cors = require('cors');
const { createClient } = require('@libsql/client');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
});

async function initDB() {
  await db.execute(`CREATE TABLE IF NOT EXISTS reservas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    cpf TEXT,
    wpp TEXT,
    checkin TEXT NOT NULL,
    checkout TEXT NOT NULL,
    valor REAL DEFAULT 0,
    tipo TEXT DEFAULT 'manual',
    obs TEXT,
    criado_em TEXT DEFAULT (datetime('now'))
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS campanhas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    descricao TEXT,
    preco TEXT,
    tipo_preco TEXT DEFAULT 'por noite',
    periodo TEXT,
    ativa INTEGER DEFAULT 1,
    criado_em TEXT DEFAULT (datetime('now'))
  )`);
  // Migração: adiciona colunas novas se não existirem
  try { await db.execute(`ALTER TABLE campanhas ADD COLUMN tipo_preco TEXT DEFAULT 'por noite'`); } catch(e) {}
  try { await db.execute(`ALTER TABLE campanhas ADD COLUMN periodo TEXT`); } catch(e) {}
  console.log('Banco iniciado com sucesso!');
}

const ADMIN_USER = 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '86951519SJJ';

function authAdmin(req, res, next) {
  const user = req.headers['user'];
  const pass = req.headers['pass'];
  if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
  return res.status(401).json({ error: 'Não autorizado' });
}

app.post('/api/login', (req, res) => {
  const { user, pass } = req.body;
  if (user === ADMIN_USER && pass === ADMIN_PASS) return res.json({ ok: true });
  return res.status(401).json({ error: 'Usuário ou senha incorretos' });
});

app.get('/api/datas-ocupadas', async (req, res) => {
  try {
    const result = await db.execute('SELECT checkin, checkout FROM reservas');
    const datas = [];
    result.rows.forEach(r => {
      let d = new Date(r.checkin + 'T12:00:00');
      const fim = new Date(r.checkout + 'T12:00:00');
      while (d < fim) {
        datas.push(d.toISOString().split('T')[0]);
        d.setDate(d.getDate() + 1);
      }
    });
    res.json({ datas });
  } catch (e) {
    console.error('datas-ocupadas:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/campanhas/ativas', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM campanhas WHERE ativa = 1 ORDER BY id DESC LIMIT 1');
    res.json({ campanha: result.rows[0] || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/reservas', authAdmin, async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM reservas ORDER BY checkin ASC');
    res.json({ reservas: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/reservas', authAdmin, async (req, res) => {
  const { nome, cpf, wpp, checkin, checkout, valor, obs } = req.body;
  if (!nome || !checkin || !checkout) return res.status(400).json({ error: 'Nome, check-in e check-out são obrigatórios' });
  try {
    await db.execute({
      sql: 'INSERT INTO reservas (nome, cpf, wpp, checkin, checkout, valor, tipo, obs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      args: [nome, cpf||'', wpp||'', checkin, checkout, valor||0, 'manual', obs||'']
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/reservas/:id', authAdmin, async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM reservas WHERE id = ?', args: [req.params.id] });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/campanhas', authAdmin, async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM campanhas ORDER BY id DESC');
    res.json({ campanhas: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/campanhas', authAdmin, async (req, res) => {
  const { titulo, descricao, preco, tipo_preco, periodo } = req.body;
  if (!titulo || !preco) return res.status(400).json({ error: 'Título e preço obrigatórios' });
  try {
    await db.execute({
      sql: 'INSERT INTO campanhas (titulo, descricao, preco, tipo_preco, periodo, ativa) VALUES (?, ?, ?, ?, ?, 1)',
      args: [titulo, descricao||'', preco, tipo_preco||'por noite', periodo||'']
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/admin/campanhas/:id', authAdmin, async (req, res) => {
  const { ativa } = req.body;
  try {
    await db.execute({ sql: 'UPDATE campanhas SET ativa = ? WHERE id = ?', args: [ativa ? 1 : 0, req.params.id] });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/campanhas/:id', authAdmin, async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM campanhas WHERE id = ?', args: [req.params.id] });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
initDB()
  .then(() => app.listen(PORT, () => console.log(`Forthouse rodando na porta ${PORT}`)))
  .catch(err => { console.error('Erro ao iniciar banco:', err); process.exit(1); });
