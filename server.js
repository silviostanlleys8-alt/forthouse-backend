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
    nome TEXT NOT NULL, cpf TEXT, wpp TEXT,
    checkin TEXT NOT NULL, checkout TEXT NOT NULL,
    valor REAL DEFAULT 0, tipo TEXT DEFAULT 'manual', obs TEXT,
    criado_em TEXT DEFAULT (datetime('now'))
  )`);

  await db.execute(`CREATE TABLE IF NOT EXISTS promocoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    descricao TEXT,
    preco TEXT,
    tipo_preco TEXT DEFAULT 'por noite',
    periodo TEXT,
    status TEXT DEFAULT 'ativa',
    criado_em TEXT DEFAULT (datetime('now'))
  )`);

  // migração segura: adicionar coluna status se não existir (tabela campanhas antiga)
  try { await db.execute(`ALTER TABLE promocoes ADD COLUMN status TEXT DEFAULT 'ativa'`); } catch(e){}

  console.log('Banco iniciado com sucesso!');
}

const ADMIN_USER = 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '86951519SJJ';

function authAdmin(req, res, next) {
  if (req.headers['user'] === ADMIN_USER && req.headers['pass'] === ADMIN_PASS) return next();
  return res.status(401).json({ error: 'Não autorizado' });
}

// ── Rotas públicas ────────────────────────────────────────────────────────────
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
      while (d < fim) { datas.push(d.toISOString().split('T')[0]); d.setDate(d.getDate() + 1); }
    });
    res.json({ datas });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Promoção ativa para o banner
app.get('/api/promocoes/ativa', async (req, res) => {
  try {
    const result = await db.execute(`SELECT * FROM promocoes WHERE status = 'ativa' ORDER BY id DESC LIMIT 1`);
    res.json({ promocao: result.rows[0] || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Todas as promoções para o quadro de avisos (públicas)
app.get('/api/promocoes', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM promocoes ORDER BY id DESC');
    res.json({ promocoes: result.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Rotas admin ───────────────────────────────────────────────────────────────
app.get('/api/admin/reservas', authAdmin, async (req, res) => {
  try { res.json({ reservas: (await db.execute('SELECT * FROM reservas ORDER BY checkin ASC')).rows }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/reservas', authAdmin, async (req, res) => {
  const { nome, cpf, wpp, checkin, checkout, valor, obs } = req.body;
  if (!nome || !checkin || !checkout) return res.status(400).json({ error: 'Nome, check-in e check-out são obrigatórios' });
  try {
    await db.execute({ sql: 'INSERT INTO reservas (nome,cpf,wpp,checkin,checkout,valor,tipo,obs) VALUES (?,?,?,?,?,?,?,?)', args: [nome, cpf||'', wpp||'', checkin, checkout, valor||0, 'manual', obs||''] });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/reservas/:id', authAdmin, async (req, res) => {
  try { await db.execute({ sql: 'DELETE FROM reservas WHERE id = ?', args: [req.params.id] }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// CRUD promoções admin
app.get('/api/admin/promocoes', authAdmin, async (req, res) => {
  try { res.json({ promocoes: (await db.execute('SELECT * FROM promocoes ORDER BY id DESC')).rows }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/promocoes', authAdmin, async (req, res) => {
  const { titulo, descricao, preco, tipo_preco, periodo } = req.body;
  if (!titulo || !preco) return res.status(400).json({ error: 'Título e preço obrigatórios' });
  try {
    await db.execute({ sql: 'INSERT INTO promocoes (titulo,descricao,preco,tipo_preco,periodo,status) VALUES (?,?,?,?,?,?)', args: [titulo, descricao||'', preco, tipo_preco||'por noite', periodo||'', 'ativa'] });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/promocoes/:id', authAdmin, async (req, res) => {
  const { status } = req.body;
  try { await db.execute({ sql: 'UPDATE promocoes SET status = ? WHERE id = ?', args: [status, req.params.id] }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/promocoes/:id', authAdmin, async (req, res) => {
  try { await db.execute({ sql: 'DELETE FROM promocoes WHERE id = ?', args: [req.params.id] }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

const PORT = process.env.PORT || 3000;
initDB()
  .then(() => app.listen(PORT, () => console.log(`Forthouse rodando na porta ${PORT}`)))
  .catch(err => { console.error('Erro:', err); process.exit(1); });
