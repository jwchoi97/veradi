// FILE: frontend/src/components/projects/ProjectListTable.tsx

import React, { useEffect, useMemo, useState } from "react";
import type { Project } from "@/data/files/api";
import { daysLeft, isDueSoon, isPastProject } from "./projectDeadline";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function buildPagination(totalPages: number, currentPage: number) {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const pages: Array<number | "..."> = [];
  const last = totalPages;

  pages.push(1);

  const start = clamp(currentPage - 1, 2, last - 1);
  const end = clamp(currentPage + 1, 2, last - 1);

  if (start > 2) pages.push("...");
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < last - 1) pages.push("...");
  pages.push(last);

  const dedup: Array<number | "..."> = [];
  for (const item of pages) {
    const prev = dedup[dedup.length - 1];
    if (item === prev) continue;
    dedup.push(item);
  }

  if (dedup.length >= 3 && dedup[1] === "..." && dedup[2] === 2) dedup.splice(1, 1);
  const n = dedup.length;
  if (n >= 3 && dedup[n - 2] === "..." && dedup[n - 3] === last - 1) dedup.splice(n - 2, 1);

  return dedup;
}

export type ViewOption = "진행중인 프로젝트만" | "모두 보기";

export type ProjectListTableRenderArgs = {
  filteredProjects: Project[];
  pageProjects: Array<Project | null>;
  page: number;
  totalPages: number;
};

function fmtDate(v: unknown): string {
  if (!v) return "-";
  const s = String(v);
  return s.includes("T") ? s.split("T")[0] : s;
}

export default function ProjectListTable({
  title = "프로젝트 목록",
  projects,
  years,
  subjects,
  viewOptions,
  actionHeader,
  renderAction,
  pageSize = 10,

  // optional expandable rows
  leadingHeader,
  renderLeadingCell,
  isExpanded,
  onToggleExpand,
  renderExpandedRow,

  // selectable rows (checkbox)
  selectable,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}: {
  title?: string;
  projects: Project[];
  years: string[];
  subjects: string[];
  viewOptions: ViewOption[];

  actionHeader: string;
  renderAction: (p: Project) => React.ReactNode;

  pageSize?: number;

  leadingHeader?: React.ReactNode;
  renderLeadingCell?: (p: Project) => React.ReactNode;
  isExpanded?: (p: Project) => boolean;
  onToggleExpand?: (p: Project) => void;
  renderExpandedRow?: (p: Project) => React.ReactNode;

  selectable?: boolean;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
  onToggleSelectAll?: (idsOnPage: number[]) => void;
}) {
  const [year, setYear] = useState("전체");
  const [subject, setSubject] = useState("전체");
  const [viewOption, setViewOption] = useState<ViewOption>(viewOptions[0]);
  const [page, setPage] = useState(1);

  const filteredProjects = useMemo(() => {
    const filterOngoing = viewOption === "진행중인 프로젝트만";

    let list = projects.filter((p) => {
      const py = (p as any).year;
      if (year !== "전체" && py !== year) return false;
      if (subject !== "전체" && p.subject !== subject) return false;

      // Ongoing 판단은 "최종 마감일" 기준
      const finalDeadline = (p as any).deadline_final ?? (p as any).deadline;
      if (filterOngoing && isPastProject(finalDeadline)) return false;

      return true;
    });

    if (filterOngoing) {
      list = [...list].sort((a, b) => {
        const da = (a as any).deadline_final ?? (a as any).deadline;
        const db = (b as any).deadline_final ?? (b as any).deadline;

        const la = daysLeft(da);
        const lb = daysLeft(db);
        const va = la == null ? Number.POSITIVE_INFINITY : la;
        const vb = lb == null ? Number.POSITIVE_INFINITY : lb;
        if (va !== vb) return va - vb;
        return b.id - a.id;
      });
    }

    return list;
  }, [projects, year, subject, viewOption]);

  useEffect(() => {
    setPage(1);
  }, [year, subject, viewOption, projects.length]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredProjects.length / pageSize)),
    [filteredProjects.length, pageSize]
  );

  useEffect(() => {
    setPage((prev) => Math.min(Math.max(1, prev), totalPages));
  }, [totalPages]);

  const pagedProjects = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredProjects.slice(start, start + pageSize);
  }, [filteredProjects, page, pageSize]);

  const paddedProjects = useMemo(() => {
    const arr: Array<Project | null> = [...pagedProjects];
    while (arr.length < pageSize) arr.push(null);
    return arr;
  }, [pagedProjects, pageSize]);

  const paginationItems = useMemo(() => buildPagination(totalPages, page), [totalPages, page]);

  const goPrev = () => setPage((v) => Math.max(1, v - 1));
  const goNext = () => setPage((v) => Math.min(totalPages, v + 1));

  const idsOnPage = useMemo(() => pagedProjects.map((p) => p.id), [pagedProjects]);
  const allSelectedOnPage = useMemo(() => {
    if (!selectable || !selectedIds) return false;
    if (idsOnPage.length === 0) return false;
    return idsOnPage.every((id) => selectedIds.has(id));
  }, [selectable, selectedIds, idsOnPage]);

  const someSelectedOnPage = useMemo(() => {
    if (!selectable || !selectedIds) return false;
    return idsOnPage.some((id) => selectedIds.has(id)) && !allSelectedOnPage;
  }, [selectable, selectedIds, idsOnPage, allSelectedOnPage]);

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      {/* filters */}
      <div className="flex flex-wrap items-end gap-4 mb-3">
        <LabeledSelect label="학년도 선택" value={year} onChange={setYear} options={years} />
        <LabeledSelect label="과목 선택" value={subject} onChange={setSubject} options={subjects} />
        <LabeledSelect
          label="보기 옵션"
          value={viewOption}
          onChange={(v) => setViewOption(v as ViewOption)}
          options={viewOptions}
        />
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="text-xs text-gray-500">
          {filteredProjects.length}개 · {page}/{totalPages} 페이지
        </div>
      </div>

      <div className="h-[560px] overflow-y-auto border-t" style={{ scrollbarGutter: "stable" as any }}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              {selectable ? (
                <th className="w-10 px-2">
                  <input
                    type="checkbox"
                    checked={allSelectedOnPage}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelectedOnPage;
                    }}
                    onChange={() => onToggleSelectAll?.(idsOnPage)}
                    aria-label="Select all on page"
                  />
                </th>
              ) : null}

              {renderLeadingCell ? <th className="w-8">{leadingHeader ?? ""}</th> : null}
              <th className="text-left px-3 py-2">프로젝트명</th>
              <th className="text-left px-3 py-2">카테고리</th>
              <th className="text-left px-3 py-2">과목</th>
              <th className="text-left px-3 py-2">학년도</th>
              <th className="text-left px-3 py-2">마감일</th>
              <th className="text-left px-3 py-2">{actionHeader}</th>
            </tr>
          </thead>

          <tbody>
            {paddedProjects.map((p, idx) => {
              if (!p) {
                return (
                  <tr key={`ph-${idx}`} className="border-t">
                    {selectable ? (
                      <td className="px-2 py-2">
                        <span className="text-transparent">□</span>
                      </td>
                    ) : null}

                    {renderLeadingCell ? (
                      <td className="px-2 py-2">
                        <span className="text-transparent">▸</span>
                      </td>
                    ) : null}

                    <td className="px-3 py-2">
                      <span className="text-transparent">placeholder</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-transparent">placeholder</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-transparent">placeholder</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-transparent">placeholder</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-transparent">placeholder</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-transparent">placeholder</span>
                    </td>
                  </tr>
                );
              }

              const finalDeadline = (p as any).deadline_final ?? (p as any).deadline;
              const dueSoon = isDueSoon(finalDeadline);
              const left = daysLeft(finalDeadline);
              const open = isExpanded ? isExpanded(p) : false;
              const checked = selectable && selectedIds ? selectedIds.has(p.id) : false;

              return (
                <React.Fragment key={p.id}>
                  <tr className={["border-t hover:bg-gray-50", dueSoon ? "bg-yellow-50" : ""].join(" ")}>
                    {selectable ? (
                      <td className="px-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleSelect?.(p.id)}
                          aria-label={`Select project ${p.id}`}
                        />
                      </td>
                    ) : null}

                    {renderLeadingCell ? (
                      <td className="px-2">
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleExpand?.(p);
                          }}
                        >
                          {renderLeadingCell(p)}
                        </div>
                      </td>
                    ) : null}

                    <td className="px-3 py-2">{p.name}</td>
                    <td className="px-3 py-2">{(p as any).category ?? "기타"}</td>
                    <td className="px-3 py-2">{p.subject}</td>
                    <td className="px-3 py-2">{(p as any).year ?? "-"}</td>

                    <td className="px-3 py-2">
                      <div className="space-y-0.5">
                        <div className="text-xs text-gray-600">
                          1차: <span className="text-gray-900">{fmtDate((p as any).deadline_1)}</span>
                        </div>
                        <div className="text-xs text-gray-600">
                          2차: <span className="text-gray-900">{fmtDate((p as any).deadline_2)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-600">
                            최종: <span className="text-gray-900">{fmtDate((p as any).deadline_final)}</span>
                          </span>
                          {dueSoon && left != null && (
                            <span className="text-red-600 font-extrabold text-xs">D-{left}</span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      {renderAction(p)}
                    </td>
                  </tr>

                  {open && renderExpandedRow ? (
                    <tr className="bg-gray-50">
                      <td
                        colSpan={(selectable ? 1 : 0) + (renderLeadingCell ? 1 : 0) + 6}
                        className="px-3 py-3"
                      >
                        {renderExpandedRow(p)}
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* pagination */}
      <div className="flex items-center justify-between pt-3">
        <div className="text-xs text-gray-500">
          {filteredProjects.length}개 중{" "}
          {filteredProjects.length === 0 ? 0 : (page - 1) * pageSize + 1}~
          {Math.min(page * pageSize, filteredProjects.length)} 표시
        </div>

        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40"
            disabled={page <= 1}
            onClick={goPrev}
          >
            Prev
          </button>

          <div className="flex items-center gap-1">
            {paginationItems.map((it, i) =>
              it === "..." ? (
                <span key={`el-${i}`} className="px-2 text-sm text-gray-400">
                  ...
                </span>
              ) : (
                <button
                  key={`p-${it}`}
                  className={[
                    "min-w-9 px-2 py-1.5 rounded-lg border text-sm",
                    it === page ? "bg-gray-100" : "bg-white hover:bg-gray-50",
                  ].join(" ")}
                  onClick={() => setPage(it)}
                  aria-current={it === page ? "page" : undefined}
                >
                  {it}
                </button>
              )
            )}
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
    </section>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex flex-col w-48">
      <span className="text-sm text-gray-600 mb-1">{label}</span>
      <select
        className="h-9 border rounded-md px-2 text-sm focus:border-indigo-600"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
