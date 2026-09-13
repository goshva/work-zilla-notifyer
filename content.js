(function () {
  const SECTION_TITLE = 'В работе';
  const PROCESSED_ATTR = 'data-wz-notifier';

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
    const description = descLines.join('\\n');

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
    if (!whenLocalValue) {
      alert('Укажите дату и время проверки.');
      return;
    }
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

  function stop(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function buildWidget(task) {
    const wrap = document.createElement('div');
    wrap.className = 'wz-notifier-widget';

    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.className = 'wz-notifier-input';
    input.value = defaultWhenValue();
    input.addEventListener('click', stop);
    input.addEventListener('mousedown', stop);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wz-notifier-btn';
    btn.textContent = '🔔 Напомнить проверить';
    btn.title = 'Скачать .ics-напоминание для календаря';
    btn.addEventListener('mousedown', stop);
    btn.addEventListener('click', (e) => {
      stop(e);
      downloadIcs(task, input.value);
    });

    wrap.appendChild(input);
    wrap.appendChild(btn);
    return wrap;
  }

  function processAll() {
    document.querySelectorAll('.order-list-section').forEach((section) => {
      const titleEl = section.querySelector('.section-title');
      if (!titleEl || titleEl.textContent.trim() !== SECTION_TITLE) return;

      section.querySelectorAll('a.order-container[data-order-id]').forEach((el) => {
        if (el.hasAttribute(PROCESSED_ATTR)) return;
        el.setAttribute(PROCESSED_ATTR, '1');

        const task = extractTask(el);
        const widget = buildWidget(task);
        const host =
          el.querySelector('.order-content-text-container') ||
          el.querySelector('.small-bottom-panel') ||
          el;
        host.appendChild(widget);
      });
    });
  }

  const observer = new MutationObserver(() => processAll());
  observer.observe(document.body, { childList: true, subtree: true });
  processAll();
})();
