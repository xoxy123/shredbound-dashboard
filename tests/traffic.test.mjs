import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as online from '../src/online.js';

test('tabs: Feedback, Spelare, Försäljning, Budget, Mål and Healthy page', () => {
  const client = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8');
  const tabs = client.match(/const tabs=(\[.*?\]\]);/)[1];
  assert.deepEqual(JSON.parse(tabs.replace(/'/g, '"')).map(t => t[1]), ['Feedback', 'Spelare', 'Försäljning', 'Budget', 'Mål', 'Healthy page']);
  assert.match(client, /id="admin-form"/, 'the admin key can still be unlocked without the Koder tab');
  assert.doesNotMatch(client, /href="#codes"/, 'no link points at the removed Koder tab');
});

test('stripe: checkout openings and per-source counts survive the public answer', () => {
  const s = online.normalizeStripe({connected: true, totals: {sales: 21}, checkout: {opened: 122, complete: 21, expired: 53, open: 48}, sources: [{source: 'instagram', opened: 5, paid: 2}, {source: 'okand', opened: 117, paid: 19}]});
  assert.equal(s.checkout.opened, 122);
  assert.deepEqual(s.sources, [{source: 'instagram', opened: 5, paid: 2}, {source: 'okand', opened: 117, paid: 19}]);
  assert.deepEqual(online.normalizeStripe({connected: true, totals: {sales: 1}}).sources, []);
});

test('traffic: visits and Stripe sales are joined per source, unknown older checkouts last', () => {
  const visits = online.normalizeVisits({since: '2026-11-24T01:00:00Z', totals: {views: 30, visitors: 20, buyClicks: 4, buyers: 3}, sources: [{source: 'tiktok', views: 10, visitors: 8, buyClicks: 1}, {source: 'instagram', views: 20, visitors: 12, buyClicks: 3}]});
  assert.equal(visits.totals.visitors, 20);
  const rows = online.trafficRows(visits, [{source: 'okand', opened: 100, paid: 19}, {source: 'instagram', opened: 3, paid: 2}]);
  assert.deepEqual(rows.map(r => r.source), ['instagram', 'tiktok', 'okand']);
  assert.deepEqual(rows[0], {source: 'instagram', visitors: 12, views: 20, buyClicks: 3, opened: 3, paid: 2});
  assert.equal(online.sourceName('okand'), 'Före spårningen');
  assert.equal(online.sourceName('direct'), 'Direkt / okänd länk');
  assert.equal(online.sourceName('my_newsletter'), 'My newsletter');
  const empty = online.normalizeVisits({});
  assert.deepEqual(empty.totals, {views: 0, visitors: 0, buyClicks: 0, buyers: 0});
});
