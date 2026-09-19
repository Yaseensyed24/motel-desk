import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seed, applyCommand, total, ledger, cashSummary, roomAvailable, currentRoom,
  today, plusDay, nights, category,
} from '../public/domain.js';

const day = today();
const at = `${day}T16:00`;

function payload(extra = {}) {
  const start = `${day}T15:00`;
  const end = `${plusDay(day, 3)}T11:00`;
  return {
    status: 'in-house', name: 'Test Guest', idNumber: 'TEST-ID', idType: 'Passport',
    room: '101', start, end,
    rates: nights(start, end).map((date, index) => ({ date, amount: index === 1 ? 11000 : 10000 })),
    paid: 10000, deposit: 5000, ...extra,
  };
}

function create(state = seed(), extra = {}) {
  return applyCommand(state, 'boss', 'create', payload(extra), at);
}

test('seed starts with one Boss account and no room inventory', () => {
  const db = seed();
  assert.deepEqual(db.rooms, []);
  assert.deepEqual(db.staff.map(({ id, name, active }) => ({ id, name, active })), [{ id: 'boss', name: 'Boss', active: true }]);
});

test('variable nightly rates and deposits use exact cents', () => {
  const { db, id } = create();
  assert.equal(total(db.bookings[0]), 31000);
  assert.deepEqual(ledger(db, id), { paid: 10000, deposit: 5000, refunded: 0 });
  assert.deepEqual(cashSummary(db, day), { room: 10000, deposits: 5000, gross: 15000, returned: 0, net: 15000, transactions: db.transactions });
});

test('manual room numbers prevent overlapping stays, even when unpaid', () => {
  const { db } = create();
  assert.equal(roomAvailable(db, '101', `${day}T18:00`, `${plusDay(day, 1)}T11:00`), false);
  assert.throws(() => create(db, { paid: 0 }), /already occupied/);
  assert.equal(roomAvailable(db, '103', `${day}T18:00`, `${plusDay(day, 1)}T11:00`), true);
});

test('room transfers preserve one stay and room history', () => {
  const { db, id } = create();
  const result = applyCommand(db, 'boss', 'transfer', { id, room: '103', reason: 'Maintenance issue' }, at);
  const booking = result.db.bookings[0];
  assert.equal(result.db.bookings.length, 1);
  assert.equal(currentRoom(booking), '103');
  assert.equal(booking.segments[0].room, '101');
  assert.equal(booking.segments[0].end, at);
  assert.equal(booking.segments[1].room, '103');
  assert.equal(ledger(result.db, id).deposit, 5000);
});

test('extension preserves old rates and adds a new exact rate', () => {
  const { db, id } = create();
  const booking = db.bookings[0];
  const end = `${plusDay(day, 4)}T11:00`;
  const result = applyCommand(db, 'boss', 'extend', {
    id, end, rates: [...booking.rates, { date: plusDay(day, 3), amount: 12000 }], paid: 5000,
  }, at);
  assert.equal(total(result.db.bookings[0]), 43000);
  assert.equal(ledger(result.db, id).paid, 15000);
  assert.throws(() => applyCommand(db, 'boss', 'extend', {
    id, end, rates: [...booking.rates.map((rate) => ({ ...rate, amount: 1 })), { date: plusDay(day, 3), amount: 12000 }],
  }, at), /preserved/);
});

test('future reservation can be checked in or cancelled without preloaded rooms', () => {
  const reservation = create(seed(), { status: 'reserved', room: '205', paid: 5000, deposit: 0 });
  assert.equal(reservation.db.bookings[0].status, 'reserved');
  const checkedIn = applyCommand(reservation.db, 'boss', 'check-in', { id: reservation.id }, at);
  assert.equal(checkedIn.db.bookings[0].status, 'in-house');
  assert.equal(currentRoom(checkedIn.db.bookings[0]), '205');
  const cancelled = applyCommand(reservation.db, 'boss', 'cancel', { id: reservation.id }, at);
  assert.equal(cancelled.db.bookings[0].status, 'cancelled');
  assert.equal(ledger(cancelled.db, reservation.id).paid, 5000);
});

test('checkout preserves history and requires balance/deposit acknowledgement', () => {
  const { db, id } = create();
  assert.throws(() => applyCommand(db, 'boss', 'checkout', { id }, at), /outstanding/);
  const result = applyCommand(db, 'boss', 'checkout', { id, ackBalance: true, ackDeposit: true }, at);
  assert.equal(result.db.bookings[0].status, 'checked-out');
  assert.equal(result.db.bookings[0].actualOut, at);
  assert.equal(result.db.guests.length, 1);
  assert.equal(result.db.rooms.length, 0);
});

test('cash returns reduce net cash without changing gross receipts', () => {
  const { db, id } = create();
  const returned = applyCommand(db, 'boss', 'collect', { id, kind: 'deposit-return', amount: 2000, note: 'Returned at desk' }, at);
  assert.equal(cashSummary(returned.db, day).gross, 15000);
  assert.equal(cashSummary(returned.db, day).returned, 2000);
  assert.equal(cashSummary(returned.db, day).net, 13000);
  assert.throws(() => applyCommand(returned.db, 'boss', 'collect', { id, kind: 'deposit-return', amount: 4000, note: 'Too much' }, at), /exceeds/);
});

test('categories distinguish stayovers, payment due and departures', () => {
  const stay = create(seed(), { end: `${plusDay(day, 2)}T11:00`, rates: [{ date: day, amount: 10000 }, { date: plusDay(day, 1), amount: 10000 }], paid: 20000 });
  assert.equal(category(stay.db, stay.db.bookings[0], at), 'stayovers');
  const due = create(seed(), { end: `${plusDay(day, 2)}T11:00`, rates: [{ date: day, amount: 10000 }, { date: plusDay(day, 1), amount: 10000 }], paid: 0 });
  assert.equal(category(due.db, due.db.bookings[0], at), 'payment-due');
  const departure = create(seed(), { end: `${day}T18:00`, rates: [{ date: day, amount: 10000 }], paid: 10000 });
  assert.equal(category(departure.db, departure.db.bookings[0], at), 'departures');
});

test('invalid dates, fractional cents and inactive Boss are rejected', () => {
  assert.throws(() => create(seed(), { end: '2026-02-31T11:00' }), /valid|Checkout/);
  assert.throws(() => create(seed(), { paid: 1.5 }), /valid/);
  const db = seed(); db.staff[0].active = false;
  assert.throws(() => applyCommand(db, 'boss', 'create', payload(), at), /Boss account/);
});
