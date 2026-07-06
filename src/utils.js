(function () {
  'use strict';

  window.C360 = window.C360 || {};

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function today() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function number(value, fallback = 0) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    const text = String(value ?? '').trim();
    if (!text) return fallback;
    const normalized = text.includes(',')
      ? text.replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
      : text.replace(/\s/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function percent(value) {
    return number(value) / 100;
  }

  function money(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(number(value));
  }

  function qty(value, unit) {
    const formatted = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(number(value));
    return unit ? `${formatted} ${unit}` : formatted;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadText(filename, text, mime = 'application/json') {
    downloadBlob(filename, new Blob([text], { type: mime }));
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function sortByDateDesc(items, key = 'date') {
    return [...items].sort((a, b) => String(b[key] || '').localeCompare(String(a[key] || '')));
  }

  function findById(items, id) {
    return items.find((item) => item.id === id) || null;
  }

  function compact(value, fallback = '—') {
    return value === undefined || value === null || value === '' ? fallback : value;
  }

  function assertPositive(value, label) {
    if (number(value) <= 0) throw new Error(`${label} precisa ser maior que zero.`);
  }

  window.C360.utils = {
    uid,
    today,
    nowIso,
    number,
    percent,
    money,
    qty,
    escapeHtml,
    downloadBlob,
    downloadText,
    formData,
    sortByDateDesc,
    findById,
    compact,
    assertPositive,
  };
})();
