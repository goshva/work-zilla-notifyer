// Точная структура ответа Work-Zilla заранее не была подтверждена (дамп запросов
// пользователя обрывался до вызова со списком заданий), поэтому вместо жёсткого
// маппинга под конкретные ключи JSON здесь используется эвристический поиск:
// рекурсивно обходим ответ, находим массивы объектов, похожих на задания
// (есть заголовок + сумма/цена), и группируем их по имени родительского ключа.
// Это позволяет разобраться в реальной структуре через UI (переключатель
// "сырой JSON" и выбор нужной группы), не переписывая код после каждого предположения.

const TITLE_KEYS = ['title', 'name', 'subject', 'header', 'orderName', 'taskName'];
const SUM_KEYS = ['sum', 'price', 'cost', 'amount', 'reward', 'budget'];
const ID_KEYS = ['id', 'orderId', 'taskId'];
const DEADLINE_KEYS = ['deadline', 'dueDate', 'expire', 'expireDate', 'endDate', 'timeLeft', 'remain'];
const CUSTOMER_KEYS = ['customer', 'customerName', 'clientName', 'author', 'from'];
const MESSAGE_KEYS = ['lastMessage', 'message', 'comment', 'text'];

function findKey(obj, candidates) {
  const keys = Object.keys(obj);
  for (const cand of candidates) {
    const found = keys.find((k) => k.toLowerCase() === cand.toLowerCase());
    if (found) return obj[found];
  }
  for (const cand of candidates) {
    const found = keys.find((k) => k.toLowerCase().includes(cand.toLowerCase()));
    if (found) return obj[found];
  }
  return undefined;
}

function looksLikeTask(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const hasTitle = findKey(obj, TITLE_KEYS) !== undefined;
  const hasSum = findKey(obj, SUM_KEYS) !== undefined;
  const hasId = findKey(obj, ID_KEYS) !== undefined;
  return hasTitle && (hasSum || hasId);
}

function mapTask(raw) {
  return {
    id: findKey(raw, ID_KEYS),
    title: findKey(raw, TITLE_KEYS),
    sum: findKey(raw, SUM_KEYS),
    deadline: findKey(raw, DEADLINE_KEYS),
    customer: findKey(raw, CUSTOMER_KEYS),
    lastMessage: findKey(raw, MESSAGE_KEYS),
    raw,
  };
}

// Обходит JSON и собирает { groupKey: [rawTask, ...] } для каждого массива,
// где хотя бы один элемент похож на задание.
function findTaskGroups(data, path = [], acc = {}) {
  if (Array.isArray(data)) {
    const taskLike = data.filter(looksLikeTask);
    if (taskLike.length > 0 && taskLike.length >= data.length * 0.5) {
      const key = path[path.length - 1] || 'root';
      acc[key] = (acc[key] || []).concat(taskLike);
    } else {
      data.forEach((item, i) => findTaskGroups(item, path.concat(String(i)), acc));
    }
  } else if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) {
      findTaskGroups(v, path.concat(k), acc);
    }
  }
  return acc;
}

function guessInWorkKey(groups) {
  const keys = Object.keys(groups);
  const preferred = keys.find((k) => /inwork|in_work|working|active/i.test(k));
  if (preferred) return preferred;
  // "В работе" на скриншоте — вторая по величине группа после "В очереди"/"Новые" по смыслу;
  // если явного имени нет, отдаём группу, но помечаем как неточную догадку (guessed:false на фронте).
  return keys[0];
}

module.exports = { findTaskGroups, guessInWorkKey, mapTask };
