const groupSelect = document.getElementById('groupSelect');
const reloadBtn = document.getElementById('reloadBtn');
const rawToggle = document.getElementById('rawToggle');
const statusEl = document.getElementById('status');
const table = document.getElementById('tasksTable');
const tbody = document.getElementById('tasksBody');
const rawJsonEl = document.getElementById('rawJson');

let lastData = null;

function escapeIcsText(str) {
  return String(str ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function toIcsUtc(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  );
}

function buildIcs(task, whenLocalValue) {
  const start = new Date(whenLocalValue);
  const now = new Date();
  const uid = `wz-${task.id ?? Math.random().toString(36).slice(2)}-${start.getTime()}@work-zilla-notifyer`;
  const summary = `Проверить публикацию: ${task.title ?? 'задание'}`;
  const descriptionParts = [];
  if (task.customer) descriptionParts.push(`Заказчик: ${task.customer}`);
  if (task.sum !== undefined) descriptionParts.push(`Сумма: ${task.sum}`);
  if (task.id !== undefined) descriptionParts.push(`ID: ${task.id}`);
  const description = descriptionParts.join('\\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//work-zilla-notifyer//RU',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtc(now)}`,
    `DTSTART:${toIcsUtc(start)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    'BEGIN:VALARM',
    'TRIGGER:PT0M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText(summary)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function downloadIcs(task, whenLocalValue) {
  if (!whenLocalValue) {
    alert('Сначала укажите дату и время напоминания.');
    return;
  }
  const ics = buildIcs(task, whenLocalValue);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeTitle = (task.title ?? 'task').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
  a.download = `reminder-${safeTitle || task.id}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function defaultWhenValue() {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderTasks(groupKey) {
  const tasks = lastData.groups[groupKey] || [];
  tbody.innerHTML = '';
  for (const task of tasks) {
    const tr = document.createElement('tr');

    const tdCustomer = document.createElement('td');
    tdCustomer.textContent = task.customer ?? '—';

    const tdTitle = document.createElement('td');
    tdTitle.textContent = task.title ?? '—';

    const tdSum = document.createElement('td');
    tdSum.textContent = task.sum ?? '—';

    const tdDeadline = document.createElement('td');
    tdDeadline.textContent = task.deadline ?? '—';

    const tdReminder = document.createElement('td');
    tdReminder.className = 'reminder-cell';

    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.value = defaultWhenValue();

    const btn = document.createElement('button');
    btn.textContent = 'Скачать .ics';
    btn.addEventListener('click', () => downloadIcs(task, input.value));

    tdReminder.appendChild(input);
    tdReminder.appendChild(btn);

    tr.append(tdCustomer, tdTitle, tdSum, tdDeadline, tdReminder);
    tbody.appendChild(tr);
  }
  table.hidden = tasks.length === 0;
  if (tasks.length === 0) {
    statusEl.textContent = `В группе "${groupKey}" ничего не найдено.`;
  } else {
    statusEl.textContent = '';
  }
}

function populateGroupSelect() {
  groupSelect.innerHTML = '';
  const keys = Object.keys(lastData.groups);
  for (const key of keys) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = `${key} (${lastData.groups[key].length})`;
    groupSelect.appendChild(opt);
  }
  const saved = localStorage.getItem('wz-selected-group');
  const initial = keys.includes(saved) ? saved : lastData.guessedInWorkKey;
  groupSelect.value = initial;
}

async function load() {
  statusEl.textContent = 'Загрузка...';
  table.hidden = true;
  try {
    const res = await fetch('/api/tasks');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Неизвестная ошибка');
    lastData = data;
    populateGroupSelect();
    renderTasks(groupSelect.value);
    rawJsonEl.textContent = JSON.stringify(data.raw, null, 2);
  } catch (err) {
    statusEl.textContent = `Ошибка: ${err.message}`;
  }
}

groupSelect.addEventListener('change', () => {
  localStorage.setItem('wz-selected-group', groupSelect.value);
  renderTasks(groupSelect.value);
});

reloadBtn.addEventListener('click', load);

rawToggle.addEventListener('change', () => {
  rawJsonEl.hidden = !rawToggle.checked;
});

load();
