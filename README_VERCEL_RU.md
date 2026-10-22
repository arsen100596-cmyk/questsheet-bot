# QuestSheet AI Bot — чистый пакет для Vercel

## Почему могла повторяться ошибка unused_function
Если Vercel продолжает сообщать, что `functions` содержит шаблон `api/index.js`, значит в фактически разворачиваемой конфигурации всё ещё есть старый блок `functions` (или Vercel разворачивает другой корень/старый коммит). В этом пакете такого блока нет.

## Развёртывание
1. Создайте отдельный GitHub-репозиторий для сервера.
2. Загрузите **содержимое этой папки целиком в корень репозитория**, не создавая дополнительную папку `server` или `QuestSheet-AI-Bot-v1.3-Vercel-Deploy`.
3. В корне должны лежать `vercel.json`, `package.json` и папка `api/index.js`.
4. В Vercel → Project → Settings → General → Root Directory выберите `./` (корень репозитория), если сервер загружен в корень. Сохраните.
5. Проверьте все файлы `vercel.json` в репозитории: удалите старые дубликаты и любой блок `"functions": {"api/index.js": ...}`. В этом пакете должен быть только один `vercel.json`.
6. Добавьте `GEMINI_API_KEY` в Settings → Environment Variables.
7. Сделайте новый commit и затем Redeploy именно этого commit.

## Проверка структуры
Корень репозитория:
- `vercel.json`
- `package.json`
- `api/index.js`
- `local-server.js`
- `tests/api.test.js`

## Важно
Не разворачивайте Android-папку как Vercel Root Directory. Успешный deployment ещё не подтверждает успешный ответ Gemini; после Deploy проверьте `https://ВАШ-ДОМЕН.vercel.app/api` и отправьте тестовый POST-запрос. Не публикуйте `GEMINI_API_KEY`.
