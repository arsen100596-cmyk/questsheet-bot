import http from 'node:http';
import handler from './api/index.js';
const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = raw; }
  await handler(req, res);
});
const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`QuestSheet AI API listening on http://localhost:${port}/api`));
