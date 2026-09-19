// Staydesk business rules. Store every amount as integer cents.
export const TZ = 'America/Los_Angeles';

export function nowLocal() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export const today = () => nowLocal().slice(0, 10);

export function plusDay(day, count) {
  const date = new Date(`${day.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(date.getTime())
    && date.toISOString().slice(0, 10) === value.slice(0, 10)
    && Number(value.slice(11, 13)) <= 23
    && Number(value.slice(14, 16)) <= 59;
}

export function nights(start, end) {
  if (!validDate(start) || !validDate(end) || end <= start) {
    throw Error('Checkout must be after check-in.');
  }
  const result = [];
  let date = start.slice(0, 10);
  while (date < end.slice(0, 10)) {
    result.push(date);
    date = plusDay(date, 1);
    if (result.length > 366) throw Error('Maximum stay is 366 nights.');
  }
  return result.length ? result : [start.slice(0, 10)];
}

export const uid = () => crypto.randomUUID();
const requireValue = (condition, message) => { if (!condition) throw Error(message); };
const clean = (value, max = 200) => String(value || '').trim().slice(0, max);

function integerCents(value) {
  requireValue(Number.isSafeInteger(value) && value >= 0 && value <= 100000000,
    'Enter a valid amount in cents.');
  return value;
}

export function currentRoom(booking) {
  return booking?.segments?.at(-1)?.room || booking?.room || '';
}

export function total(booking) {
  return booking.rates.reduce((sum, rate) => sum + rate.amount, 0)
    + (booking.fees || 0)
    + (booking.adjustments || []).reduce((sum, adjustment) => sum + adjustment.amount, 0);
}

export function ledger(db, bookingId) {
  const transactions = db.transactions.filter((transaction) => (
    transaction.booking === bookingId && !transaction.void
  ));
  const sum = (kind) => transactions
    .filter((transaction) => transaction.kind === kind)
    .reduce((value, transaction) => value + transaction.amount, 0);
  return {
    paid: sum('payment') - sum('refund'),
    deposit: sum('deposit') - sum('deposit-return') - sum('deposit-retained'),
    refunded: sum('refund'),
  };
}

export const balance = (db, booking) => total(booking) - ledger(db, booking.id).paid;
export const guest = (db, booking) => db.guests.find((person) => person.id === booking.guest);

function overlaps(firstStart, firstEnd, secondStart, secondEnd) {
  return firstStart < secondEnd && secondStart < firstEnd;
}

function bookingSegments(booking) {
  if (booking.segments?.length) {
    return booking.segments.map((segment) => [
      segment.room,
      segment.start,
      segment.end || booking.end,
    ]);
  }
  return [[booking.room, booking.start, booking.end]];
}

// Rooms are created by typing a room number at check-in. There is no inventory
// list to maintain; a number is unavailable only when an active stay occupies it.
export function roomAvailable(db, roomNumber, start, end, excludeId = '') {
  const room = clean(roomNumber, 40);
  if (!room || !validDate(start) || !validDate(end) || end <= start) return false;
  return !db.bookings.some((booking) => {
    if (booking.id === excludeId || !['reserved', 'in-house'].includes(booking.status)) return false;
    return bookingSegments(booking).some(([segmentRoom, segmentStart, segmentEnd]) => (
      segmentRoom === room && overlaps(start, end, segmentStart, segmentEnd)
    ));
  });
}

export const typeAvailable = () => true;

export function category(db, booking, at = nowLocal()) {
  if (booking.status !== 'in-house') return booking.status;
  if (booking.end.slice(0, 10) <= at.slice(0, 10)) return 'departures';
  const incurred = booking.rates
    .filter((rate) => rate.date <= at.slice(0, 10))
    .reduce((sum, rate) => sum + rate.amount, 0) + (booking.fees || 0);
  return ledger(db, booking.id).paid >= Math.min(total(booking), incurred)
    ? 'stayovers'
    : 'payment-due';
}

export function cashSummary(db, from, to = from) {
  const transactions = db.transactions.filter((transaction) => (
    !transaction.void
    && transaction.at.slice(0, 10) >= from
    && transaction.at.slice(0, 10) <= to
  ));
  const sum = (kind) => transactions
    .filter((transaction) => transaction.kind === kind)
    .reduce((value, transaction) => value + transaction.amount, 0);
  const room = sum('payment');
  const deposits = sum('deposit');
  const returned = sum('refund') + sum('deposit-return');
  return { room, deposits, gross: room + deposits, returned, net: room + deposits - returned, transactions };
}

function validateRates(rates, start, end) {
  const dates = nights(start, end);
  requireValue(Array.isArray(rates) && rates.length === dates.length, 'Enter a price for every night.');
  return dates.map((date, index) => {
    requireValue(rates[index]?.date === date, 'Nightly dates do not match the stay.');
    return { date, amount: integerCents(rates[index].amount) };
  });
}

function transaction(db, booking, kind, amount, user, at, note = '', original = '') {
  if (!amount) return;
  db.transactions.push({
    id: uid(), booking: booking.id, room: currentRoom(booking), kind,
    amount: integerCents(amount), user, at, note: clean(note, 1000), original, void: false,
  });
}

function audit(db, user, action, booking, at, detail) {
  db.activity.push({ id: uid(), user, action, booking, at, detail: clean(detail, 2000) });
}

export function applyCommand(state, actor, command, payload = {}, at = nowLocal()) {
  const db = structuredClone(state);
  requireValue(db.staff.some((staff) => staff.id === actor && staff.active), 'Sign in with the Boss account.');
  let booking = payload.id ? db.bookings.find((item) => item.id === payload.id) : null;
  let detail = '';

  if (command === 'create') {
    requireValue(['in-house', 'reserved'].includes(payload.status), 'Choose an active stay or future reservation.');
    requireValue(clean(payload.name), 'Guest name is required.');
    requireValue(clean(payload.idNumber), 'ID number is required.');
    requireValue(clean(payload.room, 40), 'Room number is required.');
    requireValue(validDate(payload.start) && validDate(payload.end), 'Enter valid check-in and checkout dates.');
    requireValue(payload.end > payload.start, 'Checkout must be after check-in.');
    requireValue(roomAvailable(db, payload.room, payload.start, payload.end), 'That room is already occupied for these dates.');
    const rates = validateRates(payload.rates, payload.start, payload.end);
    const person = {
      id: uid(), name: clean(payload.name), idType: clean(payload.idType),
      idNumber: clean(payload.idNumber), phone: clean(payload.phone), address: clean(payload.address),
    };
    booking = {
      id: uid(), reference: `MD-${String(db.bookings.length + 1001)}`, guest: person.id,
      guestSnapshot: structuredClone(person), type: 'room', room: clean(payload.room, 40),
      start: payload.start, end: payload.end, actualIn: payload.start, actualOut: null,
      status: payload.status, rates, fees: integerCents(payload.fees || 0), adjustments: [],
      notes: clean(payload.notes, 2000), createdBy: actor, assignedBy: actor,
      segments: [{ room: clean(payload.room, 40), start: payload.start, end: null }],
    };
    db.guests.push(person);
    db.bookings.push(booking);
    transaction(db, booking, 'payment', payload.paid || 0, actor, at);
    transaction(db, booking, 'deposit', payload.deposit || 0, actor, at);
    detail = `${booking.reference} · Room ${booking.room}`;
  } else {
    requireValue(booking, 'Stay not found.');
    if (command === 'check-in') {
      requireValue(booking.status === 'reserved', 'Only a future reservation can be checked in.');
      booking.status = 'in-house';
      booking.actualIn = at;
      detail = `Checked in to Room ${currentRoom(booking)}`;
    } else if (command === 'cancel') {
      requireValue(booking.status === 'reserved', 'Only a future reservation can be cancelled.');
      booking.status = 'cancelled';
      detail = 'Reservation cancelled.';
    } else if (command === 'collect') {
      requireValue(['payment', 'deposit', 'refund', 'deposit-return', 'deposit-retained'].includes(payload.kind), 'Invalid cash entry.');
      requireValue(payload.amount > 0, 'Amount must be greater than zero.');
      integerCents(payload.amount);
      if (['deposit-return', 'deposit-retained'].includes(payload.kind)) {
        requireValue(payload.amount <= ledger(db, booking.id).deposit, 'Amount exceeds the deposit held.');
      }
      if (payload.kind === 'refund') requireValue(payload.amount <= ledger(db, booking.id).paid, 'Refund exceeds room cash received.');
      if (['refund', 'deposit-return', 'deposit-retained'].includes(payload.kind)) requireValue(clean(payload.note), 'Enter a reason.');
      transaction(db, booking, payload.kind, payload.amount, actor, at, payload.note, payload.original || '');
      detail = `${payload.kind}: ${(payload.amount / 100).toFixed(2)} · ${payload.note || ''}`;
    } else if (command === 'transfer') {
      requireValue(booking.status === 'in-house', 'Only an active stay can change rooms.');
      requireValue(clean(payload.room, 40) && clean(payload.room, 40) !== currentRoom(booking), 'Enter a different room number.');
      requireValue(clean(payload.reason), 'Enter the transfer reason.');
      requireValue(roomAvailable(db, payload.room, at, booking.end, booking.id), 'That room is already occupied.');
      const oldRoom = currentRoom(booking);
      booking.segments.at(-1).end = at;
      booking.segments.push({ room: clean(payload.room, 40), start: at, end: null });
      booking.room = clean(payload.room, 40);
      detail = `${oldRoom} → ${booking.room} · ${payload.reason}`;
    } else if (command === 'extend') {
      requireValue(booking.status === 'in-house', 'This stay is closed.');
      requireValue(payload.end > booking.end, 'New checkout must be later than the current checkout.');
      requireValue(roomAvailable(db, currentRoom(booking), booking.start, payload.end, booking.id), 'That room is reserved during the extension.');
      const nextRates = validateRates(payload.rates, booking.start, payload.end);
      for (const oldRate of booking.rates) {
        requireValue(nextRates.find((rate) => rate.date === oldRate.date)?.amount === oldRate.amount, 'Existing nightly rates must be preserved.');
      }
      booking.end = payload.end;
      booking.rates = nextRates;
      transaction(db, booking, 'payment', payload.paid || 0, actor, at);
      detail = `Checkout extended to ${payload.end}`;
    } else if (command === 'checkout') {
      requireValue(booking.status === 'in-house', 'Guest is not checked in.');
      requireValue(balance(db, booking) <= 0 || payload.ackBalance, 'Acknowledge the outstanding balance before checkout.');
      requireValue(ledger(db, booking.id).deposit === 0 || payload.ackDeposit, 'Resolve or acknowledge the held deposit before checkout.');
      booking.status = 'checked-out';
      booking.actualOut = at;
      booking.segments.at(-1).end = at;
      detail = 'Actual checkout recorded.';
    } else if (command === 'rates') {
      requireValue(clean(payload.reason), 'Enter the reason for changing prices.');
      const nextRates = validateRates(payload.rates, booking.start, booking.end);
      detail = `Nightly rates changed. ${payload.reason}`;
      booking.rates = nextRates;
    } else if (command === 'adjust') {
      requireValue(clean(payload.reason), 'Enter an adjustment reason.');
      requireValue(Number.isSafeInteger(payload.amount) && Math.abs(payload.amount) <= 100000000, 'Enter a valid adjustment.');
      requireValue(total(booking) + payload.amount >= 0, 'Charges cannot be negative.');
      booking.adjustments.push({ id: uid(), amount: payload.amount, reason: clean(payload.reason), user: actor, at });
      detail = `Charge adjustment ${(payload.amount / 100).toFixed(2)}: ${payload.reason}`;
    } else if (command === 'void') {
      const entry = db.transactions.find((item) => item.id === payload.transaction && item.booking === booking.id && !item.void);
      requireValue(entry, 'Select an active cash entry.');
      requireValue(clean(payload.reason), 'Enter a correction reason.');
      entry.void = true;
      entry.voidedBy = actor;
      entry.voidedAt = at;
      entry.voidReason = clean(payload.reason);
      requireValue(ledger(db, booking.id).paid >= 0 && ledger(db, booking.id).deposit >= 0, 'Correct related returns first.');
      detail = `Voided ${entry.kind} ${(entry.amount / 100).toFixed(2)}: ${payload.reason}`;
    } else if (command === 'note') {
      requireValue(clean(payload.note), 'Enter a note.');
      booking.notes += `${booking.notes ? '\n' : ''}${clean(payload.note, 2000)}`;
      detail = payload.note;
    } else {
      throw Error('Unknown action.');
    }
  }

  audit(db, actor, command, booking?.id || '', at, detail);
  db.revision = (db.revision || 0) + 1;
  return { db, id: booking?.id };
}

export function seed() {
  return {
    version: 2,
    revision: 0,
    rooms: [],
    staff: [{ id: 'boss', name: 'Boss', username: 'boss', active: true }],
    guests: [],
    bookings: [],
    transactions: [],
    activity: [],
  };
}
