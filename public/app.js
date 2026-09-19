import {
  seed, applyCommand, today, nowLocal, plusDay, nights, total, balance,
  ledger, guest, currentRoom, cashSummary, category,
} from './domain.js?v=d30380d';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const money = (cents) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format((Number(cents) || 0) / 100);

// Parse dollars without floating point arithmetic. Every stored amount is cents.
function amount(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  if (!/^\d+(?:\.\d{0,2})?$/.test(raw)) throw Error('Enter an amount with up to two decimals.');
  const [whole, fraction = ''] = raw.split('.');
  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > 100000000) throw Error('Enter a smaller valid amount.');
  return cents;
}

const iconPaths = {
  home: 'M3 10 12 3l9 7v10H3Z M9 20v-7h6v7', bed: 'M3 18V7 M3 14h18v4 M3 10h6v4 M9 10h10a2 2 0 0 1 2 2v2 M3 18v2 M21 18v2',
  calendar: 'M4 5h16v16H4Z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2 M8 18h2', history: 'M4 8a9 9 0 1 1-1 8 M4 3v5h5 M12 7v6l4 2', cash: 'M3 6h18v13H3Z M3 10h18 M7 15h4',
  out: 'M10 5H4v14h6 M14 7l5 5-5 5 M8 12h11', plus: 'M12 5v14 M5 12h14', search: 'M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14 M15 15l6 6', arrow: 'M9 5l7 7-7 7', check: 'm5 12 4 4L19 6',
};
const ico = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${iconPaths[name] || iconPaths.home}"/></svg>`;
const fmtDate = (value) => value ? new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—';
const fmtShortDate = (value) => value ? new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—';
const fmtDateTime = (value) => value ? `${fmtDate(value)} · ${value.slice(11, 16)}` : '—';
const initials = (name) => String(name || 'Boss').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
const labelKind = (kind) => ({ payment: 'Room payment', deposit: 'Security deposit', refund: 'Room refund', 'deposit-return': 'Deposit returned', 'deposit-retained': 'Deposit retained' }[kind] || kind);
const labelStatus = (value) => ({ 'in-house': 'In house', reserved: 'Reserved', 'checked-out': 'Checked out', cancelled: 'Cancelled' }[value] || value);
const statusClass = (value) => ({ departures: 'orange', 'payment-due': 'red', stayovers: '', reserved: 'blue', 'checked-out': 'gray' }[value] || 'gray');
const btn = (text, action, id = '', primary = false) => `<button class="btn ${primary ? 'primary' : ''}" data-action="${action}" ${id ? `data-id="${esc(id)}"` : ''}>${text}</button>`;
const badge = (text, cls = '') => `<span class="badge ${cls}">${esc(text)}</span>`;
const field = (label, name, type = 'text', value = '', extra = '') => `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;
const select = (label, name, options, value = '') => `<div class="field"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${options.map(([v, text]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></div>`;
const errorBox = '<div class="form-error" role="alert"></div>';
const footer = (text = 'Save') => `${errorBox}<div class="modal-footer"><button type="button" class="btn" data-action="close">Cancel</button><button class="btn primary" type="submit">${text}</button></div>`;

let db;
let actor = null;
let mode = 'demo';
let page = 'home';
let historySearch = '';
let cashDate = today();
let toastTimer;
let formContext = null;
const key = 'staydesk-demo-v2';

async function api(path, body) {
  const response = await fetch(`./api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json', 'X-Staydesk-Request': '1' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 409) { await load(); render(); }
    throw Error(data.error || 'Unable to save.');
  }
  return data;
}

async function load() {
  if (mode === 'server') {
    const result = await api('state');
    db = result.db;
    actor = result.user;
    return;
  }
  try { db = JSON.parse(localStorage.getItem(key)) || seed(); } catch { db = seed(); }
  if (!db.staff.some((staff) => staff.id === 'boss' && staff.active)) db = seed();
  actor = sessionStorage.getItem('staydesk-user') === 'boss' ? 'boss' : null;
}

async function start() {
  try {
    const response = await fetch('./api/health', { cache: 'no-store' });
    if (response.ok && (await response.json()).service === 'staydesk') mode = 'server';
  } catch { mode = 'demo'; }
  try { await load(); } catch { actor = null; }
  render();
}

async function command(type, payload) {
  if (mode === 'server') {
    const result = await api('command', { command: type, payload, revision: db.revision });
    db = result.db;
    return result.id;
  }
  const saved = JSON.parse(localStorage.getItem(key) || 'null');
  if (saved && saved.revision !== db.revision) {
    db = saved;
    render();
    throw Error('Another tab updated the register. Review the latest data and try again.');
  }
  const result = applyCommand(db, actor, type, payload);
  db = result.db;
  localStorage.setItem(key, JSON.stringify(db));
  return result.id;
}

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3500);
}

function closeModal() {
  const dialog = $('#modal');
  if (dialog.open) dialog.close();
  dialog.innerHTML = '';
  formContext = null;
}

function modal(title, body) {
  const dialog = $('#modal');
  dialog.innerHTML = `<div class="modal-head"><h2>${esc(title)}</h2><button class="close" data-action="close" aria-label="Close dialog">×</button></div><div class="modal-body">${body}</div>`;
  if (!dialog.open) dialog.showModal();
}

function formValues(form) {
  const values = {};
  for (const [name, value] of new FormData(form).entries()) {
    if (values[name] === undefined) values[name] = value;
    else values[name] = Array.isArray(values[name]) ? [...values[name], value] : [values[name], value];
  }
  return values;
}

function activeStays() { return db.bookings.filter((booking) => booking.status === 'in-house'); }
function reservations() { return db.bookings.filter((booking) => booking.status === 'reserved').sort((a, b) => a.start.localeCompare(b.start)); }
function allRooms() {
  return [...new Set(db.bookings.flatMap((booking) => (booking.segments?.length ? booking.segments.map((segment) => segment.room) : [booking.room]).filter(Boolean)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
function guestName(booking) { return guest(db, booking)?.name || booking.guestSnapshot?.name || 'Unknown guest'; }
function currentStatus(booking) { return booking.status === 'in-house' ? category(db, booking) : booking.status; }
function statusText(booking) {
  const status = currentStatus(booking);
  return status === 'departures' ? 'Departure today' : status === 'payment-due' ? 'Payment due' : status === 'stayovers' ? 'Stayover' : labelStatus(status);
}

function renderLogin() {
  const serverLogin = mode === 'server';
  $('#app').innerHTML = `<main class="login"><section class="login-card"><div class="brand"><img src="./favicon.svg" alt="">Staydesk</div><p class="eyebrow">Motel front desk</p><h1>Welcome back</h1><p class="subtitle">One secure Boss account for the whole front desk.</p>${serverLogin ? `<form id="login-form"><div style="margin-top:22px">${field('Username', 'username', 'text', 'boss', 'required autocomplete="username"')}${field('Password', 'password', 'password', '', 'required autocomplete="current-password"')}</div>${footer('Sign in')}</form>` : `<div class="login-users"><button class="login-user" data-action="demo-login" data-id="boss"><span class="avatar">B</span><span><strong>Boss</strong><small>Open the browser demo</small></span>${ico('arrow')}</button></div><div class="notice">This GitHub Pages preview saves fictional data in this browser. Use the server version with a strong password for real guest records.</div>`}</section></main>`;
}

function render() {
  if (!actor) { renderLogin(); return; }
  const nav = [['home', 'home', 'Home'], ['rooms', 'bed', 'Room board'], ['reservations', 'calendar', 'Reservations'], ['history', 'history', 'History'], ['cash', 'cash', 'Cash']];
  const title = nav.find((item) => item[0] === page)?.[2] || 'Home';
  $('#app').innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><img src="./favicon.svg" alt="">Staydesk</div><div class="nav-label">Front desk</div><nav class="nav" aria-label="Main navigation">${nav.map(([id, icon, text]) => `<button data-page="${id}" class="${page === id ? 'active' : ''}" ${page === id ? 'aria-current="page"' : ''}>${ico(icon)}${text}${id === 'reservations' && reservations().length ? `<span class="count">${reservations().length}</span>` : ''}</button>`).join('')}</nav><div class="side-bottom"><div class="notice" style="background:#1c3c40;color:#b9d2cd;font-size:12px">${mode === 'demo' ? 'Browser demo<br>Cash only · No preloaded rooms' : 'Live register<br>One Boss account · Cash only'}</div><div class="staff-card"><span class="avatar">B</span><div style="font-size:13px">Boss<small>Owner · Full access</small></div><button data-action="logout" aria-label="Sign out">${ico('out')}</button></div></div></aside><main class="main"><header class="topbar"><div class="crumb">Staydesk <span style="margin:0 12px;color:#b6c3c1">/</span> <strong>${title}</strong></div><div class="brand mobile-brand"><img src="./favicon.svg" alt="">Staydesk</div><div class="topbar-right"><span class="date-text">${fmtDate(today())}</span><span class="live">${mode === 'demo' ? 'Browser demo' : 'Live register'}</span><span class="avatar">B</span></div></header>${pageContent()}</main></div>`;
}

function pageContent() {
  if (page === 'rooms') return roomBoardPage();
  if (page === 'reservations') return reservationsPage();
  if (page === 'history') return historyPage();
  if (page === 'cash') return cashPage();
  return homePage();
}

function homePage() {
  const stayovers = activeStays().filter((booking) => currentStatus(booking) === 'stayovers');
  const departures = activeStays().filter((booking) => booking.end.slice(0, 10) === today());
  const cash = cashSummary(db, today());
  return `<div class="content"><div class="page-head"><div><div class="eyebrow">Good to see you, Boss</div><h1>Today at a glance</h1><p class="subtitle">The three numbers the front desk needs first.</p></div><div class="actions">${btn(`${ico('plus')} Register guest`, 'register', '', true)}</div></div>${mode === 'demo' ? '<div class="demo-banner"><span><strong>Browser demo</strong> · Data stays on this device and starts empty.</span><button data-action="reset-demo">Clear demo data</button></div>' : ''}<div class="stats"><div class="stat"><div class="stat-top"><span>Stayovers</span><span class="stat-icon">${ico('bed')}</span></div><div class="stat-value">${stayovers.length}</div><div class="stat-foot">Paid guests staying tonight</div></div><div class="stat"><div class="stat-top"><span>Departures today</span><span class="stat-icon">${ico('calendar')}</span></div><div class="stat-value">${departures.length}</div><div class="stat-foot">Guests scheduled to leave</div></div><div class="stat"><div class="stat-top"><span>Cash collected today</span><span class="stat-icon">${ico('cash')}</span></div><div class="stat-value">${money(cash.gross)}</div><div class="stat-foot">Room payments plus deposits</div></div></div><div class="columns"><section class="panel"><div class="panel-head"><div><h2>Current stay rooms</h2><small>Rooms appear after a guest is checked in.</small></div>${btn('Open room board', 'page', 'rooms')}</div>${roomCards()}</section><div><section class="panel"><div class="panel-head"><div><h2>Departures today</h2><small>${fmtDate(today())}</small></div></div>${departureList(departures)}</section><section class="panel"><div class="panel-head"><div><h2>Cash collected today</h2><small>Cash only · exact cents</small></div>${btn('View cash', 'page', 'cash')}</div><div class="cash-hero"><small>Total collected</small><div class="amount">${money(cash.gross)}</div><div class="cash-sub"><span>Room<strong>${money(cash.room)}</strong></span><span>Deposits<strong>${money(cash.deposits)}</strong></span></div></div></section></div></div></div>`;
}

function roomCards() {
  const bookings = activeStays().sort((a, b) => currentRoom(a).localeCompare(currentRoom(b), undefined, { numeric: true }));
  if (!bookings.length) return '<div class="empty">No current stays yet.<br>Register a guest and type any room number to create the first room card.</div>';
  return `<div class="rooms">${bookings.map((booking) => { const status = currentStatus(booking); return `<button class="room ${status}" data-action="stay" data-id="${booking.id}"><div class="room-top"><span class="room-no">${esc(currentRoom(booking))}</span>${ico('arrow')}</div><div class="room-name">${esc(guestName(booking))}</div><div class="room-status">${esc(statusText(booking))} · out ${esc(booking.end.slice(11, 16))}</div></button>`; }).join('')}</div>`;
}

function departureList(bookings) {
  if (!bookings.length) return '<div class="empty">No departures scheduled for today.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>Guest</th><th>Room</th><th>Out</th></tr></thead><tbody>${bookings.sort((a, b) => a.end.localeCompare(b.end)).map((booking) => `<tr><td><button class="guest-name" data-action="stay" data-id="${booking.id}">${esc(guestName(booking))}<small>${esc(booking.guestSnapshot?.idNumber || guest(db, booking)?.idNumber || '')}</small></button></td><td><span class="room-label">${esc(currentRoom(booking) || `${booking.type === 'one' ? '1 bed' : '2 beds'} · unassigned`)}</span></td><td>${esc(booking.end.slice(11, 16))}</td></tr>`).join('')}</tbody></table></div>`;
}

function roomBoardPage() {
  return `<div class="content"><div class="page-head"><div><div class="eyebrow">Live room board</div><h1>Current stay rooms</h1><p class="subtitle">Type a room number when you check someone in. There is no preloaded room list.</p></div><div class="actions">${btn(`${ico('plus')} Register guest`, 'register', '', true)}</div></div><section class="panel">${roomCards()}</section></div>`;
}

function reservationsPage() {
  const items = reservations();
  return `<div class="content"><div class="page-head"><div><div class="eyebrow">Plan ahead</div><h1>Reservations</h1><p class="subtitle">Reserve a 1-bed or 2-bed stay and assign a room now or at arrival.</p></div><div class="actions">${btn(`${ico('plus')} New reservation`, 'reserve', '', true)}</div></div><section class="panel">${items.length ? `<div class="table-wrap"><table><thead><tr><th>Guest</th><th>Room / type</th><th>Check in</th><th>Check out</th><th>Paid</th><th></th></tr></thead><tbody>${items.map((booking) => `<tr><td><button class="guest-name" data-action="stay" data-id="${booking.id}">${esc(guestName(booking))}<small>${esc(booking.guestSnapshot?.idNumber || '')}</small></button></td><td><span class="room-label">${esc(currentRoom(booking) || `${booking.type === 'one' ? '1 bed' : '2 beds'} · unassigned`)}</span></td><td>${fmtDateTime(booking.start)}</td><td>${fmtDateTime(booking.end)}</td><td>${money(ledger(db, booking.id).paid)}</td><td>${btn('Open', 'stay', booking.id)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No future reservations yet.</div>'}</section></div>`;
}

function historyPage() {
  const query = historySearch.trim().toLowerCase();
  const people = db.guests.filter((person) => !query || [person.name, person.idNumber, person.phone].some((value) => String(value || '').toLowerCase().includes(query))).sort((a, b) => a.name.localeCompare(b.name));
  const rooms = allRooms().filter((room) => !query || room.toLowerCase().includes(query));
  return `<div class="content"><div class="page-head"><div><div class="eyebrow">Search the register</div><h1>Guest and room history</h1><p class="subtitle">Find a person by name or ID, or enter a room number to see every stay.</p></div><div class="actions">${btn(`${ico('plus')} Register guest`, 'register', '', true)}</div></div><section class="panel"><form id="history-search" class="filters"><div class="field search"><label for="history-query">Search guests or rooms</label><input id="history-query" name="query" value="${esc(historySearch)}" placeholder="Name, ID number or room number"></div><button class="btn primary" type="submit">${ico('search')} Search</button></form></section><div class="columns"><section class="panel"><div class="panel-head"><div><h2>Guests</h2><small>${people.length} matching record${people.length === 1 ? '' : 's'}</small></div></div>${people.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>ID number</th><th>Stays</th></tr></thead><tbody>${people.map((person) => `<tr><td><button class="guest-name" data-action="guest" data-id="${person.id}">${esc(person.name)}<small>${esc(person.phone || 'No phone')}</small></button></td><td>${esc(person.idNumber)}</td><td>${db.bookings.filter((booking) => booking.guest === person.id).length}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No guest records match.</div>'}</section><section class="panel"><div class="panel-head"><div><h2>Rooms</h2><small>Room history from the register</small></div></div>${rooms.length ? `<div class="table-wrap"><table><thead><tr><th>Room</th><th>Stays</th><th></th></tr></thead><tbody>${rooms.map((room) => `<tr><td><span class="room-label">${esc(room)}</span></td><td>${db.bookings.filter((booking) => (booking.segments?.some((segment) => segment.room === room) || (!booking.segments?.length && booking.room === room))).length}</td><td>${btn('Open', 'room-history', room)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Room history appears after the first check-in.</div>'}</section></div></div>`;
}

function cashPage() {
  const summary = cashSummary(db, cashDate);
  return `<div class="content"><div class="page-head"><div><div class="eyebrow">Cash register</div><h1>Cash collected</h1><p class="subtitle">Room payments and security deposits recorded for one day.</p></div><div class="actions">${btn(`${ico('plus')} Register guest`, 'register', '', true)}</div></div><section class="panel"><div class="filters"><div class="field"><label for="cash-date">Date</label><input id="cash-date" type="date" value="${esc(cashDate)}"></div></div><div class="stats" style="padding:0 20px 20px;margin-bottom:0"><div class="stat"><div class="stat-top"><span>Total collected</span><span class="stat-icon">${ico('cash')}</span></div><div class="stat-value">${money(summary.gross)}</div><div class="stat-foot">Room payments + deposits</div></div><div class="stat"><div class="stat-top"><span>Cash returned</span><span class="stat-icon">${ico('out')}</span></div><div class="stat-value">${money(summary.returned)}</div><div class="stat-foot">Refunds and returned deposits</div></div><div class="stat"><div class="stat-top"><span>Net cash</span><span class="stat-icon">${ico('check')}</span></div><div class="stat-value">${money(summary.net)}</div><div class="stat-foot">After cash returned</div></div></div></section><section class="panel"><div class="panel-head"><div><h2>Cash entries</h2><small>${summary.transactions.length} entries on ${fmtDate(cashDate)}</small></div></div>${summary.transactions.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Guest</th><th>Room</th><th>Entry</th><th>Amount</th></tr></thead><tbody>${summary.transactions.slice().sort((a, b) => b.at.localeCompare(a.at)).map((transaction) => { const booking = db.bookings.find((item) => item.id === transaction.booking); return `<tr><td>${esc(transaction.at.slice(11, 16))}</td><td>${booking ? esc(guestName(booking)) : '—'}</td><td>${esc(transaction.room || '—')}</td><td>${esc(labelKind(transaction.kind))}</td><td class="money ${['refund', 'deposit-return'].includes(transaction.kind) ? 'negative' : ''}">${['refund', 'deposit-return'].includes(transaction.kind) ? '−' : ''}${money(transaction.amount)}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No cash entries for this date.</div>'}</section></div>`;
}

function stayHeader(booking) {
  const person = guest(db, booking) || booking.guestSnapshot || {};
  const status = currentStatus(booking);
  return `<div class="detail-grid"><div><small>Guest</small><strong>${esc(person.name || '—')}</strong></div><div><small>ID number</small><strong>${esc(person.idNumber || '—')}</strong></div><div><small>Status</small>${badge(statusText(booking), statusClass(status))}</div><div><small>Room</small><strong>${esc(currentRoom(booking) || 'Not assigned')}</strong></div><div><small>Check in</small><strong>${fmtDateTime(booking.actualIn || booking.start)}</strong></div><div><small>Check out</small><strong>${fmtDateTime(booking.actualOut || booking.end)}</strong></div></div>`;
}

function showStay(id) {
  const booking = db.bookings.find((item) => item.id === id);
  if (!booking) return;
  const person = guest(db, booking) || booking.guestSnapshot || {};
  const bookLedger = ledger(db, id);
  const actions = [];
  if (booking.status === 'reserved') { actions.push(btn('Check in guest', 'check-in', id, true), btn('Cancel reservation', 'cancel', id)); }
  if (booking.status === 'in-house') { actions.push(btn('Record cash', 'collect', id, true), btn('Change room', 'transfer', id), btn('Extend stay', 'extend', id), btn('Edit nightly rates', 'rates', id), btn('Check out', 'checkout', id)); }
  if (booking.status !== 'reserved' && booking.status !== 'cancelled') actions.push(btn('Add note', 'note', id));
  modal(`${esc(person.name || 'Guest')} · ${esc(booking.reference)}`, `${stayHeader(booking)}<div class="actions" style="margin:4px 0 22px">${actions.join('')}</div><div class="form-section">Stay total</div><div class="form-total"><div class="total-line"><span>Room and other charges</span><strong>${money(total(booking))}</strong></div><div class="total-line"><span>Cash received</span><strong>${money(bookLedger.paid)}</strong></div><div class="total-line"><span>Security deposit held</span><strong>${money(bookLedger.deposit)}</strong></div><div class="total-line large"><span>Balance</span><strong class="${balance(db, booking) > 0 ? 'negative' : ''}">${money(balance(db, booking))}</strong></div></div><div class="form-section">Nightly rates</div><div>${booking.rates.map((rate) => `<div class="rate-row"><span>${fmtShortDate(rate.date)}</span><strong>${money(rate.amount)}</strong></div>`).join('')}</div>${booking.notes ? `<div class="form-section">Notes</div><p class="detail-notes">${esc(booking.notes)}</p>` : ''}<div class="form-section">Cash history</div>${booking.transactions?.length ? '' : ''}${cashRows(booking)}`);
}

function cashRows(booking) {
  const entries = db.transactions.filter((transaction) => transaction.booking === booking.id && !transaction.void).sort((a, b) => b.at.localeCompare(a.at));
  if (!entries.length) return '<div class="empty">No cash recorded yet.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Entry</th><th>Amount</th></tr></thead><tbody>${entries.map((entry) => `<tr><td>${fmtDateTime(entry.at)}</td><td>${esc(labelKind(entry.kind))}</td><td class="money">${money(entry.amount)}</td></tr>`).join('')}</tbody></table></div>`;
}

function showGuest(id) {
  const person = db.guests.find((item) => item.id === id);
  if (!person) return;
  const stays = db.bookings.filter((booking) => booking.guest === id).sort((a, b) => b.start.localeCompare(a.start));
  modal(`${esc(person.name)} · Guest history`, `<div class="detail-grid"><div><small>ID type</small><strong>${esc(person.idType || '—')}</strong></div><div><small>ID number</small><strong>${esc(person.idNumber || '—')}</strong></div><div><small>Phone</small><strong>${esc(person.phone || '—')}</strong></div><div><small>Address</small><strong>${esc(person.address || '—')}</strong></div></div><div class="form-section">Every stay</div>${stays.length ? `<div class="table-wrap"><table><thead><tr><th>Dates</th><th>Room</th><th>Status</th><th>Total</th></tr></thead><tbody>${stays.map((booking) => `<tr><td><button class="guest-name" data-action="stay" data-id="${booking.id}">${fmtShortDate(booking.start)} – ${fmtShortDate(booking.end)}</button></td><td>${esc(currentRoom(booking))}</td><td>${badge(labelStatus(booking.status), statusClass(booking.status))}</td><td>${money(total(booking))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No stays recorded.</div>'}`);
}

function showRoomHistory(room) {
  const stays = db.bookings.filter((booking) => booking.segments?.some((segment) => segment.room === room) || (!booking.segments?.length && booking.room === room)).sort((a, b) => b.start.localeCompare(a.start));
  modal(`Room ${esc(room)} · History`, `<p class="subtitle">Every guest recorded in this room, including previous room moves.</p><div class="form-section">Stays</div>${stays.length ? `<div class="table-wrap"><table><thead><tr><th>Guest</th><th>Stayed</th><th>Status</th><th></th></tr></thead><tbody>${stays.map((booking) => `<tr><td>${esc(guestName(booking))}<small>${esc(booking.guestSnapshot?.idNumber || '')}</small></td><td>${fmtShortDate(booking.start)} – ${fmtShortDate(booking.end)}</td><td>${badge(labelStatus(booking.status), statusClass(booking.status))}</td><td>${btn('Open', 'stay', booking.id)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No stays recorded in this room.</div>'}`);
}

function registerForm(reserve = false) {
  const start = reserve ? `${plusDay(today(), 1)}T15:00` : nowLocal();
  const end = `${plusDay(start.slice(0, 10), 1)}T11:00`;
  formContext = { reserve };
  modal(reserve ? 'New reservation' : 'Register guest', `<form id="register-form" data-reserve="${reserve ? 'true' : 'false'}"><div class="form-section">1 · Person details</div><div class="split">${field('Full name', 'name', 'text', '', 'required autocomplete="name"')}${select('ID type', 'idType', [['passport', 'Passport'], ['national-id', 'National ID'], ['driver-license', 'Driver license'], ['other', 'Other']], 'national-id')}${field('ID number', 'idNumber', 'text', '', 'required')}${field('Phone (optional)', 'phone', 'tel', '', 'autocomplete="tel"')}</div>${field('Address (optional)', 'address') }<div class="form-section">2 · Stay details</div><div class="split">${field('Check-in date and time', 'start', 'datetime-local', start, 'required')}${field('Checkout date and time', 'end', 'datetime-local', end, 'required')}</div>${reserve ? select('Bed type', 'type', [['one', '1 bed'], ['two', '2 beds']], 'one') : ''}<div class="split">${select('Pricing', 'pricing', [['same', 'Same rate for every night'], ['nightly', 'Different rate by night']], 'same')}${field('Rate per night', 'baseRate', 'number', '100.00', 'required min="0" step="0.01" inputmode="decimal"')}</div><div id="rate-list"></div><div id="register-rate-summary" class="notice"></div><div class="split">${field('Other charges (optional)', 'fees', 'number', '0.00', 'min="0" step="0.01" inputmode="decimal"')}${field(reserve ? 'Cash paid now (optional)' : 'Cash received now', 'paid', 'number', '0.00', 'min="0" step="0.01" inputmode="decimal"')}</div>${field('Security deposit (optional)', 'deposit', 'number', '0.00', 'min="0" step="0.01" inputmode="decimal"')}<div class="form-total"><div class="total-line"><span>Total stay charges</span><strong id="register-total">$0.00</strong></div><div class="total-line"><span>Balance after cash received</span><strong id="register-balance">$0.00</strong></div></div><div class="form-section">3 · Assign room</div>${field(`Room number${reserve ? ' (optional)' : ''}`, 'room', 'text', '', `${reserve ? '' : 'required '}inputmode="numeric"`)}<p class="hint">${reserve ? 'Leave room blank to assign it when the guest arrives.' : 'Type any room number. It will appear on the room board after check-in.'} The system prevents overlapping stays in the same room.</p>${field('Notes (optional)', 'notes', 'text', '')}${footer(reserve ? 'Save reservation' : 'Check in guest')}</form>`);
  updateRegisterForm();
}

function checkInForm(id) {
  const booking = db.bookings.find((item) => item.id === id);
  if (!booking) return;
  modal('Check in reservation', `<form id="checkin-form" data-id="${esc(id)}"><div class="notice">${esc(guestName(booking))} is reserved for ${fmtDate(booking.start)}. Assign a room number now.</div>${field('Room number', 'room', 'text', currentRoom(booking), 'required inputmode="numeric"')}<p class="hint">The room becomes part of the live room board when you confirm check-in.</p>${footer('Check in guest')}</form>`);
}

function updateRegisterForm() {
  const form = $('#register-form');
  if (!form) return;
  const oldValues = Object.fromEntries([...form.querySelectorAll('[data-rate-date]')].map((input) => [input.dataset.rateDate, input.value]));
  const start = form.elements.start.value;
  const end = form.elements.end.value;
  const list = $('#rate-list');
  try {
    const dates = nights(start, end);
    if (form.elements.pricing.value === 'nightly') {
      list.innerHTML = `<div class="form-section">Nightly prices</div>${dates.map((date) => `<div class="rate-row"><label for="rate-${date}">${fmtShortDate(date)} night</label><input id="rate-${date}" data-rate-date="${date}" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(oldValues[date] ?? form.elements.baseRate.value ?? '100.00')}" required></div>`).join('')}`;
    } else list.innerHTML = '';
    updateRegisterTotal();
  } catch (error) {
    list.innerHTML = `<p class="hint">${esc(error.message)}</p>`;
    $('#register-rate-summary').textContent = 'Enter a valid checkout after check-in.';
    $('#register-total').textContent = '$0.00';
    $('#register-balance').textContent = '$0.00';
  }
}

function registerRates(form) {
  const dates = nights(form.elements.start.value, form.elements.end.value);
  if (form.elements.pricing.value === 'same') {
    const rate = amount(form.elements.baseRate.value);
    return dates.map((date) => ({ date, amount: rate }));
  }
  return dates.map((date) => ({ date, amount: amount(form.querySelector(`[data-rate-date="${date}"]`)?.value) }));
}

function updateRegisterTotal() {
  const form = $('#register-form');
  if (!form) return;
  try {
    const rates = registerRates(form);
    const fees = amount(form.elements.fees.value);
    const paid = amount(form.elements.paid.value);
    const charge = rates.reduce((sum, rate) => sum + rate.amount, 0) + fees;
    $('#register-rate-summary').textContent = `${rates.length} night${rates.length === 1 ? '' : 's'} · ${form.elements.pricing.value === 'same' ? money(rates[0]?.amount || 0) + ' each night' : 'nightly rates entered'}`;
    $('#register-total').textContent = money(charge);
    $('#register-balance').textContent = money(charge - paid);
  } catch {
    $('#register-rate-summary').textContent = 'Enter valid nightly prices.';
  }
}

function actionForm(action, id) {
  const booking = db.bookings.find((item) => item.id === id);
  if (!booking) return;
  let title = 'Update stay';
  let body = '';
  let submit = 'Save';
  if (action === 'collect') {
    title = 'Record cash'; submit = 'Record cash';
    body = `${select('Cash entry', 'kind', [['payment', 'Room payment'], ['deposit', 'Security deposit'], ['refund', 'Room refund'], ['deposit-return', 'Return security deposit'], ['deposit-retained', 'Retain security deposit']], 'payment')}${field('Amount', 'amount', 'number', '', 'required min="0.01" step="0.01" inputmode="decimal"')}${field('Reason or note', 'note', 'text', '', 'required')}`;
  } else if (action === 'transfer') {
    title = 'Change room'; submit = 'Move guest';
    body = `<div class="notice">The current room is <strong>${esc(currentRoom(booking))}</strong>. Room history will keep both room numbers.</div>${field('New room number', 'room', 'text', '', 'required inputmode="numeric"')}${field('Reason for move', 'reason', 'text', '', 'required')}`;
  } else if (action === 'extend') {
    title = 'Extend stay'; submit = 'Extend stay';
    const dates = nights(booking.start, booking.end);
    body = `${field('New checkout date and time', 'end', 'datetime-local', booking.end, 'required')}${field('Cash received for extension', 'paid', 'number', '0.00', 'min="0" step="0.01" inputmode="decimal"')}<div class="form-section">New nightly prices</div><div id="action-rates">${dates.map((date) => `<div class="rate-row"><label>${fmtShortDate(date)} night</label><input type="number" value="${(booking.rates.find((rate) => rate.date === date)?.amount || 0) / 100}" disabled></div>`).join('')}</div><p class="hint">Existing nights stay at their saved prices. Enter prices only for added nights.</p>`;
  } else if (action === 'rates') {
    title = 'Edit nightly rates'; submit = 'Save rates';
    body = `<div id="action-rates">${booking.rates.map((rate) => `<div class="rate-row"><label for="rate-${rate.date}">${fmtShortDate(rate.date)} night</label><input id="rate-${rate.date}" data-rate-date="${rate.date}" type="number" min="0" step="0.01" value="${(rate.amount / 100).toFixed(2)}" required></div>`).join('')}</div>${field('Reason for change', 'reason', 'text', '', 'required')}`;
  } else if (action === 'checkout') {
    title = 'Check out guest'; submit = 'Complete checkout';
    body = `<div class="notice">Balance due: <strong>${money(Math.max(balance(db, booking), 0))}</strong> · Deposit held: <strong>${money(ledger(db, booking.id).deposit)}</strong></div><label class="check"><input type="checkbox" name="ackBalance" ${balance(db, booking) <= 0 ? 'checked' : ''}> I have collected or acknowledged any remaining room balance.</label><label class="check"><input type="checkbox" name="ackDeposit" ${ledger(db, booking.id).deposit === 0 ? 'checked' : ''}> I have returned, retained, or acknowledged the security deposit.</label>`;
  } else {
    title = 'Add a stay note'; submit = 'Add note'; body = `<div class="field"><label for="f-note">Note</label><textarea id="f-note" name="note" required></textarea></div>`;
  }
  modal(title, `<form id="action-form" data-command="${action}" data-id="${id}">${body}${footer(submit)}</form>`);
  if (action === 'extend') updateExtendRates();
}

function updateExtendRates() {
  const form = $('#action-form');
  if (!form || form.dataset.command !== 'extend') return;
  const booking = db.bookings.find((item) => item.id === form.dataset.id);
  const old = Object.fromEntries([...form.querySelectorAll('[data-rate-date]')].map((input) => [input.dataset.rateDate, input.value]));
  try {
    const dates = nights(booking.start, form.elements.end.value);
    const added = dates.filter((date) => !booking.rates.some((rate) => rate.date === date));
    $('#action-rates').innerHTML = `${booking.rates.map((rate) => `<div class="rate-row"><label>${fmtShortDate(rate.date)} night</label><input type="number" value="${(rate.amount / 100).toFixed(2)}" disabled></div>`).join('')}${added.map((date) => `<div class="rate-row"><label for="rate-${date}">${fmtShortDate(date)} night</label><input id="rate-${date}" data-rate-date="${date}" type="number" min="0" step="0.01" value="${esc(old[date] ?? '100.00')}" required></div>`).join('')}`;
  } catch { $('#action-rates').innerHTML = '<p class="hint">Choose a later checkout date.</p>'; }
}

function resetDemo() {
  if (mode !== 'demo') return;
  db = seed();
  localStorage.setItem(key, JSON.stringify(db));
  toast('Demo data cleared.');
  render();
}

document.addEventListener('click', async (event) => {
  const pageButton = event.target.closest('[data-page]');
  if (pageButton) {
    page = pageButton.dataset.page;
    closeModal();
    render();
    window.scrollTo(0, 0);
    return;
  }
  const element = event.target.closest('[data-action]');
  if (!element) return;
  const action = element.dataset.action;
  const id = element.dataset.id;
  try {
    if (action === 'close') { closeModal(); return; }
    if (action === 'demo-login') { actor = 'boss'; sessionStorage.setItem('staydesk-user', 'boss'); if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(db)); render(); return; }
    if (action === 'logout') { if (mode === 'server') await api('logout', {}); else sessionStorage.removeItem('staydesk-user'); actor = null; closeModal(); render(); return; }
    if (action === 'register') { registerForm(false); return; }
    if (action === 'reserve') { registerForm(true); return; }
    if (action === 'page') { page = id; closeModal(); render(); return; }
    if (action === 'stay') { showStay(id); return; }
    if (action === 'guest') { showGuest(id); return; }
    if (action === 'room-history') { showRoomHistory(id); return; }
    if (['collect', 'transfer', 'extend', 'checkout', 'rates', 'note'].includes(action)) { actionForm(action, id); return; }
    if (action === 'check-in') { checkInForm(id); return; }
    if (action === 'cancel') { await command('cancel', { id }); closeModal(); render(); toast('Reservation cancelled.'); return; }
    if (action === 'reset-demo') { resetDemo(); return; }
  } catch (error) {
    const errorElement = $('#modal .form-error');
    if (errorElement) errorElement.textContent = error.message;
    else toast(error.message);
  }
});

document.addEventListener('change', (event) => {
  const form = event.target.closest('form');
  if (form?.id === 'register-form' && ['start', 'end', 'pricing', 'baseRate'].includes(event.target.name)) updateRegisterForm();
  if (form?.id === 'action-form' && form.dataset.command === 'extend' && event.target.name === 'end') updateExtendRates();
  if (event.target.id === 'cash-date') { cashDate = event.target.value || today(); render(); }
});

document.addEventListener('input', (event) => {
  if (event.target.closest('#register-form')) updateRegisterTotal();
});

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const values = formValues(form);
  const errorElement = form.querySelector('.form-error');
  const submit = form.querySelector('[type="submit"]');
  if (errorElement) errorElement.textContent = '';
  if (submit) submit.disabled = true;
  try {
    if (form.id === 'login-form') { await api('login', values); await load(); render(); return; }
    if (form.id === 'history-search') { historySearch = values.query || ''; render(); return; }
    if (form.id === 'register-form') {
      const rates = registerRates(form);
      const id = await command('create', {
        status: form.dataset.reserve === 'true' ? 'reserved' : 'in-house', type: values.type, name: values.name, idType: values.idType,
        idNumber: values.idNumber, phone: values.phone, address: values.address, room: values.room,
        start: values.start, end: values.end, rates, fees: amount(values.fees), paid: amount(values.paid), deposit: amount(values.deposit), notes: values.notes,
      });
      closeModal(); page = form.dataset.reserve === 'true' ? 'reservations' : 'home'; render(); showStay(id); toast(form.dataset.reserve === 'true' ? 'Reservation saved.' : 'Guest checked in.'); return;
    }
    if (form.id === 'checkin-form') {
      const id = form.dataset.id;
      await command('check-in', { id, room: values.room });
      closeModal(); page = 'home'; render(); showStay(id); toast('Guest checked in.'); return;
    }
    if (form.id === 'action-form') {
      const commandName = form.dataset.command;
      const id = form.dataset.id;
      const payload = { id, ...values };
      if (commandName === 'collect') payload.amount = amount(values.amount);
      if (commandName === 'extend') {
        const booking = db.bookings.find((item) => item.id === id);
        const dates = nights(booking.start, values.end);
        payload.rates = [...booking.rates, ...dates.filter((date) => !booking.rates.some((rate) => rate.date === date)).map((date) => ({ date, amount: amount(form.querySelector(`[data-rate-date="${date}"]`)?.value) }))];
        payload.paid = amount(values.paid);
      }
      if (commandName === 'rates') {
        payload.rates = bookingRatesFromForm(form, nights(db.bookings.find((item) => item.id === id).start, db.bookings.find((item) => item.id === id).end));
      }
      if (commandName === 'checkout') { payload.ackBalance = values.ackBalance === 'on'; payload.ackDeposit = values.ackDeposit === 'on'; }
      await command(commandName, payload);
      closeModal(); render(); showStay(id); toast('Stay updated.'); return;
    }
  } catch (error) {
    if (errorElement) errorElement.textContent = error.message;
    else toast(error.message);
  } finally { if (submit) submit.disabled = false; }
});

function bookingRatesFromForm(form, dates) {
  return dates.map((date) => ({ date, amount: amount(form.querySelector(`[data-rate-date="${date}"]`)?.value) }));
}

window.addEventListener('storage', (event) => {
  if (mode === 'demo' && event.key === key && event.newValue && !$('#modal').open) { db = JSON.parse(event.newValue); render(); }
});

setInterval(async () => {
  if (!actor || $('#modal').open) return;
  if (mode === 'server') { try { await load(); render(); } catch { /* keep the last good view */ } }
  else render();
}, 60000);

start();
