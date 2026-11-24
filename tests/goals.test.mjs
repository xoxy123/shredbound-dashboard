import test from 'node:test';
import assert from 'node:assert/strict';
import * as online from '../src/online.js';
import { youtubeId, feedOf, HEALTHY_FEED, embedUrl } from '../src/healthy.js';

const at = (s) => new Date(s);

test('sales goals: 600 kr a day, 4 200 a week, 18 000 a month', () => {
  assert.equal(online.salesGoal('day'), 600);
  assert.equal(online.salesGoal('week'), 4200);
  assert.equal(online.salesGoal('month'), 18000);
});

test('periods: local day, Monday-first week, calendar month', () => {
  const now = at('2026-11-26T15:00:00'); // a Thursday
  const w = online.periodOf('week', now);
  assert.equal(w.start.getDay(), 1);
  assert.equal(w.start.getDate(), 23);
  assert.equal(w.end.getDate(), 30);
  const m = online.periodOf('month', now);
  assert.equal(m.start.getDate(), 1);
  assert.equal(m.end.getMonth(), 11);
  const d = online.periodOf('day', now);
  assert.equal(d.end - d.start, 86400000);
});

test('pace: a third of the day gone needs 200 kr to be in phase', () => {
  const start = at('2026-11-24T00:00:00'), end = at('2026-11-25T00:00:00'), now = at('2026-11-24T08:00:00');
  assert.equal(Math.round(online.pace(200, 600, start, end, now).expected), 200);
  assert.equal(online.pace(205, 600, start, end, now).status, 'ahead');
  assert.equal(online.pace(160, 600, start, end, now).status, 'close');
  assert.equal(online.pace(0, 600, start, end, now).status, 'behind');
  assert.equal(online.pace(650, 600, start, end, now).status, 'done');
  assert.equal(online.pace(100, 600, start, end, now).left, 500);
});

test('sales in kronor: settled SEK less refunds; only paid ones; bars per hour and per day', () => {
  const pays = [
    { status: 'paid', created: '2026-11-24T09:10:00', amount: 1900, refunded: 0, settled: 18000, settleCurrency: 'SEK' },
    { status: 'partial_refund', created: '2026-11-24T09:40:00', amount: 2000, refunded: 1000, settled: 20000, settleCurrency: 'SEK' },
    { status: 'failed', created: '2026-11-24T10:00:00', amount: 900, settled: 9000, settleCurrency: 'SEK' },
    { status: 'paid', created: '2026-11-22T20:00:00', amount: 900, settled: 8500, settleCurrency: 'SEK' },
  ];
  const pts = online.salesPoints(pays);
  assert.deepEqual(pts.map(p => p.kr), [180, 100, 85]);
  const day = online.salesBars(pts, 'day', at('2026-11-24T12:00:00'));
  assert.equal(day.length, 24);
  assert.equal(day[9].kr, 280);
  assert.equal(day[9].sales, 2);
  const week = online.salesBars(pts, 'week', at('2026-11-24T12:00:00'));
  assert.equal(week.length, 7);
  assert.equal(week[1].kr, 280); // Tuesday
  assert.equal(online.bestHour(pts), 9);
  assert.match(online.krChart(day, { goalLine: null }), /<svg/);
});

test('Instagram goal: from 820 to 1 200 by 31 Dec, needed per day and in phase', () => {
  const social = online.normalizeSocial({ instagram: { followers: 830, first: { followers: 820, takenAt: '2026-11-24T00:00:00Z' }, daily: [] } });
  const p = online.followerPace(social, online.FOLLOWER_GOAL, at('2026-11-25T00:00:00Z'));
  assert.equal(p.left, 370);
  assert.ok(p.perDay > 9 && p.perDay < 11);
  assert.ok(Math.abs(p.expected - 830) < 2);
  assert.ok(['ahead', 'close'].includes(p.status));
  assert.equal(online.followerPace(online.normalizeSocial({ instagram: {} })), null);
});

test('Healthy page: YouTube links and the feed order', () => {
  assert.equal(youtubeId('https://youtu.be/Fi1wkUczuyk?si=x'), 'Fi1wkUczuyk');
  assert.equal(youtubeId('https://www.youtube.com/watch?v=GCu97AQMtJI&t=3'), 'GCu97AQMtJI');
  assert.equal(youtubeId('https://youtube.com/shorts/ZWS_7BqKb7A'), 'ZWS_7BqKb7A');
  assert.equal(youtubeId('not a link'), null);
  const st = { seen: { [HEALTHY_FEED[0].id]: 1 }, custom: [], position: HEALTHY_FEED[3].id };
  const feed = feedOf(st);
  assert.equal(feed.length, HEALTHY_FEED.length - 1);
  assert.equal(feed[0].id, HEALTHY_FEED[3].id, 'opens on the video you stopped at');
  assert.ok(!feed.some(v => v.id === HEALTHY_FEED[0].id), 'a watched video leaves the feed');
  assert.match(embedUrl('Fi1wkUczuyk', true), /^https:\/\/www\.youtube-nocookie\.com\/embed\/Fi1wkUczuyk\?.*autoplay=1/);
});
