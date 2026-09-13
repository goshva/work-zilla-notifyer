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
    const r = getReminders()[orderId];
    if (!r) return undefined;
    return typeof r === 'string' ? { when: r, link: '' } : r;
  }
  function setReminder(orderId, whenValue, link) {
    const all = getReminders();
    all[orderId] = { when: whenValue, link: link || '' };
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
    if (task.link) descLines.push(`Публикация: ${task.link}`);
    descLines.push(task.url);
    const description = descLines.join('\n');
    const icsUrl = task.link || task.url;

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
      `URL:${icsUrl}`,
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
    if (reminder && reminder.when) {
      bell.hidden = false;
      let title = `Напоминание на ${new Date(reminder.when).toLocaleString('ru-RU')}`;
      if (reminder.link) title += `\nСсылка: ${reminder.link}`;
      bell.title = title;
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

  function normalizeLink(value) {
    const link = value.trim();
    if (!link) return '';
    return /^https?:\/\//i.test(link) ? link : `https://${link}`;
  }

  function renderPanelStatus(panel, orderId) {
    const input = panel.querySelector('.wz-notifier-input');
    const linkInput = panel.querySelector('.wz-notifier-link-input');
    const status = panel.querySelector('.wz-notifier-status');
    const reminder = getReminder(orderId);
    if (reminder && reminder.when) {
      input.value = reminder.when;
      linkInput.value = reminder.link || '';
      const parts = [`🔔 Напоминание на ${new Date(reminder.when).toLocaleString('ru-RU')}`];
      if (reminder.link) parts.push(`ссылка: ${reminder.link}`);
      status.textContent = parts.join(', ');
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

    const dateLabel = document.createElement('label');
    dateLabel.className = 'wz-notifier-label';
    dateLabel.textContent = 'Когда проверить';

    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.className = 'wz-notifier-input';

    const linkLabel = document.createElement('label');
    linkLabel.className = 'wz-notifier-label';
    linkLabel.textContent = 'Ссылка на публикацию (необязательно)';

    const linkInput = document.createElement('input');
    linkInput.type = 'text';
    linkInput.className = 'wz-notifier-link-input';
    linkInput.placeholder = 'https://...';

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
      const link = normalizeLink(linkInput.value);
      setReminder(orderId, input.value, link);
      const cached = getCachedTask(orderId);
      const task = {
        orderId,
        url: cached?.url || location.href,
        title: cached?.title || document.title || 'Задание',
        partner: cached?.partner || '',
        price: cached?.price || '',
        lastMessage: cached?.lastMessage || '',
        link,
      };
      downloadIcs(task, input.value);
      renderPanelStatus(panel, orderId);
    });

    panel.appendChild(title);
    panel.appendChild(dateLabel);
    panel.appendChild(input);
    panel.appendChild(linkLabel);
    panel.appendChild(linkInput);
    panel.appendChild(btn);
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
