import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TrendingUp,
  Loader2,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  ArrowRight,
  Zap,
  Construction,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchPredictions,
  type ArbitrageOpportunity,
  type ArbitrageStrategy,
  type ScanResult,
} from "@/services/api";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 60_000;
const SHOW_WIP_OVERLAY = false;
const GRADIENT_TEXT = "bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 bg-clip-text text-transparent";

type ViewFilter = "arbs" | "raw";

function formatCents(value: number): string {
  return `${(value * 100).toFixed(1)}¢`;
}

function formatMatchScore(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatEventDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(`${value}T12:00:00`);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function platformLabel(platform: "kalshi" | "polymarket"): string {
  return platform === "kalshi" ? "Kalshi" : "Polymarket";
}

function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string | number;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-lg font-semibold tabular-nums", highlight && GRADIENT_TEXT)}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function CostBar({ totalCost }: { totalCost: number }) {
  const costPercent = Math.min(totalCost * 100, 100);
  const profitPercent = Math.max(0, 100 - costPercent);

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>Cost {formatCents(totalCost)}</span>
        <span>Payout $1.00</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-muted-foreground/25 transition-all"
          style={{ width: `${costPercent}%` }}
        />
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
          style={{ width: `${profitPercent}%` }}
        />
      </div>
    </div>
  );
}

function platformYesLabel(title: string): string | null {
  const match = title.match(/^(.+?)\s+vs\.?\s+(.+?)(?::|\?|$)/i);
  if (!match) {
    return null;
  }
  return `${match[1].trim()} wins`;
}

function PlatformQuote({
  name,
  title,
  url,
  yesAsk,
  noAsk,
  accent,
  buySide,
  yesOutcome,
  eventDate,
}: {
  name: "Kalshi" | "Polymarket";
  title: string;
  url: string;
  yesAsk: number;
  noAsk: number;
  accent: "kalshi" | "poly";
  buySide?: "yes" | "no";
  yesOutcome?: string | null;
  eventDate?: string | null;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        buySide === "yes" && "border-emerald-500/40 bg-emerald-500/5",
        buySide === "no" && "border-sky-500/40 bg-sky-500/5",
        !buySide && "bg-muted/20"
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              accent === "kalshi"
                ? "bg-[#00D395]/15 text-[#00A876]"
                : "bg-[#7B3FE4]/15 text-[#7B3FE4]"
            )}
          >
            {name}
          </span>
          {buySide && (
            <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium uppercase">
              Buy {buySide}
            </span>
          )}
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={`Open on ${name}`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="line-clamp-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        {title}
      </a>
      {eventDate && (
        <p className="mt-1 text-[10px] text-muted-foreground">{formatEventDate(eventDate)}</p>
      )}
      <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs tabular-nums">
        <div className={cn("rounded px-2 py-1", buySide === "yes" ? "bg-emerald-500/15 font-semibold" : "bg-background/60")}>
          <span className="text-muted-foreground">
            Yes{yesOutcome ? ` · ${yesOutcome}` : ""}{" "}
          </span>
          {formatCents(yesAsk)}
        </div>
        <div className={cn("rounded px-2 py-1", buySide === "no" ? "bg-sky-500/15 font-semibold" : "bg-background/60")}>
          <span className="text-muted-foreground">No · other wins </span>
          {formatCents(noAsk)}
        </div>
      </div>
    </div>
  );
}

function ArbitrageCard({ opportunity }: { opportunity: ArbitrageOpportunity }) {
  const strategy = opportunity.bestStrategy;
  if (!strategy || !opportunity.kalshi || !opportunity.polymarket) {
    return null;
  }

  const kalshiBuy =
    strategy.yesPlatform === "kalshi" ? "yes" : strategy.noPlatform === "kalshi" ? "no" : undefined;
  const polyBuy =
    strategy.yesPlatform === "polymarket" ? "yes" : strategy.noPlatform === "polymarket" ? "no" : undefined;
  const yesOutcome = platformYesLabel(opportunity.polymarket.title);
  const kalshiDate = opportunity.kalshi.eventDate ?? null;
  const polyDate = opportunity.polymarket.eventDate ?? null;

  return (
    <Card className="overflow-hidden">
      <div className="h-0.5 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500" />
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600">
                <Zap className="h-3 w-3" />
                +{formatCents(opportunity.bestProfit)} edge
              </span>
              <span className="text-[10px] text-muted-foreground">
                {formatMatchScore(opportunity.matchScore)} title match
              </span>
            </div>
            <CardTitle className="text-sm font-medium leading-snug">{opportunity.title}</CardTitle>
            {kalshiDate && polyDate && (
              <p className="text-[10px] text-muted-foreground">
                Event date: {formatEventDate(kalshiDate)}
                {kalshiDate !== polyDate && (
                  <span className="text-amber-600"> · Poly {formatEventDate(polyDate)}</span>
                )}
              </p>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <StrategyFlow strategy={strategy} />
        <CostBar totalCost={strategy.totalCost} />
        <div className="grid gap-3 sm:grid-cols-2">
          <PlatformQuote
            name="Kalshi"
            accent="kalshi"
            title={opportunity.kalshi.title}
            url={opportunity.kalshi.url}
            yesAsk={opportunity.kalshi.yesAsk ?? 0}
            noAsk={opportunity.kalshi.noAsk ?? 0}
            buySide={kalshiBuy}
            yesOutcome={yesOutcome}
            eventDate={kalshiDate}
          />
          <PlatformQuote
            name="Polymarket"
            accent="poly"
            title={opportunity.polymarket.title}
            url={opportunity.polymarket.url}
            yesAsk={opportunity.polymarket.yesAsk ?? 0}
            noAsk={opportunity.polymarket.noAsk ?? 0}
            buySide={polyBuy}
            yesOutcome={yesOutcome}
            eventDate={polyDate}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function MatchedPairsTable({ rows }: { rows: ScanResult[] }) {
  const matched = rows.filter((row) => row.polymarket && row.matchScore !== null);

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-xs">Market</TableHead>
            <TableHead className="hidden w-24 text-xs sm:table-cell">Date</TableHead>
            <TableHead className="w-14 text-right text-xs">Match</TableHead>
            <TableHead className="hidden w-28 text-right text-xs md:table-cell">Kalshi</TableHead>
            <TableHead className="hidden w-28 text-right text-xs md:table-cell">Poly</TableHead>
            <TableHead className="w-16 text-right text-xs">Edge</TableHead>
            <TableHead className="w-14 text-xs" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {matched.map((row) => {
            const poly = row.polymarket!;
            const date = row.kalshi.eventDate ?? poly.eventDate;
            const profit = row.bestProfit ?? 0;
            const hasEdge = profit >= 0.005;

            return (
              <TableRow key={row.kalshi.id}>
                <TableCell className="max-w-[240px] py-2">
                  <p className="truncate text-xs font-medium" title={row.title}>
                    {row.title}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground md:hidden">
                    K {formatCents(row.kalshi.yesAsk)}/{formatCents(row.kalshi.noAsk)} · P{" "}
                    {formatCents(poly.yesAsk)}/{formatCents(poly.noAsk)}
                  </p>
                </TableCell>
                <TableCell className="hidden py-2 text-xs text-muted-foreground sm:table-cell">
                  {formatEventDate(date) ?? "—"}
                </TableCell>
                <TableCell className="py-2 text-right text-xs tabular-nums text-muted-foreground">
                  {formatMatchScore(row.matchScore!)}
                </TableCell>
                <TableCell className="hidden py-2 text-right text-xs tabular-nums md:table-cell">
                  <span className="text-muted-foreground">Y</span> {formatCents(row.kalshi.yesAsk)}{" "}
                  <span className="text-muted-foreground">N</span> {formatCents(row.kalshi.noAsk)}
                </TableCell>
                <TableCell className="hidden py-2 text-right text-xs tabular-nums md:table-cell">
                  <span className="text-muted-foreground">Y</span> {formatCents(poly.yesAsk)}{" "}
                  <span className="text-muted-foreground">N</span> {formatCents(poly.noAsk)}
                </TableCell>
                <TableCell
                  className={cn(
                    "py-2 text-right text-xs font-medium tabular-nums",
                    hasEdge ? "text-emerald-600" : "text-muted-foreground"
                  )}
                >
                  {profit > 0 ? formatCents(profit) : "—"}
                </TableCell>
                <TableCell className="py-2">
                  <div className="flex items-center justify-end gap-1">
                    <a
                      href={row.kalshi.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Open on Kalshi"
                      title="Kalshi"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <a
                      href={poly.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Open on Polymarket"
                      title="Polymarket"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function WorkInProgressOverlay({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-background/85 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="predictions-wip-title"
      onClick={onDismiss}
    >
      <div
        className="relative w-full max-w-sm cursor-default rounded-xl border bg-card p-8 text-center shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Dismiss and preview"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-purple-500/10">
          <Construction className="h-6 w-6 text-purple-500" />
        </div>
        <h2 id="predictions-wip-title" className="text-lg font-semibold">
          Work in Progress
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Kalshi × Polymarket cross-exchange scanner. Not ready for use yet.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-6">
          <a href="/">Back to Screener</a>
        </Button>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-10 text-center text-sm text-muted-foreground">{message}</CardContent>
    </Card>
  );
}

function StrategyFlow({ strategy }: { strategy: ArbitrageStrategy }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs">
      <span className="font-medium text-foreground">
        {platformLabel(strategy.yesPlatform)} Yes
      </span>
      <span className="rounded bg-background px-1.5 py-0.5 font-semibold tabular-nums">
        {formatCents(strategy.yesPrice)}
      </span>
      <span className="text-muted-foreground">+</span>
      <span className="font-medium text-foreground">
        {platformLabel(strategy.noPlatform)} No
      </span>
      <span className="rounded bg-background px-1.5 py-0.5 font-semibold tabular-nums">
        {formatCents(strategy.noPrice)}
      </span>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="font-semibold tabular-nums">{formatCents(strategy.totalCost)}</span>
      <span className="text-muted-foreground">→ $1.00</span>
    </div>
  );
}

export function PredictionsPage() {
  const [wipDismissed, setWipDismissed] = useState(false);
  const showWipOverlay = SHOW_WIP_OVERLAY && !wipDismissed;

  const dismissWip = useCallback(() => {
    setWipDismissed(true);
  }, []);

  const [opportunities, setOpportunities] = useState<ArbitrageOpportunity[]>([]);
  const [matchedScanResults, setMatchedScanResults] = useState<ScanResult[]>([]);
  const [marketCounts, setMarketCounts] = useState({
    kalshiOpen: 0,
    kalshiSeeds: 0,
    polymarket: 0,
    matched: 0,
  });
  const [kalshiTradingActive, setKalshiTradingActive] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewFilter, setViewFilter] = useState<ViewFilter>("arbs");
  const [minProfitThreshold, setMinProfitThreshold] = useState(0.005);
  const pollTimeoutRef = useRef<number | null>(null);

  const validOpportunities = useMemo(
    () =>
      opportunities.filter(
        (opportunity) => opportunity.bestStrategy && opportunity.kalshi && opportunity.polymarket
      ),
    [opportunities]
  );

  const bestEdge = useMemo(() => {
    if (validOpportunities.length === 0) {
      return null;
    }
    return Math.max(...validOpportunities.map((o) => o.bestProfit));
  }, [validOpportunities]);

  const matchedResults = matchedScanResults;
  const matchedCount = marketCounts.matched || matchedResults.length;

  const thresholdLabel = formatCents(minProfitThreshold);

  const loadPredictions = useCallback(async (isBackground = false) => {
    if (isBackground) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const data = await fetchPredictions({
        limit: 25,
        minProfit: 0.005,
        scanTarget: 500,
      });

      setOpportunities(data.opportunities ?? []);
      setMatchedScanResults(data.matchedScanResults ?? []);
      setMarketCounts({
        kalshiOpen: data.kalshiOpenMarketCount ?? data.kalshiMarketCount ?? 0,
        kalshiSeeds: data.kalshiMarketCount ?? 0,
        polymarket: data.polymarketMarketCount ?? 0,
        matched: data.matchedPairs ?? data.matchedScanResults?.length ?? 0,
      });
      setKalshiTradingActive(data.exchangeStatus?.kalshi?.tradingActive ?? true);
      setMinProfitThreshold(data.minProfitThreshold ?? 0.005);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load predictions");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadPredictions();

    const schedulePoll = () => {
      pollTimeoutRef.current = window.setTimeout(async () => {
        await loadPredictions(true);
        schedulePoll();
      }, POLL_INTERVAL_MS);
    };

    schedulePoll();

    return () => {
      if (pollTimeoutRef.current !== null) {
        window.clearTimeout(pollTimeoutRef.current);
      }
    };
  }, [loadPredictions]);

  return (
    <div className="relative min-h-screen bg-background">
      <div className={cn(showWipOverlay && "pointer-events-none select-none blur-[2px]")}>
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <a
              href="/"
              className="shrink-0 rounded p-1 transition-all hover:bg-accent hover:opacity-80"
              aria-label="Back to Screener"
              title="Back to Screener"
            >
              <img src="/Screener.svg" alt="Screener logo" className="h-6 w-6" />
            </a>
            <div className="min-w-0">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-purple-500" />
              <h1 className="text-sm font-semibold">Predictions</h1>
              {isRefreshing && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadPredictions(true)}
              disabled={isLoading || isRefreshing}
              aria-label="Refresh now"
            >
              {isRefreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-5">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-purple-500" />
            <p>Scanning Kalshi and Polymarket…</p>
          </div>
        ) : error ? (
          <Card className="border-destructive/30">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertCircle className="h-4 w-4 text-destructive" />
                Unable to load scan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>{error}</p>
              <Button variant="outline" size="sm" onClick={() => void loadPredictions()}>
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatCard
                label="Kalshi"
                value={marketCounts.kalshiOpen}
                sub={`${marketCounts.kalshiSeeds} seeds scanned`}
              />
              <StatCard label="Polymarket" value={marketCounts.polymarket} sub="markets scanned" />
              <StatCard
                label="Opportunities"
                value={validOpportunities.length}
                sub="≥ 0.5¢ edge"
                highlight={validOpportunities.length > 0}
              />
              <StatCard
                label="Best edge"
                value={bestEdge !== null ? formatCents(bestEdge) : "n/a"}
                sub="before fees"
                highlight={bestEdge !== null && bestEdge >= 0.05}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Arb when{" "}
              <span className="font-medium text-foreground">Yes</span> on one platform and{" "}
              <span className="font-medium text-foreground">No</span> on the other cost under $1.00.
              Matched = cross-listed on Kalshi and Polymarket.
              {!kalshiTradingActive && (
                <span className="ml-1 text-amber-600">Kalshi trading inactive.</span>
              )}
            </p>

            <div className="space-y-1.5">
              <div className="inline-flex flex-nowrap rounded-lg border bg-muted/40 p-0.5">
                <button
                  type="button"
                  onClick={() => setViewFilter("arbs")}
                  className={cn(
                    "whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                    viewFilter === "arbs"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  ≥ {thresholdLabel} edge
                  <span className="ml-1 tabular-nums text-muted-foreground">
                    ({validOpportunities.length})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewFilter("raw")}
                  className={cn(
                    "whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                    viewFilter === "raw"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Matched
                  <span className="ml-1 tabular-nums text-muted-foreground">
                    ({matchedCount})
                  </span>
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {viewFilter === "arbs"
                  ? "Profitable pairs only."
                  : matchedCount === 0
                    ? "No cross-listed contracts in this scan."
                    : `${matchedCount} cross-listed of ${marketCounts.kalshiSeeds} Kalshi seeds scanned.`}
              </p>
            </div>

            {viewFilter === "arbs" && (
              <>
                {validOpportunities.length > 0 ? (
                  <div className="space-y-3">
                    {validOpportunities.map((opportunity) => (
                      <ArbitrageCard
                        key={`${opportunity.kalshi.id}-${opportunity.polymarket.id}`}
                        opportunity={opportunity}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    message={`No arbs ≥ ${thresholdLabel}. ${matchedCount} matched pair${matchedCount === 1 ? "" : "s"} — prices may already be aligned.`}
                  />
                )}
              </>
            )}

            {viewFilter === "raw" && (
              <>
                {matchedResults.length > 0 ? (
                  <MatchedPairsTable rows={matchedResults} />
                ) : (
                  <EmptyState message="No matched markets in this scan." />
                )}
              </>
            )}

            <p className="pb-4 text-center text-[10px] text-muted-foreground">
              <a
                href="https://docs.kalshi.com/api-reference/exchange/get-exchange-status"
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:underline"
              >
                Kalshi
              </a>
              {" · "}
              <a
                href="https://docs.polymarket.com/api-reference/introduction"
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:underline"
              >
                Polymarket
              </a>
            </p>
          </>
        )}
      </main>
      </div>

      {showWipOverlay && <WorkInProgressOverlay onDismiss={dismissWip} />}
    </div>
  );
}
