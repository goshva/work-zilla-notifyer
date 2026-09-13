const BASE = process.env.WORKZILLA_BASE;
const USER_ID = process.env.WORKZILLA_USER_ID;
const AGENT_ID = process.env.WORKZILLA_AGENT_ID;
const COOKIE = process.env.WORKZILLA_COOKIE;
const TASKS_PATH = (process.env.WORKZILLA_TASKS_PATH || '/api/order/v1/{userId}').replace(
  '{userId}',
  USER_ID
);

function assertConfigured() {
  if (!BASE || !USER_ID || !COOKIE) {
    throw new Error(
      'Не заполнен .env (WORKZILLA_BASE / WORKZILLA_USER_ID / WORKZILLA_COOKIE). Скопируйте .env.example в .env и заполните значения из DevTools.'
    );
  }
}

async function fetchDashboard() {
  assertConfigured();
  const url = BASE + TASKS_PATH;
  const res = await fetch(url, {
    headers: {
      accept: '*/*',
      agentid: AGENT_ID || '',
      cookie: COOKIE,
      'x-requested-with': 'XMLHttpRequest',
    },
  });

  if (!res.ok) {
    throw new Error(
      `Work-Zilla API ответил ${res.status} на ${url}. Проверьте актуальность WORKZILLA_COOKIE (сессия могла истечь) или поправьте WORKZILLA_TASKS_PATH в .env.`
    );
  }

  return res.json();
}

module.exports = { fetchDashboard };
