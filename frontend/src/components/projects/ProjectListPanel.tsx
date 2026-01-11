import React, { useMemo } from "react";

type ProjectLike = {
  id: number | string;
  name: string;
  subject?: string | null;
  year?: string | null;
};

type Props = {
  projects: ProjectLike[];
  page: number; // 1-based
  pageSize?: number; // default 10
  onPageChange: (nextPage: number) => void;

  title?: string; // optional panel title
  fixedHeightPx?: number; // default 520
  rowHeightPx?: number; // default 52
};

export default function ProjectListPanel({
  projects,
  page,
  pageSize = 10,
  onPageChange,
  title = "Projects",
  fixedHeightPx = 520,
  rowHeightPx = 52,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(projects.length / pageSize));

  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return projects.slice(start, start + pageSize);
  }, [projects, page, pageSize]);

  // Keep the frame fixed by padding to pageSize rows
  const paddedItems = useMemo(() => {
    const arr: Array<ProjectLike | null> = [...pageItems];
    while (arr.length < pageSize) arr.push(null);
    return arr;
  }, [pageItems, pageSize]);

  const goPrev = () => onPageChange(Math.max(1, page - 1));
  const goNext = () => onPageChange(Math.min(totalPages, page + 1));
  const goFirst = () => onPageChange(1);
  const goLast = () => onPageChange(totalPages);

  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-gray-500">
          {projects.length} total · Page {page}/{totalPages}
        </div>
      </div>

      <div className="px-2 py-2">
        {/* fixed frame */}
        <div
          className="overflow-hidden"
          style={{ height: `${fixedHeightPx}px` }}
        >
          <ul className="divide-y">
            {paddedItems.map((p, idx) => (
              <li
                key={idx}
                className="flex items-center px-3"
                style={{ height: `${rowHeightPx}px` }}
              >
                {p ? (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {p.name}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {p.subject ?? "-"}
                      </div>
                    </div>
                    <div className="text-xs text-gray-400 ml-3 shrink-0">
                      {p.year ?? "-"}
                    </div>
                  </>
                ) : (
                  // Placeholder row to keep layout fixed
                  <div className="w-full select-none text-transparent text-sm">
                    placeholder
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* pagination */}
        <div className="flex items-center justify-between px-2 pt-3">
          <button
            className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40"
            disabled={page <= 1}
            onClick={goPrev}
          >
            Prev
          </button>

          <div className="flex items-center gap-2 text-sm">
            <button
              className="px-2 py-1 rounded-lg border disabled:opacity-40"
              disabled={page <= 1}
              onClick={goFirst}
              title="First page"
            >
              1
            </button>
            <span className="text-gray-400">…</span>
            <span className="px-2 py-1 rounded-lg bg-gray-100">{page}</span>
            <span className="text-gray-400">…</span>
            <button
              className="px-2 py-1 rounded-lg border disabled:opacity-40"
              disabled={page >= totalPages}
              onClick={goLast}
              title="Last page"
            >
              {totalPages}
            </button>
          </div>

          <button
            className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40"
            disabled={page >= totalPages}
            onClick={goNext}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
