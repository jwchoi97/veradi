import React, { useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { Camera, Save, Loader2, X, Search } from "lucide-react";
import { getAuthedUser, setAuthedUser } from "@/auth";
import {
  getCurrentUserInfo,
  updateUserInfo,
  getUserContributions,
  getContributionDetails,
  getMyLaborEstimate,
  uploadProfileImage,
  deleteProfileImage,
  type UserInfo,
  type ContributionStats,
  type ContributionDetailItem,
  type MyLaborEstimate,
} from "@/data/files/api";
import { prettyDepartment } from "@/data/departments";

export type ContributionDetailCategory =
  | "individual_upload"
  | "individual_review"
  | "content_upload"
  | "content_review";

const CONTENT_FILE_TYPES = ["문제지", "해설지", "정오표"];

function filterItemsByCategory(
  items: ContributionDetailItem[],
  category: ContributionDetailCategory
): ContributionDetailItem[] {
  return items.filter((item) => {
    if (category === "individual_upload") return item.contribution_type === "upload" && item.file_type === "개별문항";
    if (category === "individual_review") return item.contribution_type === "review" && item.file_type === "개별문항";
    if (category === "content_upload") return item.contribution_type === "upload" && item.file_type != null && CONTENT_FILE_TYPES.includes(item.file_type);
    if (category === "content_review") return item.contribution_type === "review" && item.file_type != null && CONTENT_FILE_TYPES.includes(item.file_type);
    return false;
  });
}

function getCategoryLabel(category: ContributionDetailCategory): string {
  const labels: Record<ContributionDetailCategory, string> = {
    individual_upload: "개별 문항 (업로드)",
    individual_review: "개별 문항 (검토)",
    content_upload: "콘텐츠 (업로드)",
    content_review: "콘텐츠 (검토)",
  };
  return labels[category];
}

function getInitials(name?: string | null): string {
  if (!name || name.trim().length === 0) return "?";
  const trimmed = name.trim();
  
  // 한글 이름인지 확인 (가-힣 범위)
  const isKorean = /[가-힣]/.test(trimmed);
  
  if (isKorean && trimmed.length >= 3) {
    // 한국인 이름: 성(첫 글자) + 이름 첫 글자(두 번째 글자)
    // 예: "홍길동" → "홍길", "김철수" → "김철"
    return trimmed.slice(0, 2);
  } else if (trimmed.length >= 2) {
    // 영문 이름 또는 2글자 한글 이름: 처음 2글자
    return trimmed.slice(0, 2).toUpperCase();
  }
  return trimmed.toUpperCase();
}

type YearMonthOption = { key: string; year: string; month: number; label: string };

function getPeriodOptionsFrom2026(): YearMonthOption[] {
  const now = new Date();
  const options: YearMonthOption[] = [];
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  const min = new Date(2026, 0, 1); // 2026-01

  while (cursor >= min) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth() + 1;
    options.push({
      key: `${y}-${m}`,
      year: String(y),
      month: m,
      label: `${y}년 ${m}월`,
    });
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return options;
}

function ContributionDetailRow({ item }: { item: ContributionDetailItem }) {
  const dateStr = item.date ? new Date(item.date).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" }) : "-";
  return (
    <li className="rounded-lg px-3 py-2.5 text-left hover:bg-white/80">
      <div className="min-w-0">
        <div className="truncate font-medium text-gray-900">{item.file_name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0 text-xs text-gray-500">
          {item.file_type && <span>{item.file_type}</span>}
          {item.project_name && <span>· {item.project_name}</span>}
          {item.project_year && <span>({item.project_year}년)</span>}
          <span>· {dateStr}</span>
        </div>
      </div>
    </li>
  );
}

function ContributionDetailModal({
  open,
  onClose,
  category,
  yearLabel,
  items,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  category: ContributionDetailCategory | null;
  yearLabel: string;
  items: ContributionDetailItem[];
  loading: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  useEffect(() => {
    if (open) setSearchQuery("");
  }, [open]);

  const filteredItems = useMemo(() => {
    if (!category) return [];
    const byCategory = filterItemsByCategory(items, category);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return byCategory;
    return byCategory.filter((item) => (item.file_name || "").toLowerCase().includes(q));
  }, [items, category, searchQuery]);

  if (!open) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative flex h-[70vh] w-full max-w-4xl flex-col rounded-2xl border border-gray-200 bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
          <h3 className="text-lg font-semibold text-gray-900">
            {category ? getCategoryLabel(category) : ""} · {yearLabel}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="shrink-0 border-b border-gray-100 px-4 py-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="파일 이름으로 검색..."
              className="w-full rounded-xl border border-gray-300 py-2 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              목록 불러오는 중...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">
              {searchQuery.trim() ? "검색어에 맞는 항목이 없습니다." : "해당 항목이 없습니다."}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {filteredItems.map((item) => (
                <ContributionDetailRow key={`${item.contribution_type}-${item.file_id}`} item={item} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

function ContributionChart({
  stat,
  onOpenDetail,
}: {
  stat: ContributionStats | null;
  onOpenDetail?: (category: ContributionDetailCategory) => void;
}) {
  const noop = () => {};
  const openDetail = onOpenDetail ?? noop;

  if (!stat) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
        기여도 데이터가 없습니다.
      </div>
    );
  }

  const indReview = stat.individual_items_review_count ?? 0;
  const contentReview = stat.content_review_count ?? 0;
  const rows: Array<{
    key: ContributionDetailCategory;
    label: string;
    count: number;
  }> = [
    { key: "individual_upload", label: "개별 문항 (업로드)", count: stat.individual_items_count },
    { key: "individual_review", label: "개별 문항 (검토)", count: indReview },
    { key: "content_upload", label: "콘텐츠 (업로드)", count: stat.content_files_count },
    { key: "content_review", label: "콘텐츠 (검토)", count: contentReview },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="px-4 py-2 text-left font-medium">항목</th>
            <th className="px-4 py-2 text-right font-medium">개수</th>
            <th className="px-4 py-2 text-right font-medium">상세</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr key={row.key} className="bg-white">
              <td className="px-4 py-2 text-gray-800">{row.label}</td>
              <td className="px-4 py-2 text-right font-medium text-gray-900">{row.count}개</td>
              <td className="px-4 py-2 text-right">
                {row.count > 0 ? (
                  <button
                    type="button"
                    onClick={() => openDetail(row.key)}
                    className="text-indigo-600 underline hover:no-underline"
                  >
                    자세히 보기
                  </button>
                ) : (
                  <span className="text-gray-400">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MyPage() {
  const me = getAuthedUser();

  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [allContributions, setAllContributions] = useState<ContributionStats[]>([]);
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [contributionsLoading, setContributionsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", phone_number: "" });
  const [saving, setSaving] = useState(false);

  const [profileImageLoading, setProfileImageLoading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [detailModalCategory, setDetailModalCategory] = useState<ContributionDetailCategory | null>(null);
  const [detailItems, setDetailItems] = useState<ContributionDetailItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [laborEstimate, setLaborEstimate] = useState<MyLaborEstimate | null>(null);
  const [laborEstimateLoading, setLaborEstimateLoading] = useState(false);
  const periodOptions = useMemo(() => getPeriodOptionsFrom2026(), []);
  const [selectedLaborPeriodKey, setSelectedLaborPeriodKey] = useState(periodOptions[0]?.key ?? "");
  const [selectedContributionPeriodKey, setSelectedContributionPeriodKey] = useState(periodOptions[0]?.key ?? "");
  const selectedLaborPeriod = useMemo(
    () => periodOptions.find((opt) => opt.key === selectedLaborPeriodKey) ?? null,
    [periodOptions, selectedLaborPeriodKey]
  );
  const isCurrentLaborPeriod = useMemo(() => {
    if (!selectedLaborPeriod) return false;
    const now = new Date();
    return (
      Number(selectedLaborPeriod.year) === now.getFullYear() &&
      selectedLaborPeriod.month === now.getMonth() + 1
    );
  }, [selectedLaborPeriod]);

  useEffect(() => {
    void loadUserInfo();
  }, []);

  const formatWon = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;

  const loadUserInfo = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getCurrentUserInfo();
      setUserInfo(data);
      setEditForm({
        name: data.name || "",
        phone_number: data.phone_number || "",
      });
      return data;
    } catch (e) {
      console.error(e);
      setError("유저 정보를 불러오는 데 실패했습니다.");
      return null;
    } finally {
      setLoading(false);
    }
  };

  const loadContributions = async (year?: string, month?: number) => {
    try {
      setContributionsLoading(true);
      const data = await getUserContributions(year, month);
      setAllContributions(data);
    } catch (e) {
      console.error(e);
      // 기여도 로딩 실패는 조용히 처리
    } finally {
      setContributionsLoading(false);
    }
  };

  const loadMyLaborEstimate = async (year?: string, month?: number) => {
    try {
      setLaborEstimateLoading(true);
      const data = await getMyLaborEstimate(year, month);
      setLaborEstimate(data);
    } catch (e) {
      console.error(e);
      setLaborEstimate(null);
    } finally {
      setLaborEstimateLoading(false);
    }
  };

  useEffect(() => {
    const selected = periodOptions.find((opt) => opt.key === selectedLaborPeriodKey);
    if (!selected) return;
    void loadMyLaborEstimate(selected.year, selected.month);
  }, [selectedLaborPeriodKey, periodOptions]);

  useEffect(() => {
    const selected = periodOptions.find((opt) => opt.key === selectedContributionPeriodKey);
    if (!selected) return;
    setSelectedYear(selected.year);
    void loadContributions(selected.year, selected.month);
  }, [selectedContributionPeriodKey, periodOptions]);

  // 선택된 년도에 해당하는 기여도 데이터
  const currentContribution = useMemo(() => {
    if (!selectedYear) return null;
    return allContributions.find((c) => c.year === selectedYear) || null;
  }, [selectedYear, allContributions]);

  const loadDetail = async () => {
    try {
      setDetailLoading(true);
      const selected = periodOptions.find((opt) => opt.key === selectedContributionPeriodKey);
      const data = await getContributionDetails(selected?.year, selected?.month);
      setDetailItems(data);
    } catch (e) {
      console.error(e);
      setDetailItems([]);
    } finally {
      setDetailLoading(false);
    }
  };

  const openDetailModal = (category: ContributionDetailCategory) => {
    setDetailModalCategory(category);
    void loadDetail();
  };

  const closeDetailModal = () => setDetailModalCategory(null);

  // 연도 변경 시 모달이 열려 있으면 목록 다시 로드
  useEffect(() => {
    if (detailModalCategory != null) void loadDetail();
  }, [selectedContributionPeriodKey]);

  const handleSave = async () => {
    if (!userInfo) return;

    try {
      setSaving(true);
      setError(null);

      const updated = await updateUserInfo({
        name: editForm.name.trim() || undefined,
        phone_number: editForm.phone_number.trim() || undefined,
      });

      setUserInfo(updated);
      setIsEditing(false);

      // 로컬 스토리지의 유저 정보도 업데이트
      const currentUser = getAuthedUser();
      if (currentUser) {
        setAuthedUser({
          ...currentUser,
          name: updated.name || currentUser.name,
        });
      }
    } catch (e: any) {
      console.error(e);
      setError(e?.response?.data?.detail || "정보 업데이트에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleProfileImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userInfo) return;

    // 이미지 파일만 허용
    if (!file.type.startsWith("image/")) {
      setError("이미지 파일만 업로드할 수 있습니다.");
      return;
    }

    try {
      setProfileImageLoading(true);
      setError(null);

      const result = await uploadProfileImage(file);
      const updatedUserInfo = await loadUserInfo(); // 유저 정보 다시 로드

      // 로컬 스토리지의 유저 정보도 업데이트
      const currentUser = getAuthedUser();
      if (currentUser && updatedUserInfo) {
        setAuthedUser({
          ...currentUser,
          profile_image_url: updatedUserInfo.profile_image_url || null,
        });
      }
    } catch (e: any) {
      console.error(e);
      setError(e?.response?.data?.detail || "프로필 이미지 업로드에 실패했습니다.");
    } finally {
      setProfileImageLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDeleteProfileImage = async () => {
    if (!userInfo || !userInfo.profile_image_url) return;

    if (!confirm("프로필 사진을 삭제하고 기본 아바타로 되돌리시겠습니까?")) {
      return;
    }

    try {
      setProfileImageLoading(true);
      setError(null);

      await deleteProfileImage();
      const updatedUserInfo = await loadUserInfo(); // 유저 정보 다시 로드

      // 로컬 스토리지의 유저 정보도 업데이트
      const currentUser = getAuthedUser();
      if (currentUser && updatedUserInfo) {
        setAuthedUser({
          ...currentUser,
          profile_image_url: null,
        });
      }
    } catch (e: any) {
      console.error(e);
      setError(e?.response?.data?.detail || "프로필 이미지 삭제에 실패했습니다.");
    } finally {
      setProfileImageLoading(false);
    }
  };

  const profileImageUrl = userInfo?.profile_image_url;
  const displayName = userInfo?.name || userInfo?.username || "Unknown";
  const initials = getInitials(userInfo?.name || userInfo?.username);

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-64px)] items-center justify-center">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  if (!userInfo) {
    return (
      <div className="flex min-h-[calc(100vh-64px)] items-center justify-center">
        <div className="text-red-500">유저 정보를 불러올 수 없습니다.</div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-[calc(100vh-64px)] px-4 md:px-6 py-4 text-gray-900 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">마이 페이지</h1>
        <p className="mt-1 text-sm text-gray-600">계정 정보와 기여도를 확인하고 관리합니다.</p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 프로필 정보 섹션 */}
        <div className="lg:col-span-1 space-y-6">
          <section className="rounded-3xl border border-slate-200/60 bg-white/80 p-6 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur">
            <div className="flex flex-col items-center">
              <div className="relative">
                {profileImageUrl ? (
                  <img
                    src={profileImageUrl}
                    alt={displayName}
                    className="h-24 w-24 rounded-full object-cover border-2 border-gray-200"
                  />
                ) : (
                  <div className="h-24 w-24 rounded-full bg-indigo-600 flex items-center justify-center text-white text-2xl font-semibold border-2 border-gray-200">
                    {initials}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={profileImageLoading}
                  className="absolute bottom-0 right-0 h-8 w-8 rounded-full bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 disabled:opacity-50 shadow-md"
                  title="프로필 사진 변경"
                >
                  {profileImageLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                </button>
                {profileImageUrl && (
                  <button
                    type="button"
                    onClick={handleDeleteProfileImage}
                    disabled={profileImageLoading}
                    className="absolute top-0 right-0 h-8 w-8 rounded-full bg-red-600 text-white flex items-center justify-center hover:bg-red-700 disabled:opacity-50 shadow-md"
                    title="프로필 사진 삭제"
                  >
                    {profileImageLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <X className="h-4 w-4" />
                    )}
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleProfileImageUpload}
                  className="hidden"
                />
              </div>

              <h2 className="mt-4 text-xl font-semibold">{displayName}</h2>
              <p className="text-sm text-gray-500">@{userInfo.username}</p>
            </div>

            <div className="mt-6 space-y-4 border-t pt-6">
              {isEditing ? (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">이름</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                      placeholder="이름"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">전화번호</label>
                    <input
                      type="tel"
                      value={editForm.phone_number}
                      onChange={(e) =>
                        setEditForm((prev) => ({ ...prev, phone_number: e.target.value }))
                      }
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                      placeholder="010-1234-5678"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditing(false);
                        setEditForm({
                          name: userInfo.name || "",
                          phone_number: userInfo.phone_number || "",
                        });
                      }}
                      className="flex-1 rounded-xl border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
                      disabled={saving}
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving}
                      className="flex-1 rounded-xl bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          저장 중...
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4" />
                          저장
                        </>
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">이름</label>
                    <div className="text-sm text-gray-900">{userInfo.name || "-"}</div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-500 mb-1">전화번호</label>
                    <div className="text-sm text-gray-900">{userInfo.phone_number || "-"}</div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-500 mb-1">역할</label>
                    <div className="text-sm text-gray-900">{userInfo.role}</div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-500 mb-1">소속팀</label>
                    <div className="text-sm text-gray-900">
                      {userInfo.departments && userInfo.departments.length > 0
                        ? userInfo.departments.map((dept: string) => prettyDepartment(dept)).join(", ")
                        : "-"}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="w-full rounded-xl border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
                  >
                    정보 수정
                  </button>
                </>
              )}
            </div>
          </section>
        </div>

        {/* 기여도 그래프 섹션 */}
        <div className="lg:col-span-2">
          <section className="mb-6 rounded-3xl border border-slate-200/60 bg-white p-6 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)]">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                {isCurrentLaborPeriod ? "용역료 (예상)" : "용역료"}
              </h2>
              <div className="flex items-center gap-2">
                {laborEstimate && (
                  <span className="text-xs text-gray-600">
                    {laborEstimate.year}년 {laborEstimate.month}월 기준
                  </span>
                )}
                <select
                  value={selectedLaborPeriodKey}
                  onChange={(e) => setSelectedLaborPeriodKey(e.target.value)}
                  className="rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                >
                  {periodOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {laborEstimateLoading ? (
              <div className="text-sm text-gray-600">용역료 계산 중...</div>
            ) : laborEstimate ? (
              <>
                <div className="text-2xl font-bold text-slate-900">
                  {formatWon(laborEstimate.total_amount)}
                </div>
                {laborEstimate.departments.length > 0 ? (
                  <div className="mt-3 space-y-1 text-sm text-gray-700">
                    {laborEstimate.departments.map((item) => (
                      <div key={item.department} className="flex items-center justify-between">
                        <span>{prettyDepartment(item.department)}</span>
                        <span className="font-medium">{formatWon(item.total_amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-gray-600">해당 월 집계된 인건비 항목이 없습니다.</div>
                )}
              </>
            ) : (
              <div className="text-sm text-gray-600">용역료 정보를 불러오지 못했습니다.</div>
            )}
          </section>

          <section className="rounded-3xl border border-slate-200/60 bg-white/80 p-6 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)] backdrop-blur">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">기여도</h2>
              <select
                value={selectedContributionPeriodKey}
                onChange={(e) => setSelectedContributionPeriodKey(e.target.value)}
                className="rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              >
                {periodOptions.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            {contributionsLoading ? (
              <div className="text-gray-500 text-sm">기여도 데이터를 불러오는 중...</div>
            ) : (
              <ContributionChart stat={currentContribution} onOpenDetail={openDetailModal} />
            )}
            <ContributionDetailModal
              open={detailModalCategory != null}
              onClose={closeDetailModal}
              category={detailModalCategory}
              yearLabel={periodOptions.find((opt) => opt.key === selectedContributionPeriodKey)?.label || "선택 기간"}
              items={detailItems}
              loading={detailLoading}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
