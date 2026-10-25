const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const MAX_MESSAGE_CHARS = 6000;
const MAX_HISTORY_ITEMS = 24;
const MAX_CONTEXT_CHARS = 18000;
const MAX_HISTORY_CHARS = 16000;
const SHORT_REPLY_TOKENS = 750;
const DETAILED_REPLY_TOKENS = 1800;
const OFFICIAL_HOSTS = ['dndbeyond.com', 'dungeonsanddragons.com', 'wizards.com'];
const SUPPLEMENTAL_HOSTS = ['dnd.su', '5e14.dnd.su', 'next.dnd.su'];

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
function allowedOrigin(origin) {
  const configured = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
  return configured.includes('*') || !origin || configured.includes(origin);
}
function cors(req, res) {
  const origin = req.headers?.origin || '';
  if (allowedOrigin(origin)) res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
}
function cleanText(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function getHost(url) { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } }
function hostMatches(host, domain) { return host === domain || host.endsWith('.' + domain); }
function makeInstructions({ edition, sourceMode, character, customInstructions, searchContext }) {
  const editionText = edition === '2014' ? 'D&D 5e редакции 2014 года' : edition === '2024' ? 'D&D 5e редакции 2024 года' : 'сравни обе редакции D&D 5e: 2014 и 2024; отмечай различия отдельно';
  const sourcesText = sourceMode === 'official'
    ? 'Для подтверждения правил используй только официальные источники Wizards of the Coast / D&D Beyond. Не называй неофициальные сайты официальными.'
    : 'Приоритет официальным источникам Wizards of the Coast / D&D Beyond. Дополнительные источники, если используешь, обозначай как неофициальные.';
  return [
    'Ты — QuestSheet AI: живой по стилю, дружелюбный и опытный собеседник, который хорошо разбирается в Dungeons & Dragons 5e. Общайся по-русски, как человек в обычном чате, а не как энциклопедия, справочник или автор статьи.',
    'ГЛАВНОЕ ПРАВИЛО СТИЛЯ: отвечай коротко, прямо и только по делу. Обычно достаточно 1–3 предложений. Не начинай с длинных вступлений, не пересказывай вопрос, не добавляй заголовки, списки и выводы без необходимости. Не объясняй очевидное и не повторяй уже сказанное. Допускаются естественные короткие разговорные формулировки, но не переигрывай и не изображай человека чрезмерно.',
    'Подробный ответ, пошаговый разбор, таблицу или примеры давай, только если пользователь прямо попросил подробно, попросил объяснить, разобрать, сравнить или привести примеры либо без деталей нельзя ответить правильно. Не урезай важные оговорки ради краткости.',
    'ДЕРЖИ КОНТЕКСТ: учитывай всю переданную историю переписки. Короткие реплики вроде «а почему?», «а если так?» и «что насчёт второго?» понимай в контексте предыдущих сообщений. Не проси повторить уже сообщённое. Если контекста действительно недостаточно, задай один короткий уточняющий вопрос.',
    'ЗНАЙ ПЕРСОНАЖА: используй переданные данные листа персонажа как постоянный контекст этой беседы. Привязывай советы к его классу, характеристикам, умениям, заклинаниям, снаряжению и текущей ситуации, если эти данные доступны. Не выдумывай отсутствующие характеристики, предметы, решения игрока или события. Если важное значение не передано, честно скажи об этом или уточни. Никогда не изменяй лист персонажа и не заявляй, что изменил его.',
    `Редакция правил: ${editionText}.`, sourcesText,
    'Точность важнее уверенного тона. Различай редакции 2014 и 2024 годов. Если правило зависит от редакции, коротко укажи это. Не выдумывай правила, ссылки, цитаты или результаты поиска. Если не уверен, скажи об этом просто и без длинных оговорок. Пересказывай правила своими словами, не воспроизводи большие фрагменты защищённых книг.',
    searchContext ? `РЕЗУЛЬТАТЫ ПОИСКА ДЛЯ ЭТОГО ВОПРОСА:\n${searchContext}\nИспользуй их только если они действительно относятся к вопросу. Ссылки можно указывать только на приведённые URL.` : 'Веб-поиск для этого сообщения не выполнялся или не дал результатов. Не утверждай, что что-то проверил в интернете.',
    character ? `ЛИСТ / КОНТЕКСТ ПЕРСОНАЖА:\n${character}` : 'Данные персонажа в этом запросе не переданы. Не делай вид, что знаешь его характеристики.',
    customInstructions ? `ДОПОЛНИТЕЛЬНЫЕ НАСТРОЙКИ ПРИЛОЖЕНИЯ:\n${customInstructions}\nУчитывай их, но по умолчанию сохраняй краткий, естественный стиль и не нарушай точность правил.` : ''
  ].filter(Boolean).join('\n\n');
}
function contextToText(value) {
  if (typeof value === 'string') return cleanText(value, MAX_CONTEXT_CHARS);
  if (value && typeof value === 'object') {
    try { return cleanText(JSON.stringify(value), MAX_CONTEXT_CHARS); } catch { return ''; }
  }
  return '';
}
function wantsDetailedAnswer(message) {
  return /(подробно|развернуто|развёрнуто|по шагам|пошагово|детально|с примерами|приведи примеры|разбери|разбор|сравни подробно|таблиц[ауы])/i.test(message);
}
function shouldSearchWeb(message, body) {
  if (!process.env.SERPER_API_KEY) return false;
  // Short social replies and obvious follow-ups should stay conversational and fast.
  const text = message.trim();
  if (text.length < 24 || /^(а почему|почему\?|и что|понял|ясно|окей|ок|спасибо|да|нет|а если|а так|а второй|продолжай)\b/i.test(text)) return false;
  // Search for explicit sourcing requests and concrete rules/mechanics questions, not every chat turn.
  const asksForSources = /(источник|ссылк[аиу]|официальн|по книге|цитат|проверь|найди|актуальн|последн(ие|яя|ий)|errata|sage advice)/i.test(text);
  const rulesQuestion = /(по правилам|как работает|можно ли|разрешено ли|правило|механик|действи[ея]|бонусн|реакци[яию]|заклинани|концентрац|спасброс|атака|урон|класс брони|состояни[ея]|черта|умени[ея]|уровн[яи]|мультикласс|днд|d&d|dungeons\s*&\s*dragons)/i.test(text);
  return asksForSources || rulesQuestion || body?.forceSearch === true;
}

function buildMessages(body, systemText) {
  const messages = [{ role: 'system', content: systemText }];
  const rawHistory = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY_ITEMS) : [];
  const history = [];
  let historyChars = 0;
  // Keep the most recent context while preventing a huge chat log from crowding out the character sheet.
  for (let i = rawHistory.length - 1; i >= 0; i--) {
    const item = rawHistory[i];
    const content = cleanText(item?.content || item?.text, 2500);
    if (!content || historyChars + content.length > MAX_HISTORY_CHARS) continue;
    const role = item?.role === 'assistant' || item?.role === 'model' ? 'assistant' : 'user';
    history.unshift({ role, content });
    historyChars += content.length;
  }
  messages.push(...history);
  const message = cleanText(body.message || body.prompt, MAX_MESSAGE_CHARS);
  if (!message) return { error: 'Укажи текст сообщения.' };
  const last = messages[messages.length - 1];
  if (last?.role !== 'user' || last.content !== message) messages.push({ role: 'user', content: message });
  return { messages };
}
async function searchWeb(query) {
  if (!process.env.SERPER_API_KEY) return [];
  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST', headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 5 }), signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.organic || []).slice(0, 5).map(item => ({ title: cleanText(item.title, 180), url: item.link, snippet: cleanText(item.snippet, 500), host: getHost(item.link) })).filter(item => item.url && /^https?:/.test(item.url));
  } catch { return []; }
}
function filterCitations(citations, sourceMode) {
  return citations.filter(c => {
    const host = getHost(c.url);
    if (sourceMode === 'official') return OFFICIAL_HOSTS.some(d => hostMatches(host, d));
    return true;
  }).slice(0, 8);
}
export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (!allowedOrigin(req.headers?.origin || '')) return send(res, 403, { ok: false, error: 'Origin is not allowed.' });
  if (req.method === 'GET') return send(res, 200, { ok: true, service: 'questsheet-ai-bot', version: '1.2.0', model: process.env.GROQ_MODEL || DEFAULT_MODEL, methods: ['GET', 'POST', 'OPTIONS'], features: ['dnd-5e-2014', 'dnd-5e-2024', 'serper-web-search-optional', 'source-citations'] });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST, OPTIONS'); return send(res, 405, { ok: false, error: 'Method not allowed.' }); }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return send(res, 400, { ok: false, error: 'Тело запроса должно быть корректным JSON.' }); } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { ok: false, error: 'Ожидался JSON-объект.' });
  const message = cleanText(body.message || body.prompt, MAX_MESSAGE_CHARS);
  if (!message) return send(res, 400, { ok: false, error: 'Укажи текст сообщения.' });
  if (!process.env.GROQ_API_KEY) return send(res, 503, { ok: false, error: 'На сервере не задан GROQ_API_KEY. Добавь его в переменные окружения Vercel.' });
  const context = contextToText(body.character ?? body.characterSheet ?? body.context);
  const customInstructions = cleanText(body.systemInstructions, 5000);
  const edition = ['2014', '2024', 'both'].includes(body.edition) ? body.edition : 'both';
  const sourceMode = body.sourceMode === 'official' ? 'official' : 'mixed';
  const citations = shouldSearchWeb(message, body) ? await searchWeb(message) : [];
  const usableCitations = filterCitations(citations, sourceMode);
  const searchContext = usableCitations.map((c, i) => `[${i + 1}] ${c.title}\nURL: ${c.url}\n${c.snippet}`).join('\n\n');
  const built = buildMessages({ ...body, message }, makeInstructions({ edition, sourceMode, character: context, customInstructions, searchContext }));
  if (built.error) return send(res, 400, { ok: false, error: built.error });
  const model = cleanText(process.env.GROQ_MODEL || DEFAULT_MODEL, 100).replace(/[^a-zA-Z0-9._/-]/g, '');
  let upstream;
  try {
    upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model, messages: built.messages, temperature: 0.75, top_p: 0.9, max_tokens: wantsDetailedAnswer(message) ? DETAILED_REPLY_TOKENS : SHORT_REPLY_TOKENS }), signal: AbortSignal.timeout(50000)
    });
  } catch (err) {
    return send(res, 502, { ok: false, error: 'Не удалось подключиться к Groq API.', details: cleanText(err?.message || String(err), 220) });
  }
  let result;
  try { result = await upstream.json(); } catch { result = {}; }
  if (!upstream.ok) {
    const apiMessage = cleanText(result?.error?.message || result?.message, 500);
    if (upstream.status === 429) return send(res, 429, { ok: false, error: 'Groq временно ограничил запросы: исчерпан лимит или превышена частота запросов. Подожди и попробуй снова.', upstreamStatus: 429, details: apiMessage || 'Rate limit or quota exceeded.' });
    const status = upstream.status === 401 || upstream.status === 403 ? 502 : 502;
    return send(res, status, { ok: false, error: 'Groq API вернул ошибку.', upstreamStatus: upstream.status, details: apiMessage || 'Пустой или нечитаемый ответ Groq.' });
  }
  const reply = cleanText(result?.choices?.[0]?.message?.content, 12000);
  if (!reply) return send(res, 502, { ok: false, error: 'Groq не вернул текст ответа.', details: result?.choices?.[0]?.finish_reason || 'Пустой ответ модели.' });
  return send(res, 200, { ok: true, service: 'questsheet-ai-bot', reply, text: reply, answer: reply, model, grounded: usableCitations.length > 0, citations: usableCitations });
}
export { makeInstructions, buildMessages, searchWeb };
