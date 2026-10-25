const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_HISTORY_MESSAGES = 16;
const MAX_MESSAGE_CHARS = 12000;
const MAX_HISTORY_CHARS = 24000;

const DEFAULT_SYSTEM = `Ты — QuestSheet AI, опытный и дружелюбный напарник по Dungeons & Dragons.
Общайся естественно, как в обычной переписке с человеком, который хорошо знает D&D. Не изображай человека и не утверждай, что имеешь личный опыт.
ГЛАВНОЕ ПРАВИЛО СТИЛЯ:
- По умолчанию отвечай коротко и по делу: обычно 1–3 предложения.
- Сначала дай прямой ответ на вопрос. Не начинай с вступлений вроде «Давайте разберёмся», «Отличный вопрос» или пересказа вопроса.
- Не используй заголовки, списки и длинные пояснения, если они не нужны для ответа.
- Поддерживай текущую тему разговора и естественно отвечай на уточнения; не заставляй пользователя повторять уже сообщённые сведения.
- Задавай уточняющий вопрос только когда без него нельзя ответить правильно.
- Подробно объясняй только по явной просьбе пользователя («подробно», «разбери по шагам», «объясни полностью»).
- Не обрезай важные оговорки: если от них зависит правильность правила, упомяни их кратко.
D&D И ПЕРСОНАЖ:
- Используй данные CHARACTER SHEET / character / context как актуальный лист персонажа. Не выдумывай отсутствующие значения, способности, заклинания или предметы.
- Учитывай редакцию правил, указанную в запросе. Если редакция неясна и это влияет на ответ, коротко уточни или обозначь различие.
- Не выдавай домашние правила за официальные. Не выдумывай источники, цитаты, номера страниц или ссылки.
- Если сервер не выполнял веб-поиск и в запросе нет источников, не утверждай, что только что проверил интернет.
- Не изменяй лист персонажа автоматически. Предложения об изменении сначала сформулируй как предложение.
Пиши на языке пользователя. Избегай канцелярита и тона энциклопедической статьи.`;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.end(JSON.stringify(body));
}
function trimText(value, max) {
  if (typeof value !== "string") return "";
  return value.length > max ? value.slice(0, max) : value;
}
function safeJson(value, max = 16000) {
  try {
    const str = JSON.stringify(value ?? {});
    return str.length > max ? str.slice(0, max) + "…[сокращено]" : str;
  } catch { return "{}"; }
}
function cleanHistory(history, currentMessage) {
  if (!Array.isArray(history)) return [];
  let remaining = MAX_HISTORY_CHARS;
  const out = [];
  for (const item of history.slice(-MAX_HISTORY_MESSAGES)) {
    if (!item || !["user", "assistant", "model"].includes(item.role)) continue;
    let content = trimText(String(item.content || item.text || ""), 5000).trim();
    if (!content || content === currentMessage) continue;
    if (content.length > remaining) content = content.slice(-remaining);
    remaining -= content.length;
    if (remaining <= 0) break;
    out.push({ role: item.role === "assistant" ? "model" : item.role, parts: [{ text: content }] });
  }
  return out;
}
module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method === "GET") return send(res, 200, {
    ok: true,
    service: "QuestSheet AI",
    version: "1.2",
    model: DEFAULT_MODEL,
    message: "API готов. Для чата отправьте POST-запрос."
  });
  if (req.method !== "POST") return send(res, 405, { error: "Используйте GET или POST." });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return send(res, 500, {
    error: "На сервере не задан GEMINI_API_KEY.",
    hint: "Добавьте ключ Gemini в Vercel → Project Settings → Environment Variables и передеплойте проект."
  });

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const message = trimText(String(body.message || body.prompt || ""), MAX_MESSAGE_CHARS).trim();
    if (!message) return send(res, 400, { error: "Сообщение пустое." });

    const systemInstructions = trimText(String(body.systemInstructions || ""), 10000);
    const edition = trimText(String(body.edition || "both"), 100);
    const sourceMode = trimText(String(body.sourceMode || "mixed"), 100);
    const character = body.character ?? body.characterSheet ?? body.context ?? null;
    const sheet = character ? `\n\n[АКТУАЛЬНЫЕ ДАННЫЕ ПЕРСОНАЖА]\n${safeJson(character, 18000)}\n[КОНЕЦ ДАННЫХ ПЕРСОНАЖА]` : "";
    const system = [
      DEFAULT_SYSTEM,
      `\nРедакция D&D: ${edition}. Предпочтение источников: ${sourceMode}.`,
      systemInstructions ? `\nДополнительные инструкции приложения:\n${systemInstructions}` : "",
      sheet
    ].join("\n").slice(0, 38000);

    const history = cleanHistory(body.history, message);
    history.push({ role: "user", parts: [{ text: message }] });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(DEFAULT_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: history,
        generationConfig: {
          temperature: 0.75,
          topP: 0.9,
          maxOutputTokens: 700,
          responseMimeType: "text/plain"
        }
      })
    });
    const raw = await upstream.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = {}; }
    if (!upstream.ok) {
      const detail = data?.error?.message || `Gemini API вернул HTTP ${upstream.status}.`;
      const status = upstream.status === 429 ? 429 : (upstream.status >= 500 ? 502 : upstream.status);
      return send(res, status, {
        error: status === 429
          ? "У Gemini превышена квота или слишком много запросов. Проверьте лимиты и биллинг API."
          : detail,
        upstreamStatus: upstream.status
      });
    }
    const reply = (data?.candidates?.[0]?.content?.parts || [])
      .map(p => typeof p.text === "string" ? p.text : "")
      .join("")
      .trim();
    if (!reply) {
      const reason = data?.candidates?.[0]?.finishReason || "NO_TEXT";
      return send(res, 502, { error: "Модель не вернула текстовый ответ.", finishReason: reason });
    }
    return send(res, 200, { reply, text: reply, model: DEFAULT_MODEL });
  } catch (error) {
    return send(res, 500, { error: "Внутренняя ошибка сервера.", detail: String(error?.message || error).slice(0, 300) });
  }
};
