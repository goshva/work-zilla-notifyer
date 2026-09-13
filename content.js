(function () {
  const SECTION_TITLE = 'В работе';
  const REMINDERS_KEY = 'wz-notifier-reminders';
  const TASKS_KEY = 'wz-notifier-tasks';

  function readJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key)) || {};
    } catch {
      return {};
    }
  }
  function writeJson(key, obj) {
    localStorage.setItem(key, JSON.stringify(obj));
  }
  function getReminders() {
    return readJson(REMINDERS_KEY);
  }
  function getReminder(orderId) {
    return getReminders()[orderId];
  }
  function setReminder(orderId, whenValue) {
    const all = getReminders();
    all[orderId] = whenValue;
    writeJson(REMINDERS_KEY, all);
  }
  function getCachedTask(orderId) {
    return readJson(TASKS_KEY)[orderId];
  }
  function cacheTask(orderId, task) {
    const all = readJson(TASKS_KEY);
    all[orderId] = task;
    writeJson(TASKS_KEY, all);
  }

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
    const uid = `wz-${task.orderId}-${start.getTime()}@work-zilla-notifier`;
    const summary = `Проверить публикацию: ${task.title}`;

    const descLines = [];
    if (task.partner) descLines.push(`Заказчик: ${task.partner}`);
    if (task.price) descLines.push(`Сумма: ${task.price}`);
    if (task.lastMessage) descLines.push(`Текст: ${task.lastMessage}`);
    descLines.push(task.url);
    const description = descLines.join('\n');

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//work-zilla-notifier//RU',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${toIcsUtc(now)}`,
      `DTSTART:${toIcsUtc(start)}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      `URL:${task.url}`,
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
    const ics = buildIcs(task, whenLocalValue);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = (task.title || 'task').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
    a.download = `reminder-${safeTitle || task.orderId}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function defaultWhenValue() {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    d.setSeconds(0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ---- список заданий: только колокольчик-индикатор ----

  function extractTask(el) {
    const orderId = el.dataset.orderId || '';
    const href = el.getAttribute('href') || '';
    const url = href.startsWith('http') ? href : location.origin + href;
    const title =
      el.querySelector('.title .text-wrapper')?.textContent.trim() ||
      el.querySelector('.small-top-panel .title')?.textContent.trim() ||
      el.querySelector('.title')?.textContent.trim() ||
      'Задание';
    const partner = el.querySelector('.partner-name')?.textContent.trim() || '';
    const price = el.querySelector('.price-order-in-list .param-title')?.textContent.trim() || '';
    const lastMessage = el.querySelector('.message-text > span')?.textContent.trim() || '';
    return { orderId, url, title, partner, price, lastMessage };
  }

  function updateBell(el, orderId) {
    let bell = el.querySelector('.wz-notifier-bell');
    if (!bell) {
      bell = document.createElement('span');
      bell.className = 'wz-notifier-bell';
      bell.textContent = '🔔';
      const header = el.querySelector('.order-header') || el;
      header.appendChild(bell);
    }
    const reminder = getReminder(orderId);
    if (reminder) {
      bell.hidden = false;
      bell.title = `Напоминание на ${new Date(reminder).toLocaleString('ru-RU')}`;
    } else {
      bell.hidden = true;
    }
  }

  function processListPage() {
    document.querySelectorAll('.order-list-section').forEach((section) => {
      const titleEl = section.querySelector('.section-title');
      if (!titleEl || titleEl.textContent.trim() !== SECTION_TITLE) return;

      section.querySelectorAll('a.order-container[data-order-id]').forEach((el) => {
        const task = extractTask(el);
        if (!task.orderId) return;
        cacheTask(task.orderId, task);
        updateBell(el, task.orderId);
      });
    });
  }

  // ---- страница чата задания: полноценный выбор даты/времени ----

  function renderPanelStatus(panel, orderId) {
    const input = panel.querySelector('.wz-notifier-input');
    const status = panel.querySelector('.wz-notifier-status');
    const reminder = getReminder(orderId);
    if (reminder) {
      input.value = reminder;
      status.textContent = `🔔 Напоминание установлено на ${new Date(reminder).toLocaleString('ru-RU')}`;
    } else {
      if (!input.value) input.value = defaultWhenValue();
      status.textContent = 'Напоминание пока не установлено';
    }
  }

  function buildChatPanel(orderId) {
    const panel = document.createElement('div');
    panel.id = 'wz-notifier-panel';
    panel.dataset.orderId = orderId;

    const title = document.createElement('div');
    title.className = 'wz-notifier-panel-title';
    title.textContent = 'Напоминание проверить публикацию';

    const row = document.createElement('div');
    row.className = 'wz-notifier-panel-row';

    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.className = 'wz-notifier-input';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wz-notifier-btn';
    btn.textContent = 'Сохранить и скачать .ics';

    const status = document.createElement('div');
    status.className = 'wz-notifier-status';

    btn.addEventListener('click', () => {
      if (!input.value) {
        alert('Укажите дату и время проверки.');
        return;
      }
      setReminder(orderId, input.value);
      const task =
        getCachedTask(orderId) ||
        {
          orderId,
          url: location.href,
          title: document.title || 'Задание',
          partner: '',
          price: '',
          lastMessage: '',
        };
      downloadIcs(task, input.value);
      renderPanelStatus(panel, orderId);
    });

    row.appendChild(input);
    row.appendChild(btn);
    panel.appendChild(title);
    panel.appendChild(row);
    panel.appendChild(status);

    renderPanelStatus(panel, orderId);
    return panel;
  }

  function processChatPage() {
    const match = location.pathname.match(/^\/freelancer\/(\d+)(?:\/|$)/);
    const existing = document.getElementById('wz-notifier-panel');

    if (!match) {
      if (existing) existing.remove();
      return;
    }

    const orderId = match[1];
    if (existing && existing.dataset.orderId === orderId) return;
    if (existing) existing.remove();

    document.body.appendChild(buildChatPanel(orderId));
  }

  function processAll() {
    processListPage();
    processChatPage();
  }

  const observer = new MutationObserver(() => processAll());
  observer.observe(document.body, { childList: true, subtree: true });
  processAll();
})();
