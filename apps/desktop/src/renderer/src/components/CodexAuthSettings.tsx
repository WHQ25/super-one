import { useCallback, useEffect, useState } from "react";
import {
  Copy,
  ExternalLink,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@superone/ui/components/ui/button";
import { IconButton } from "@superone/ui/components/ui/icon-button";
import type {
  CodexAccountLoginStartResult,
  CodexAccountStatus,
} from "@superone/shared/agent-types";
import { useChatStore } from "@/stores/chat";

const ACCOUNT_POLL_MS = 1_500;

export function CodexAuthSettings({
  onAuthChanged,
}: {
  onAuthChanged?: () => void;
}) {
  const { t } = useTranslation();
  const projectPath = useChatStore((state) => state.activeProject);
  const [status, setStatus] = useState<CodexAccountStatus | null>(null);
  const [pending, setPending] = useState<CodexAccountLoginStartResult | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectPath) {
      setStatus(null);
      return null;
    }
    setLoading(true);
    try {
      const next = await window.app.codexGetAccountStatus(projectPath);
      setStatus(next);
      return next;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!pending || !projectPath) return;
    const timer = window.setInterval(() => {
      void window.app
        .codexGetAccountStatus(projectPath)
        .then((next) => {
          setStatus(next);
          if (!next.signedIn) return;
          window.clearInterval(timer);
          setPending(null);
          toast.success(t("settings.harnesses.codexAccount.signInComplete"));
          onAuthChanged?.();
        })
        .catch(() => {});
    }, ACCOUNT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [onAuthChanged, pending, projectPath, t]);

  async function signIn() {
    if (!projectPath || pending || loading) return;
    setLoading(true);
    try {
      const result = await window.app.codexStartAccountLogin(projectPath);
      setPending(result);
      toast.success(t("settings.harnesses.codexAccount.signInOpened"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  async function cancelSignIn() {
    if (!projectPath || !pending) return;
    const loginId = pending.loginId;
    setPending(null);
    try {
      await window.app.codexCancelAccountLogin(projectPath, loginId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function signOut() {
    if (!projectPath || loggingOut) return;
    setLoggingOut(true);
    try {
      const next = await window.app.codexLogoutAccount(projectPath);
      setStatus(next);
      setPending(null);
      toast.success(t("settings.harnesses.codexAccount.signOutComplete"));
      onAuthChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoggingOut(false);
    }
  }

  async function copyDeviceCode() {
    if (!pending?.userCode) return;
    await navigator.clipboard.writeText(pending.userCode);
    toast.success(t("settings.harnesses.codexAccount.codeCopied"));
  }

  function openSignInPage() {
    const url = pending?.authUrl ?? pending?.verificationUrl;
    if (url) void window.app.openExternalLink(url);
  }

  if (!projectPath) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("settings.harnesses.codexAccount.noProject")}
      </p>
    );
  }

  return (
    <section
      aria-labelledby="codex-account-title"
      className="flex flex-col gap-4 rounded-lg border p-4"
    >
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 id="codex-account-title" className="text-sm font-medium">
            {t("settings.harnesses.codexAccount.title")}
          </h3>
          <p className="max-w-2xl text-xs text-muted-foreground">
            {t("settings.harnesses.codexAccount.description")}
          </p>
        </div>
        {status?.signedIn ? (
          <Button
            variant="outline"
            size="sm"
            disabled={loggingOut}
            onClick={() => void signOut()}
          >
            {loggingOut ? (
              <Loader2 data-icon className="animate-spin" />
            ) : (
              <LogOut data-icon />
            )}
            {t("settings.harnesses.codexAccount.signOut")}
          </Button>
        ) : (
          <IconButton
            size="sm"
            variant="ghost"
            tooltip={t("settings.harnesses.codexAccount.refresh")}
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw className={loading ? "animate-spin" : undefined} />
          </IconButton>
        )}
      </header>

      {status?.signedIn ? (
        <div className="flex flex-col gap-3">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {status.email ? (
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("settings.harnesses.codexAccount.email")}
                </dt>
                <dd className="truncate">{status.email}</dd>
              </div>
            ) : null}
            {status.planType ? (
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("settings.harnesses.codexAccount.plan")}
                </dt>
                <dd>{status.planType}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {pending?.type === "chatgptDeviceCode" && pending.userCode ? (
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium">
                {t("settings.harnesses.codexAccount.deviceCodeTitle")}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings.harnesses.codexAccount.deviceCodeDescription")}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-md bg-muted px-3 py-2 text-lg font-semibold tracking-[0.2em]">
                  {pending.userCode}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copyDeviceCode()}
                >
                  <Copy data-icon />
                  {t("settings.harnesses.codexAccount.copyCode")}
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {pending ? (
              <>
                <Button size="sm" disabled>
                  <Loader2 data-icon className="animate-spin" />
                  {t("settings.harnesses.codexAccount.signingIn")}
                </Button>
                {pending.authUrl || pending.verificationUrl ? (
                  <Button variant="outline" size="sm" onClick={openSignInPage}>
                    <ExternalLink data-icon />
                    {t("settings.harnesses.codexAccount.openPage")}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void cancelSignIn()}
                >
                  <X data-icon />
                  {t("settings.harnesses.codexAccount.cancel")}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                disabled={loading}
                onClick={() => void signIn()}
              >
                {loading ? (
                  <Loader2 data-icon className="animate-spin" />
                ) : (
                  <LogIn data-icon />
                )}
                {t("settings.harnesses.codexAccount.signIn")}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
