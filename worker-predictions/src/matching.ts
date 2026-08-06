import type { NormalizedMarket } from './types';

const STOP_WORDS = new Set([
  'will',
  'the',
  'and',
  'for',
  'that',
  'this',
  'with',
  'from',
  'before',
  'after',
  'during',
  'their',
  'they',
  'have',
  'been',
  'what',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'into',
  'than',
  'then',
  'there',
  'about',
  'would',
  'could',
  'should',
  'become',
  'becomes',
]);

export type MarketCategory = 'totals' | 'spread' | 'winner' | 'prop' | 'generic';

export interface MarketMeta {
  tokens: Set<string>;
  normalized: string;
  category: MarketCategory;
  hasTotalRuns: boolean;
  hasTotalPoints: boolean;
  hasTotalGoals: boolean;
  hasTotalGames: boolean;
  hasWinsBy: boolean;
  hasSpread: boolean;
  hasOverUnder: boolean;
  hasGroupStageProp: boolean;
  hasEventChampion: boolean;
  hasPlayerGoalsProp: boolean;
  hasTeamGoalsProp: boolean;
  hasAdvanceFurtherThan: boolean;
  hasAdvanceToKnockout: boolean;
  hasOutBeforeDate: boolean;
  hasNextRoleHolder: boolean;
  hasLeadAfterRound: boolean;
  hasMakeTheCut: boolean;
  hasFinishPlacement: boolean;
  hasSetWinner: boolean;
  hasNoPickAnnouncement: boolean;
  hasWhoWillBe: boolean;
  hasSetScoreMarket: boolean;
  hasSecondHalf: boolean;
  hasOvertime: boolean;
  hasHandicapProp: boolean;
  hasMapProp: boolean;
  hasGameProp: boolean;
  hasExtraInningsProp: boolean;
}

const MONTHS: Record<string, string> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};

export function parseKalshiEventDate(eventTicker: string): string | null {
  const suffix = eventTicker.includes('-') ? eventTicker.split('-').slice(1).join('-') : eventTicker;
  const match = suffix.match(/^(\d{2})([A-Z]{3})(\d{2})/i);
  if (!match) {
    return null;
  }

  const month = MONTHS[match[2].toUpperCase()];
  if (!month) {
    return null;
  }

  return `20${match[1]}-${month}-${match[3]}`;
}

export function parsePolymarketEventDate(slug: string, gameStartTime?: string | null): string | null {
  const slugMatch = slug.match(/(\d{4}-\d{2}-\d{2})\s*$/);
  if (slugMatch) {
    return slugMatch[1];
  }

  if (gameStartTime) {
    const normalized = gameStartTime.replace(' ', 'T');
    const parsed = Date.parse(normalized.includes('T') ? normalized : `${normalized}T00:00:00Z`);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString().slice(0, 10);
    }
  }

  return null;
}

export function parseTitleEventDate(title: string): string | null {
  const iso = title.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) {
    return iso[1];
  }

  const match =
    title.match(
      /\b(?:on|by|before|after|at)\s+([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(20\d{2})\b/i
    ) || title.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(20\d{2})\b/i);

  if (!match) {
    return null;
  }

  const monthKey = match[1].slice(0, 3).toUpperCase();
  const month = MONTHS[monthKey];
  if (!month) {
    return null;
  }

  return `${match[3]}-${month}-${match[2].padStart(2, '0')}`;
}

export function effectiveEventDate(market: NormalizedMarket): string | null {
  return market.eventDate ?? parseTitleEventDate(market.title);
}

export function areEventDatesCompatible(
  dateA: string | null,
  dateB: string | null,
  requireBoth = false
): boolean {
  if (requireBoth) {
    return dateA !== null && dateB !== null && dateA === dateB;
  }

  if (dateA && dateB) {
    return dateA === dateB;
  }

  return true;
}

function teamCodeMatchesBlob(polyTeamCode: string, kalshiBlob: string): boolean {
  const code = polyTeamCode.replace(/-/g, '').toLowerCase();
  const candidates = new Set<string>([code, ...(POLY_TEAM_IN_KALSHI_BLOB[code] ?? [])]);
  for (const candidate of candidates) {
    if (kalshiBlob.includes(candidate)) {
      return true;
    }
  }
  return false;
}

const POLY_SPORTS_SLUG =
  /^[a-z0-9]+-([a-z0-9]+)-([a-z0-9]+)-(\d{4}-\d{2}-\d{2})$/i;

/** Polymarket slug code -> substrings that may appear in Kalshi team blobs. */
const POLY_TEAM_IN_KALSHI_BLOB: Record<string, string[]> = {
  ari: ['ari', 'az'],
  az: ['ari', 'az'],
  lad: ['lad', 'la'],
  laa: ['laa', 'ana'],
  sf: ['sf', 'sfo'],
  wsh: ['wsh', 'was'],
  tb: ['tb', 'tba'],
  sd: ['sd', 'sdp'],
  nyy: ['nyy', 'ny'],
  nyk: ['nyk', 'ny'],
  sas: ['sas', 'sa'],
  conn: ['conn', 'con'],
  tor: ['tor'],
  cin: ['cin'],
  mil: ['mil'],
  stl: ['stl'],
  hou: ['hou'],
  pit: ['pit'],
  oak: ['oak'],
  sea: ['sea'],
  atl: ['atl'],
  bos: ['bos'],
  cle: ['cle'],
  min: ['min'],
  tex: ['tex'],
  kc: ['kc', 'kan'],
  mia: ['mia'],
  phi: ['phi'],
  chc: ['chc', 'ch'],
  chw: ['chw', 'cws'],
  det: ['det'],
  col: ['col'],
};

export function parseKalshiTeamSuffix(ticker: string): string | null {
  const parts = ticker.split('-');
  if (parts.length < 3) {
    return null;
  }

  const suffix = parts[parts.length - 1];
  if (!/^[A-Z]{2,6}$/i.test(suffix)) {
    return null;
  }

  return suffix.toLowerCase();
}

export function sportsTeamCodesMatch(codeA: string, codeB: string): boolean {
  const a = codeA.replace(/-/g, '').toLowerCase();
  const b = codeB.replace(/-/g, '').toLowerCase();
  return a.includes(b) || b.includes(a);
}

/** Re-orient Kalshi yes/no so Yes matches Polymarket's Yes team (slug team 1). */
export function alignKalshiMarketToPolyYes(
  kalshi: NormalizedMarket,
  poly: NormalizedMarket
): NormalizedMarket {
  if (kalshi.yesAsk === null || kalshi.noAsk === null) {
    return kalshi;
  }

  const polyTeams = parsePolymarketSportsTeams(poly.eventId);
  const kalshiYesTeam = parseKalshiTeamSuffix(kalshi.id);
  if (!polyTeams || !kalshiYesTeam) {
    return kalshi;
  }

  if (sportsTeamCodesMatch(kalshiYesTeam, polyTeams[0])) {
    return kalshi;
  }

  if (sportsTeamCodesMatch(kalshiYesTeam, polyTeams[1])) {
    return {
      ...kalshi,
      yesAsk: kalshi.noAsk,
      noAsk: kalshi.yesAsk,
    };
  }

  return kalshi;
}

export function parsePolymarketSportsTeams(slug: string): string[] | null {
  const match = slug.match(POLY_SPORTS_SLUG);
  if (!match) {
    return null;
  }

  return [match[1].toLowerCase(), match[2].toLowerCase()];
}

export function parseKalshiSportsTeamBlob(eventTicker: string): string | null {
  const suffix = eventTicker.includes('-') ? eventTicker.slice(eventTicker.indexOf('-') + 1) : eventTicker;
  const match =
    suffix.match(/^\d{2}[A-Z]{3}\d{2}\d{4}([A-Z]+)$/i) ||
    suffix.match(/^\d{2}[A-Z]{3}\d{2}([A-Z]+)$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function areSportsSlugTeamsCompatible(kalshiEventId: string, polySlug: string): boolean {
  const polyTeams = parsePolymarketSportsTeams(polySlug);
  const kalshiBlob = parseKalshiSportsTeamBlob(kalshiEventId);
  if (!polyTeams || !kalshiBlob) {
    return false;
  }

  return polyTeams.every((team) => teamCodeMatchesBlob(team, kalshiBlob));
}

export function isLiveSportsMicroProp(title: string): boolean {
  return (
    /\bwins? by over\b/i.test(title) ||
    /\bwins? by\b.*\bruns?\b/i.test(title) ||
    /\bwins? by\b/i.test(title) ||
    /\btotal runs?\b/i.test(title) ||
    /\btotal points?\b/i.test(title) ||
    /\btotal goals?\b/i.test(title) ||
    /\btotal games\b/i.test(title) ||
    /\bstrikeouts?\b/i.test(title) ||
    /\btotal bases?\b/i.test(title) ||
    /\bhome runs?\b/i.test(title) ||
    /\bhits? \+\s*runs?\b/i.test(title) ||
    /\bfirst half\b/i.test(title) ||
    /\bfirst \d+ innings\b/i.test(title) ||
    /\bfirst five innings\b/i.test(title) ||
    /\bfirst inning\b/i.test(title) ||
    /\bdouble double\b/i.test(title) ||
    /\btriple double\b/i.test(title) ||
    /\bannouncers?\s+say\b/i.test(title) ||
    /\brecord the most\b/i.test(title) ||
    /:\s*\d+\+\s/i.test(title) ||
    /\bRound of \d+|:\s*M\d+\s|: W\d+\s/i.test(title) ||
    /^[^:]+:\s*(points?|rebounds?|assists?|yards?|touchdowns?|goals?|saves?)\b/i.test(title) ||
    /\b\d+\+\s*(corners?|cards?|bookings?|goals?|shots?)\b/i.test(title)
  );
}

export function titleClusterKey(title: string): string {
  return normalizeTitle(title).replace(/\d+(\.\d+)?/g, '#');
}

export function matchupClusterKey(title: string): string | null {
  const normalized = normalizeTitle(title);
  const match = normalized.match(/^(.+?)\s+vs\.?\s+(.+?)$/);
  if (!match) {
    return null;
  }

  const left = match[1].replace(/\b(game \d+:|winner|first inning run|total points?)\b/g, '').trim();
  const right = match[2]
    .replace(/\b(winner|first inning run|total points?|first half winner)\b/g, '')
    .trim();

  if (!left || !right) {
    return null;
  }

  return `vs:${left}|${right}`;
}

export function countSharedTokens(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) {
      shared += 1;
    }
  }
  return shared;
}

function isHeadToHeadWinner(meta: MarketMeta): boolean {
  if (meta.category !== 'winner' || meta.hasSecondHalf || meta.hasOvertime) {
    return false;
  }

  return (
    /\bvs\.?\b|\bversus\b/i.test(meta.normalized) ||
    /\b at \b/i.test(meta.normalized)
  );
}

const PLAYER_GOAL_GENERIC_TOKENS = new Set([
  'world',
  'cup',
  'fifa',
  'men',
  'women',
  '2026',
  '2025',
  'goal',
  'score',
  'player',
]);

function isNamedPlayerGoalProp(meta: MarketMeta): boolean {
  return /\bscore a goal\b/i.test(meta.normalized) && /\bwill\s+\w+/i.test(meta.normalized);
}

export function isStrongTitleMatch(
  score: number,
  metaA: MarketMeta,
  metaB: MarketMeta,
  options?: { datesMatch?: boolean }
): boolean {
  const shared = countSharedTokens(metaA.tokens, metaB.tokens);
  const headToHead = isHeadToHeadWinner(metaA) && isHeadToHeadWinner(metaB);
  const datesMatch = options?.datesMatch ?? false;

  if (isNamedPlayerGoalProp(metaA) && isNamedPlayerGoalProp(metaB)) {
    const sharedNames = [...metaA.tokens].filter(
      (token) => metaB.tokens.has(token) && !PLAYER_GOAL_GENERIC_TOKENS.has(token)
    );
    if (sharedNames.length === 0) {
      return false;
    }
  }

  if (headToHead) {
    return score >= 0.5 && shared >= 2;
  }

  if (datesMatch && score >= 0.55 && shared >= 2) {
    return (
      !metaA.hasHandicapProp &&
      !metaB.hasHandicapProp &&
      !metaA.hasMapProp &&
      !metaB.hasMapProp &&
      !metaA.hasGameProp &&
      !metaB.hasGameProp
    );
  }

  if (score < 0.58) {
    return false;
  }

  if (shared < 3) {
    return false;
  }

  const shorter = Math.min(metaA.tokens.size, metaB.tokens.size);
  if (shorter > 0 && shared / shorter < 0.6) {
    return false;
  }

  return true;
}

const TOTALS_PATTERNS = [
  /\btotal runs?\b/i,
  /\btotal points?\b/i,
  /\btotal goals?\b/i,
  /\bcombined score\b/i,
  /\bover\/under\b/i,
  /\bo\/u\b/i,
  /\bpoints? scored\b/i,
  /\bruns? scored\b/i,
  /\bgoals? scored\b/i,
  /\bhow many\b/i,
];

const SPREAD_PATTERNS = [
  /\bwins? by\b/i,
  /\bwin by\b/i,
  /\bbeat\b.*\bby\b/i,
  /\bmargin\b/i,
  /\bspread\b/i,
];

const PROP_PATTERNS = [
  /\bfirst to\b/i,
  /\bmvp\b/i,
  /\bplayer to\b/i,
  /\bhome run\b/i,
  /\bstrikeouts?\b/i,
  /\bto score\b/i,
];

const WINNER_PATTERNS = [/\bwho will win\b/i, /\bwinner\b/i, /\bto win\b/i];

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleTokens(title: string): Set<string> {
  const tokens = normalizeTitle(title)
    .split(' ')
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
  return new Set(tokens);
}

function detectMarketCategory(title: string): MarketCategory {
  for (const pattern of TOTALS_PATTERNS) {
    if (pattern.test(title)) {
      return 'totals';
    }
  }
  for (const pattern of SPREAD_PATTERNS) {
    if (pattern.test(title)) {
      return 'spread';
    }
  }
  for (const pattern of PROP_PATTERNS) {
    if (pattern.test(title)) {
      return 'prop';
    }
  }
  for (const pattern of WINNER_PATTERNS) {
    if (pattern.test(title)) {
      return 'winner';
    }
  }

  if (/\bvs\.?\b|\bv\.?\b|\bversus\b/i.test(title)) {
    return 'winner';
  }

  return 'generic';
}

export function buildMarketMeta(title: string): MarketMeta {
  return {
    tokens: titleTokens(title),
    normalized: normalizeTitle(title),
    category: detectMarketCategory(title),
    hasTotalRuns: /\btotal runs?\b/i.test(title),
    hasTotalPoints: /\btotal points?\b/i.test(title),
    hasTotalGoals: /\btotal goals?\b/i.test(title),
    hasTotalGames: /\btotal games\b/i.test(title),
    hasWinsBy: /\bwins? by\b/i.test(title),
    hasSpread: /\bspread\b/i.test(title),
    hasOverUnder: /\bover\/under\b/i.test(title) || /\bo\/u\b/i.test(title),
    hasGroupStageProp:
      /\bgroup stage\b/i.test(title) || /\bwin all \d+ of their matches\b/i.test(title),
    hasEventChampion:
      /\bwin the \d{4}\b/i.test(title) &&
      /\b(world cup|nomination|election|primary|championship|super bowl)\b/i.test(title),
    hasPlayerGoalsProp: /\bscore the most goals for\b/i.test(title),
    hasTeamGoalsProp: /\bscore the most goals at the \d{4}\b/i.test(title),
    hasAdvanceFurtherThan: /\badvance further than\b/i.test(title),
    hasAdvanceToKnockout: /\badvance to the knockout\b/i.test(title),
    hasOutBeforeDate: /\bbe out as\b.*\bbefore\b/i.test(title),
    hasNextRoleHolder: /\bbe the next\b/i.test(title),
    hasLeadAfterRound: /\blead at the end of round\b/i.test(title),
    hasMakeTheCut: /\bmake the cut\b/i.test(title),
    hasFinishPlacement: /\bfinish top \d+\b/i.test(title),
    hasSetWinner: /\bwin set \d+\b/i.test(title),
    hasNoPickAnnouncement: /\bannounce no pick\b/i.test(title) || /\bno pick for\b/i.test(title),
    hasWhoWillBe: /\bwho will be\b/i.test(title),
    hasSetScoreMarket: /\bset score of\b/i.test(title),
    hasSecondHalf: /\bsecond half\b/i.test(title),
    hasOvertime: /\bovertime\b/i.test(title),
    hasHandicapProp: /\bhandicap\b/i.test(title) || /\([-+]\d+(\.\d+)?\)/.test(title),
    hasMapProp: /\bmap \d+\b/i.test(title),
    hasGameProp: /\bgame \d+ winner\b/i.test(title),
    hasExtraInningsProp: /\bextra innings\b/i.test(title),
  };
}

export function areMetaCompatible(a: MarketMeta, b: MarketMeta): boolean {
  if (a.hasTotalRuns !== b.hasTotalRuns) return false;
  if (a.hasTotalPoints !== b.hasTotalPoints) return false;
  if (a.hasTotalGoals !== b.hasTotalGoals) return false;
  if (a.hasTotalGames !== b.hasTotalGames) return false;
  if (a.hasWinsBy !== b.hasWinsBy) return false;
  if (a.hasSpread !== b.hasSpread) return false;
  if (a.hasOverUnder !== b.hasOverUnder) return false;
  if (a.hasGroupStageProp !== b.hasGroupStageProp) return false;
  if (a.hasEventChampion !== b.hasEventChampion) return false;
  if (a.hasPlayerGoalsProp !== b.hasPlayerGoalsProp) return false;
  if (a.hasTeamGoalsProp !== b.hasTeamGoalsProp) return false;
  if (a.hasAdvanceFurtherThan !== b.hasAdvanceFurtherThan) return false;
  if (a.hasAdvanceToKnockout !== b.hasAdvanceToKnockout) return false;
  if (a.hasOutBeforeDate !== b.hasOutBeforeDate) return false;
  if (a.hasNextRoleHolder !== b.hasNextRoleHolder) return false;
  if (a.hasLeadAfterRound !== b.hasLeadAfterRound) return false;
  if (a.hasMakeTheCut !== b.hasMakeTheCut) return false;
  if (a.hasFinishPlacement !== b.hasFinishPlacement) return false;
  if (a.hasSetWinner !== b.hasSetWinner) return false;
  if (a.hasNoPickAnnouncement !== b.hasNoPickAnnouncement) return false;
  if (a.hasWhoWillBe !== b.hasWhoWillBe) return false;
  if (a.hasSetScoreMarket !== b.hasSetScoreMarket) return false;
  if (a.hasSecondHalf !== b.hasSecondHalf) return false;
  if (a.hasOvertime !== b.hasOvertime) return false;
  if (a.hasHandicapProp !== b.hasHandicapProp) return false;
  if (a.hasMapProp !== b.hasMapProp) return false;
  if (a.hasGameProp !== b.hasGameProp) return false;
  if (a.hasExtraInningsProp !== b.hasExtraInningsProp) return false;

  if (a.category === 'generic' || b.category === 'generic') {
    return true;
  }

  return a.category === b.category;
}

export function jaccardFromTokenSets(
  tokensA: Set<string>,
  tokensB: Set<string>,
  normalizedA: string,
  normalizedB: string
): number {
  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersection += 1;
    }
  }

  const union = tokensA.size + tokensB.size - intersection;
  if (union === 0) {
    return 0;
  }

  const jaccard = intersection / union;
  const containsBonus =
    normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA) ? 0.08 : 0;

  return Math.min(1, jaccard + containsBonus);
}
