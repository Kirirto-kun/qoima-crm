"use client";

import { Button } from "@/components/ui/button";
import { plural } from "@/lib/utils";
import { ChevronDown, ChevronsDown, Loader2 } from "lucide-react";

export function LoadMore({
  shown,
  total,
  hasMore,
  onMore,
  onAll,
  loading,
}: {
  shown: number;
  total: number;
  hasMore: boolean;
  onMore: () => void;
  onAll: () => void;
  loading?: boolean;
}) {
  if (total === 0) return null;

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 py-3 border-t border-hairline">
      <span className="text-[12px] text-ink-3 tabular-nums">
        Показано {shown} из {total}{" "}
        {plural(total, "записи", "записей", "записей")}
      </span>
      {hasMore && (
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onMore} disabled={loading}>
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            Показать ещё
          </Button>
          <Button variant="ghost" size="sm" onClick={onAll} disabled={loading}>
            <ChevronsDown className="h-3.5 w-3.5" />
            Показать все
          </Button>
        </div>
      )}
    </div>
  );
}
