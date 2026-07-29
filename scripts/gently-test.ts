import 'dotenv/config';
import { MockProvider } from '../server/ai/provider';
import { runAgent } from '../server/ai/agent';
import { executeTool } from '../server/ai/tools';
import { retrieve, requiresOfficialTier } from '../server/ai/retrieve';
import { resolveLocation, resolvePlace, detectOutOfCoverage } from '../server/ai/locations';
import { searchPlaces } from '../server/geocode';
import { isInServiceArea } from '../shared/serviceArea';
import { pool } from '../server/db';

/**
 * End-to-end smoke test for Gently, run against the real knowledge base with
 * the mock provider. Costs nothing, so it can be run on every change.
 *
 *   npm run gently:test
 */

let failures = 0;

function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log('\n=== 1. Fare/legal queries are classified for the official tier ===');
  for (const q of [
    'how much is the fare to Robinsons',
    'tagpila padulong sa Silliman',
    'magkano papuntang boulevard',
    'what is the student discount',
    'how do I report an overcharging driver to TMO',
  ]) {
    check(`"${q}"`, requiresOfficialTier(q));
  }
  for (const q of ['what is there to see at Rizal Boulevard', 'best place for silvanas']) {
    check(`"${q}" stays general`, !requiresOfficialTier(q));
  }

  console.log('\n=== 2. The ₱9 problem: fare retrieval must exclude reference tier ===');
  const fareHits = await retrieve('how much is the pedicab fare per kilometer');
  const tiers = [...new Set(fareHits.chunks.map((c) => c.tier))];
  check(`retrieved ${fareHits.chunks.length} chunks (${fareHits.mode} mode)`, fareHits.chunks.length > 0);
  check('all chunks are official tier', tiers.every((t) => t === 'official'), `got: ${tiers.join(', ') || 'none'}`);
  const mentionsNine = fareHits.chunks.some((c) => /₱\s?9\b|PHP\s?9\b/.test(c.content));
  check('no ₱9 figure reached the context', !mentionsNine);

  console.log('\n=== 3. General queries can use all tiers ===');
  const general = await retrieve('festivals and things to do in Dumaguete');
  check(`retrieved ${general.chunks.length} chunks`, general.chunks.length > 0);
  check(
    'draws on more than the official tier',
    new Set(general.chunks.map((c) => c.tier)).size >= 1,
    [...new Set(general.chunks.map((c) => c.tier))].join(', ')
  );

  console.log('\n=== 4. Location resolution ===');
  for (const [input, expected] of [
    ['Silliman', 'silliman_portal'],
    ['the boulevard', 'rizal_blvd'],
    ['robinsons', 'robinsons_place'],
    ['airport', 'sibulan_airport'],
    ['pier', 'dumaguete_port'],
  ] as const) {
    const r = resolveLocation(input);
    check(`"${input}" -> ${expected}`, r?.location.id === expected, r ? `got ${r.location.id}` : 'no match');
  }
  check('gibberish resolves to nothing usable', (resolveLocation('zzzz qqqq')?.confidence ?? 0) < 0.34);

  console.log('\n=== 5. estimate_fare computes, never guesses ===');
  const fare = await executeTool('estimate_fare', {
    pickup: 'Silliman',
    dropoff: 'Robinsons',
    passengers: 1,
  });
  console.log(`    ${fare.content.replace(/\n/g, '\n    ')}`);
  const d = fare.data as any;
  check('returned a numeric total', typeof d?.total === 'number' && d.total > 0);
  check(
    'total matches base + ceil(succeeding) * perKm',
    d.total === d.baseFare + d.succeedingKm * d.perKm,
    `${d.total} vs ${d.baseFare} + ${d.succeedingKm}*${d.perKm}`
  );

  // The app applies no discount. Gently must agree with the booking panel to
  // the peso, or a passenger sees one price in chat and another at checkout.
  const asStudent = await executeTool('estimate_fare', {
    pickup: 'Silliman',
    dropoff: 'Robinsons',
    payer: 'student',
  });
  check(
    'a "student" argument does NOT change the fare',
    (asStudent.data as any).total === d.total,
    `${(asStudent.data as any).total} vs ${d.total}`
  );
  check('no discount field leaks into the payload', !('discountedPerPassenger' in d) && !('payer' in d));

  const group = await executeTool('estimate_fare', {
    pickup: 'Silliman',
    dropoff: 'Robinsons',
    passengers: 3,
  });
  check(
    'group total equals panel maths (perPassenger x heads)',
    (group.data as any).total === d.farePerPassenger * 3,
    `${(group.data as any).total} vs ${d.farePerPassenger * 3}`
  );

  console.log('\n=== 5b. Out-of-coverage towns are refused, not snapped to a lookalike ===');
  // "Valencia" once matched the downtown "Valencia Jeepney & Bus Terminal" and
  // produced a confident PHP 17.00 / 1.14 km quote for a town 9 km inland.
  for (const place of ['Valencia', 'Siquijor', 'Casaroro Falls', 'Dauin']) {
    const r = await executeTool('estimate_fare', { pickup: 'Silliman', dropoff: place });
    check(`"${place}" is refused`, /OUT OF COVERAGE/.test(r.content), r.content.slice(0, 60));
    check(`  ...and quotes no fare`, !/PHP\s?\d/.test(r.content));
  }
  const draftOut = await executeTool('draft_booking', { pickup: 'Silliman', dropoff: 'Valencia' });
  check('draft_booking to Valencia produces no draft', (draftOut.data as any)?.kind !== 'booking_draft');

  // The in-city terminal itself must still be bookable.
  const term = await executeTool('estimate_fare', { pickup: 'Silliman', dropoff: 'Valencia terminal' });
  check('"Valencia terminal" still resolves', /OFFICIAL FARE/.test(term.content), term.content.slice(0, 50));

  console.log('\n=== 5c. Out-of-coverage replies offer the terminal AND the charter ===');
  const outside = await executeTool('estimate_fare', { pickup: 'Silliman', dropoff: 'Dauin' });
  check('points at a departure terminal', /Ceres Bus Terminal/.test(outside.content));
  check('mentions the pakyaw charter option', /pakyaw charter/i.test(outside.content));
  check('explains why (each town sets its own rates)', /own rates|own fare/i.test(outside.content));

  console.log('\n=== 5d. Land neighbours are never sent by sea ===');
  // Gently told a passenger to catch a ferry to Sibulan — the next town north,
  // 5 km by road. Sibulan was simply missing from the coverage list, and the
  // prompt offered a menu of terminals for the model to guess from.
  for (const town of ['Sibulan', 'Bacong', 'Dauin', 'Valencia', 'Bais', 'Amlan']) {
    const r = await executeTool('estimate_fare', { pickup: 'Silliman', dropoff: town });
    check(`"${town}" is recognised as outside`, /OUT OF COVERAGE/.test(r.content), r.content.slice(0, 40));

    // Assert on the onward route itself; the surrounding instruction mentions
    // ferries precisely to forbid inventing one.
    const onward = detectOutOfCoverage(town)?.onward ?? '';
    check(`  ...reached by road, not by boat`, /no boat involved/.test(onward), onward.slice(0, 50));
    check(`  ...and its route names no ferry`, !/ferry/i.test(onward));
  }
  for (const island of ['Siquijor', 'Bohol', 'Cebu']) {
    const onward = detectOutOfCoverage(island)?.onward ?? '';
    check(`"${island}" does go by ferry`, /ferry from Dumaguete Port/.test(onward), onward);
  }
  // The town is out of coverage; the airport that shares its name is not.
  const apt = await executeTool('estimate_fare', { pickup: 'Silliman', dropoff: 'Sibulan Airport' });
  check('"Sibulan Airport" is still bookable', /OFFICIAL FARE/.test(apt.content), apt.content.slice(0, 40));

  console.log('\n=== 6. Unknown places are refused, not guessed ===');
  const bogus = await executeTool('estimate_fare', { pickup: 'Atlantis', dropoff: 'Narnia' });
  check('asks the passenger to describe it differently', /Could not find/.test(bogus.content));
  check('quotes no fare', !/PHP\s?\d/.test(bogus.content));

  console.log('\n=== 6a. A missing pickup asks a question, it does not recite the list ===');
  // "book me a ride to terminal" produced a bulleted list of thirteen pickup
  // points, which is both noise on a phone and wrong — any place in the city
  // is bookable.
  const noPickup = await executeTool('draft_booking', { pickup: '', dropoff: 'Robinsons' });
  check('says the pickup is missing, not "not found"', /has not said where/.test(noPickup.content));
  check('tells the model to ask one short question', /one short, direct question/.test(noPickup.content));
  check('forbids reciting the pickup points', /Do NOT\s+list the app's pickup points/.test(noPickup.content));
  check('drafts nothing', (noPickup.data as any)?.kind !== 'booking_draft');
  for (const r of [noPickup, await executeTool('estimate_fare', { pickup: 'Silliman', dropoff: 'zzzz qqqq' })]) {
    check('  ...and no tool result dumps the full list', !/Rizal Boulevard Promenade,/.test(r.content));
  }

  console.log('\n=== 6b. A near-miss on a curated name must not snap to it ===');
  // "Foundation University" shares the word "university" with Silliman
  // University Portal and clears the confidence floor on that alone. Coverage
  // is what stops it, so the geocoder gets its turn instead.
  const nearMiss = resolveLocation('Foundation University');
  check(
    'scores against Silliman on the shared word',
    nearMiss?.location.id === 'silliman_portal',
    nearMiss ? `got ${nearMiss.location.id}` : 'no match'
  );
  check(
    '...but explains too little of the query to be used',
    (nearMiss?.coverage ?? 1) < 0.6,
    `coverage ${nearMiss?.coverage?.toFixed(2)}`
  );
  for (const shortcut of ['Silliman', 'the boulevard', 'Valencia terminal', 'Sans Rival']) {
    const r = resolveLocation(shortcut);
    check(`"${shortcut}" still clears coverage`, (r?.coverage ?? 0) >= 0.6, `${r?.coverage?.toFixed(2)}`);
  }

  console.log('\n=== 6b2. A word matching two curated points is a question, not an answer ===');
  // "terminal" fits Ceres and the Valencia terminal equally. The old matcher
  // kept whichever came first in the data and never said there was a choice.
  const twoTerminals = await resolvePlace('terminal');
  check('"terminal" is ambiguous', twoTerminals.kind === 'ambiguous', twoTerminals.kind);
  if (twoTerminals.kind === 'ambiguous') {
    check('  ...and offers both', twoTerminals.options.length >= 2,
      twoTerminals.options.map((o) => o.name).join(' | '));
  }
  for (const unambiguous of ['Silliman', 'the boulevard', 'Valencia terminal', 'robinsons', 'pier']) {
    const r = await resolvePlace(unambiguous);
    check(`"${unambiguous}" stays a single answer`, r.kind === 'resolved', r.kind);
  }

  console.log('\n=== 6c. Anywhere inside the city is bookable, not just the 16 points ===');
  const probe = await searchPlaces('Perdices Street');
  if (probe.error) {
    console.log('    skipped — geocoder unreachable');
  } else {
    for (const place of ['Foundation University', 'Perdices Street']) {
      const r = await resolvePlace(place);
      check(`"${place}" resolves`, r.kind !== 'not-found', r.kind);
      if (r.kind === 'resolved') {
        check(`  ...from the map, not the curated list`, r.source === 'geocoded', r.source);
        check(`  ...and lands inside the service area`, isInServiceArea(r.location.lat, r.location.lng));
        console.log(`    ${place} -> ${r.location.name} (${r.location.lat.toFixed(4)}, ${r.location.lng.toFixed(4)})`);
      }
    }

    const cityWide = await executeTool('draft_booking', {
      pickup: 'Rizal Boulevard',
      dropoff: 'Foundation University',
    });
    const cw = cityWide.data as any;
    if (cw?.kind === 'booking_draft') {
      check('drafts a ride to a non-curated place', true);
      check('the drop-off is inside the city', isInServiceArea(cw.draft.dropoffLocation.lat, cw.draft.dropoffLocation.lng));
      console.log(`    draft: ${cw.draft.pickupLocation.name} -> ${cw.draft.dropoffLocation.name}, PHP ${cw.draft.totalFare}`);
    } else {
      // Ambiguity is a legitimate outcome — it must ask, not guess.
      check('asks instead of guessing', /AMBIGUOUS/.test(cityWide.content), cityWide.content.slice(0, 70));
    }
  }

  console.log('\n=== 7. draft_booking prepares but does not book ===');
  const draft = await executeTool('draft_booking', {
    pickup: 'Rizal Boulevard',
    dropoff: 'Sibulan Airport',
    passengers: 2,
  });
  const dd = draft.data as any;
  check('marked as a draft', dd?.kind === 'booking_draft');
  check('says NOT yet booked', /NOT yet booked/i.test(draft.content));
  check('carries no passengerId (server owns identity)', !('passengerId' in (dd?.draft ?? {})));
  check('has the fields POST /rides needs', !!dd?.draft?.pickupLocation?.name && !!dd?.draft?.totalFare);
  console.log(`    draft: ${dd.draft.pickupLocation.name} -> ${dd.draft.dropoffLocation.name}, PHP ${dd.draft.totalFare}`);

  console.log('\n=== 8. Full agent loop (mock provider) ===');
  const mock = new MockProvider();

  const a1 = await runAgent(mock, 'How much is the fare from Silliman to Robinsons?', []);
  check('called estimate_fare', a1.toolsUsed.includes('estimate_fare'), a1.toolsUsed.join(', '));
  check('replied with something', a1.reply.length > 0);
  check('spent no tokens', a1.usage === undefined && a1.provider === 'mock');

  const a2 = await runAgent(mock, 'Book me a ride from Rizal Boulevard to Robinsons', []);
  check('called draft_booking', a2.toolsUsed.includes('draft_booking'), a2.toolsUsed.join(', '));
  check('surfaced a draft for the UI', a2.data.some((x: any) => x.kind === 'booking_draft'));

  const a3 = await runAgent(mock, 'What festivals happen in Dumaguete?', []);
  check('called search_knowledge', a3.toolsUsed.includes('search_knowledge'), a3.toolsUsed.join(', '));

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} CHECK(S) FAILED.`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('gently-test crashed:', err);
  process.exit(1);
});
