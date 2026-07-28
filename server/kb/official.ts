import * as fs from 'node:fs';
import * as path from 'node:path';
import { chunkPage, stableId } from './clean';
import type { KbChunk } from './types';
import { DUMAGUETE_LOCATIONS } from '../../src/data/dumagueteData';
import { VEHICLE_DETAILS, TRANSPORT_MODES } from '../../shared/transport';
import { BASE_DISTANCE_KM, fareBreakdown } from '../../shared/fare';

/**
 * The authoritative tier, generated from the repo rather than the web.
 *
 * Everything here is either the ordinance text we ship or a fare computed by
 * shared/fare.ts, so it cannot drift from what the app actually charges. The
 * wiki pages carry 2017-era pedicab prices; retrieval must always have a
 * current, correct alternative to return.
 */

/** `=== N. HEADING ===` blocks in legal_context.txt are natural chunk boundaries. */
function splitLegalContext(text: string): { section: string; body: string }[] {
  const parts = text.split(/^===\s*(.+?)\s*===$/m);
  const out: { section: string; body: string }[] = [];

  // split() yields [preamble, heading, body, heading, body, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const section = parts[i].trim();
    const body = (parts[i + 1] ?? '').trim();
    if (body) out.push({ section, body });
  }

  return out.length ? out : [{ section: 'Overview', body: text.trim() }];
}

function legalChunks(): KbChunk[] {
  const file = path.join(process.cwd(), 'server', 'data', 'legal_context.txt');
  if (!fs.existsSync(file)) return [];

  return chunkPage({
    tier: 'official',
    source: 'gentletrike',
    sourceUrl: 'server/data/legal_context.txt',
    title: 'GentleTrike Official Fare, Legal & TMO Reference',
    sections: splitLegalContext(fs.readFileSync(file, 'utf-8')),
    sourceYear: new Date().getFullYear(),
  });
}

/**
 * A worked fare table.
 *
 * These rows exist so retrieval can hand the model an already-correct answer
 * for the most common question in the app. The `estimate_fare` tool is still
 * the authority for a specific trip — this just means that even a plain
 * retrieval answer states the ceiling rule correctly.
 */
function fareChunks(): KbChunk[] {
  const year = new Date().getFullYear();

  return TRANSPORT_MODES.map((mode) => {
    const v = VEHICLE_DETAILS[mode];
    const rows = [1, 1.01, 2, 2.2, 3, 5, 8]
      .map((km) => `- ${km} km: PHP ${fareBreakdown(mode, km, 1).farePerPassenger}.00`)
      .join('\n');

    const body =
      `${v.title} (${v.subtitle}). Capacity: ${v.capacity}. Typical wait: ${v.eta}.\n` +
      `Base fare PHP ${v.baseFare}.00 covers the first ${BASE_DISTANCE_KM} km or less. ` +
      `Every succeeding kilometre OR FRACTION THEREOF adds PHP ${v.perKm}.00 — a fraction ` +
      `always rounds UP to a whole kilometre, so 1.01 km and 2.00 km cost the same. ` +
      `Never bill proportionally.\n` +
      `The TMO grants senior citizens, PWDs, and students with valid ID a 20% discount, but ` +
      `GentleTrike quotes and books the FULL fare — the discount is arranged with the driver, ` +
      `not applied by the app.\n\n` +
      `Worked examples, per passenger:\n${rows}`;

    return {
      id: stableId(['gentletrike', 'fare-table', mode]),
      tier: 'official' as const,
      source: 'gentletrike',
      sourceUrl: 'shared/fare.ts',
      title: `Official Fare Table — ${v.title}`,
      section: 'Fares',
      content: body,
      sourceYear: year,
    };
  });
}

/** The pickup/dropoff points the booking UI offers, so Gently can name real places. */
function locationChunks(): KbChunk[] {
  const year = new Date().getFullYear();

  return DUMAGUETE_LOCATIONS.map((loc) => ({
    id: stableId(['gentletrike', 'location', loc.id]),
    tier: 'official' as const,
    source: 'gentletrike',
    sourceUrl: 'src/data/dumagueteData.ts',
    title: `GentleTrike Pickup Point — ${loc.name}`,
    section: 'Locations',
    content:
      `${loc.name} (${loc.address ?? 'Dumaguete City'}). ` +
      `Known for: ${loc.popularFor ?? 'a GentleTrike pickup and drop-off point'}. ` +
      `Coordinates ${loc.lat}, ${loc.lng}. ` +
      `This is a selectable pickup and drop-off point inside the GentleTrike app.`,
    sourceYear: year,
  }));
}

export function buildOfficialChunks(log = console.log): KbChunk[] {
  const chunks = [...legalChunks(), ...fareChunks(), ...locationChunks()];
  log(`  official tier: ${chunks.length} chunks (legal + fare tables + locations)`);
  return chunks;
}
