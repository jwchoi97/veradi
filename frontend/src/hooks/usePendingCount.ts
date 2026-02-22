import { useQuery } from "@tanstack/react-query";
import { getAuthedUser } from "@/auth";
import { fetchPendingCounts } from "@/data/files/adminUsersApi";

export const PENDING_COUNT_QUERY_KEY = ["pendingCount"] as const;

const emptyCounts = { signupCount: 0, passwordCount: 0 };

export function usePendingCount(): {
  signupPendingCount: number;
  passwordPendingCount: number;
  totalPendingCount: number;
  refetch: () => void;
} {
  const me = getAuthedUser();
  const adminId = me?.id ?? null;
  const isAdmin = me?.role === "ADMIN";

  const { data = emptyCounts, refetch } = useQuery({
    queryKey: [...PENDING_COUNT_QUERY_KEY, adminId],
    queryFn: () => (adminId ? fetchPendingCounts(adminId) : Promise.resolve(emptyCounts)),
    enabled: Boolean(adminId && isAdmin),
    refetchInterval: 60_000, // 1분마다
    staleTime: 30_000, // 30초
  });

  const signupPendingCount = data.signupCount;
  const passwordPendingCount = data.passwordCount;
  const totalPendingCount = signupPendingCount + passwordPendingCount;

  return {
    signupPendingCount,
    passwordPendingCount,
    totalPendingCount,
    refetch,
  };
}
