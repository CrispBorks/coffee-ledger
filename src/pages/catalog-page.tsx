import * as React from "react";
import { ArrowUpDownIcon, SearchIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EntryCard } from "@/components/entry-card";
import { LedgerUnreachable, LegacyImportBanner } from "@/components/ledger-status";
import { PageShell, SiteFooter } from "@/components/page-shell";
import { SiteHeader } from "@/components/site-header";
import { Skeleton } from "@/components/ui/skeleton";
import { matchesQuery, useLedger } from "@/lib/ledger";

type Sort = "newest" | "oldest" | "name" | "starred";

const SORT_LABELS: Record<Sort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  name: "A–Z",
  starred: "Starred shots first",
};

export function CatalogPage() {
  const { entries, status, loadError } = useLedger();
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<Sort>("newest");

  React.useEffect(() => {
    document.title = "Coffee Ledger";
  }, []);

  const results = React.useMemo(() => {
    const filtered = entries.filter((e) => matchesQuery(e, query));
    const sorted = [...filtered];
    if (sort === "newest") sorted.sort((a, b) => b.createdAt - a.createdAt);
    else if (sort === "oldest") sorted.sort((a, b) => a.createdAt - b.createdAt);
    else if (sort === "name")
      sorted.sort((a, b) => a.coffee.localeCompare(b.coffee));
    else if (sort === "starred")
      sorted.sort(
        (a, b) =>
          b.shots.filter((s) => s.starred).length -
          a.shots.filter((s) => s.starred).length,
      );
    return sorted;
  }, [entries, query, sort]);

  const filtersActive = query.trim() !== "";

  return (
    <PageShell>
      <SiteHeader />

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search coffees, roasters, origins…"
          aria-label="Search the ledger"
          className="h-12 pl-10 font-mono placeholder:text-muted-foreground"
        />
      </div>

      <div className="mt-5 mb-4 flex items-center justify-between gap-3">
        <p className="meta-mono min-w-0 truncate text-muted-foreground">
          {status === "loading"
            ? "Reading the ledger…"
            : `${results.length} ${results.length === 1 ? "coffee" : "coffees"}`}
        </p>

        <div className="flex shrink-0 items-center gap-2">
          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={() => setQuery("")}>
              <XIcon />
              Clear
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <ArrowUpDownIcon />
                Sort order
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(v) => setSort(v as Sort)}
              >
                {(Object.keys(SORT_LABELS) as Sort[]).map((key) => (
                  <DropdownMenuRadioItem key={key} value={key}>
                    {SORT_LABELS[key]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <LegacyImportBanner />

      {/* Three states the file-backed ledger never had: still reading, and
          couldn't read. An empty grid must not stand in for either — "you have
          no coffees" is the one thing an unanswered read doesn't tell us. */}
      {status === "loading" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[132px]" />
          ))}
        </div>
      ) : status === "unreachable" ? (
        <LedgerUnreachable error={loadError} />
      ) : results.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-[15px] text-muted-foreground">
          {entries.length === 0
            ? "No coffees logged yet. Add your first one to start tracking."
            : "Nothing in the ledger matches that search."}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {results.map((entry) => (
            <EntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      <SiteFooter />
    </PageShell>
  );
}
