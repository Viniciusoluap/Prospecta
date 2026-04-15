import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = getLoginUrl() } =
    options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 0, // Nunca usar cache
    refetchOnMount: "always", // Sempre refetch ao montar
  });

  // Log para debug
  console.log("[useAuth] meQuery:", {
    data: meQuery.data,
    isLoading: meQuery.isLoading,
    error: meQuery.error,
    status: meQuery.status,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      // Limpa localStorage para evitar dados em cache
      localStorage.removeItem("manus-runtime-user-info");
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    // Removido localStorage - causa race condition e bugs de autenticação
    // Cookies são a única fonte da verdade para autenticação
    return {
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    console.log("[useAuth] useEffect executado:", {
      redirectOnUnauthenticated,
      isLoading: meQuery.isLoading,
      isPending: logoutMutation.isPending,
      user: state.user,
      pathname: window?.location?.pathname,
      redirectPath,
    });

    if (!redirectOnUnauthenticated) {
      console.log("[useAuth] Redirecionamento desabilitado");
      return;
    }
    if (meQuery.isLoading || logoutMutation.isPending) {
      console.log("[useAuth] Aguardando query/mutation...");
      return;
    }
    if (state.user) {
      console.log("[useAuth] Usuário autenticado:", state.user);
      return;
    }
    if (typeof window === "undefined") {
      console.log("[useAuth] Window não disponível (SSR)");
      return;
    }
    if (window.location.pathname === redirectPath) {
      console.log("[useAuth] Já está na página de login");
      return;
    }

    console.log("[useAuth] REDIRECIONANDO para:", redirectPath);
    window.location.href = redirectPath;
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
