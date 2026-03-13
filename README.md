# 🔬 Oracle Command Center — Telegram Mini App

Визуальный командный центр для AI-агентов Oracle. Управление агентами, граф знаний, мониторинг системы и оркестрация задач — всё в одном интерфейсе.

---

## 📱 Скриншот функционала

| Экран | Что делает |
|-------|-----------|
| 🌐 **Граф** | Интерактивный D3.js граф vault-заметок (силовая симуляция, zoom/pan, клик по узлу) |
| 🤖 **Агенты** | Группы агентов, статус, кнопка «Запустить», создание групп через FAB |
| 📊 **Монитор** | Real-time метрики системы, контекст модели, timeline событий |
| 🎯 **Задачи** | Оркестрация: запустить группу → описать задачу → симуляция прогресса |

---

## 🛠 Технологии

- **Vanilla JS** — никаких сборщиков, всё в одном HTML-файле
- **D3.js v7** — force-directed граф знаний (CDN)
- **Telegram WebApp SDK** — интеграция с Telegram, haptic feedback, тема
- **CSS Custom Properties** — темизация через Telegram CSS vars
- **Дизайн** — Dark cyberpunk + Apple HIG принципы

---

## 🚀 Деплой на GitHub Pages

### Шаг 1 — Загрузить файл в репозиторий

```bash
# Если у тебя уже есть репозиторий:
git clone https://github.com/TheMacroeconomicDao/oracle-miniapp.git
cd oracle-miniapp

# Скопировать файл:
cp /path/to/miniapp/index.html .

git add index.html
git commit -m "feat: Oracle Command Center mini app"
git push origin main
```

### Шаг 2 — Включить GitHub Pages

1. Открыть репозиторий на GitHub
2. Перейти: **Settings → Pages**
3. Source: `Deploy from a branch`
4. Branch: `main` / `/ (root)`
5. Нажать **Save**

Через ~2 минуты Mini App будет доступен по адресу:
```
https://themacroeconomicdao.github.io/oracle-miniapp/
```

### Альтернатива — использовать существующий репозиторий `openclaw-k8s`

```bash
# В директории репозитория создать папку miniapp:
mkdir -p miniapp
cp index.html miniapp/

# Pages настроить на /docs или включить для конкретной папки
```

---

## 🤖 Подключение к боту (@SmartOracle_bot)

### Через BotFather

1. Открыть [@BotFather](https://t.me/BotFather) в Telegram
2. Команда: `/newapp` (или `/editapp` для существующего бота)
3. Выбрать бота: `@SmartOracle_bot`
4. Ввести данные:
   - **Title:** Oracle Command Center
   - **Short description:** Командный центр AI-агентов Oracle
   - **URL:** `https://themacroeconomicdao.github.io/oracle-miniapp/`
   - **Short name:** `oracle_cc` (используется в ссылке)

### Добавить кнопку в меню бота

В BotFather: `/setmenubutton`
- Выбрать бота
- Ввести URL приложения
- Кнопка появится в левом нижнем углу чата с ботом

### Прямая ссылка

После создания приложение будет доступно как:
```
https://t.me/SmartOracle_bot/oracle_cc
```

---

## 🎨 Дизайн-система

```css
/* Палитра */
--blue:   #007AFF;   /* Основной акцент, проекты */
--green:  #34C759;   /* Успех, активен */
--purple: #BF5AF2;   /* Теория */
--cyan:   #64D2FF;   /* AI агенты */
--orange: #FF9F0A;   /* Предупреждения */
--red:    #FF453A;   /* Критические находки */

/* Типографика */
font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui;

/* Тёмный фон с сеткой */
--bg: #080810 + grid pattern rgba(255,255,255,0.018)
```

---

## 📁 Структура файла

```
index.html (57 KB)
├── <style>              — Design system (CSS Variables, components)
│   ├── Layout           — Screens, scroll containers
│   ├── Bottom Nav       — iOS-style tab bar
│   ├── Cards & Badges   — Reusable components
│   ├── Graph styles     — SVG legend, zoom controls, node panel
│   ├── Agent screen     — Groups, agent rows
│   ├── Monitor screen   — Metrics, timeline
│   ├── Tasks screen     — Launch hero, task cards
│   └── Modal system     — Slide-up sheets
└── <script>
    ├── Telegram init    — WebApp SDK, haptic feedback
    ├── Data             — AGENTS, GROUPS, TASKS, TIMELINE, GRAPH
    ├── Navigation       — Screen switching
    ├── Modal system     — Open/close sheet modals
    ├── D3.js Graph      — Force simulation, glow filters, node panel
    ├── Agents screen    — Render groups, agent list, create group
    ├── Monitor screen   — Metrics, agent statuses, timeline
    ├── Tasks screen     — Task list, detail view, orchestration
    └── Simulation       — Fake progress animation for demo
```

---

## 🔗 Подключение к реальному API

Сейчас данные статичные (mock). Для подключения к живому Oracle:

### Endpoint структура (NestJS/FastAPI):

```typescript
// GET /api/agents — список агентов и их статус
// GET /api/groups — группы агентов
// POST /api/tasks — запустить задачу
// GET /api/tasks/:id — статус задачи
// GET /api/vault/graph — граф знаний из vault
// GET /api/system/status — метрики системы
```

### В JS заменить mock-данные на fetch:

```javascript
// Пример замены AGENTS на live-данные:
async function loadAgents() {
  const res = await fetch('https://your-api/api/agents', {
    headers: { Authorization: `Bearer ${tg.initData}` }
  });
  return res.json();
}
```

### Аутентификация через Telegram:

```javascript
// initData содержит подписанные данные пользователя от Telegram
const initData = tg.initData;
// Передавать в заголовке Authorization или как query param
```

---

## 📝 Расширение функционала

| Фича | Как добавить |
|------|-------------|
| Реальный граф vault | `GET /api/vault/graph` → парсить wikilinks из .md файлов |
| Push уведомления | Telegram WebApp `showAlert` / `showPopup` API |
| Drag-and-drop агентов | D3.js drag уже реализован на графе — перенести в агентов |
| Голосовой ввод задачи | `tg.showPopup` + MediaRecorder API |
| Share результатов | `tg.shareUrl` или Inline Mode |

---

*Создано Oracle AI · Gybernaty R&D · 2026*
