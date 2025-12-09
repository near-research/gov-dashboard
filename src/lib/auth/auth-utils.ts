type LinkedAccount = {
  providerId: string;
  accountId?: string;
};

/**
 * Extract NEAR accountId from linked accounts
 */
export function getNearAccountId(
  linkedAccounts: LinkedAccount[] | unknown
): string | null {
  if (!Array.isArray(linkedAccounts)) return null;
  const accounts = linkedAccounts as LinkedAccount[];
  const nearAccount = accounts.find((account) => account.providerId === "siwn");
  const accountId = nearAccount?.accountId;
  return accountId?.split(":")[0] ?? null;
}

/**
 * Get all linked provider names
 */
export function getLinkedProviders(linkedAccounts: unknown): string[] {
  if (!Array.isArray(linkedAccounts)) return [];
  const accounts = linkedAccounts as LinkedAccount[];
  return accounts
    .map((account) => account.providerId)
    .filter((id): id is string => Boolean(id));
}

/**
 * Check if user has NEAR account linked
 */
export function hasNearLinked(linkedAccounts: unknown): boolean {
  if (!Array.isArray(linkedAccounts)) return false;
  const accounts = linkedAccounts as LinkedAccount[];
  return accounts.some(
    (account) =>
      account.providerId === "siwn" &&
      typeof account.accountId === "string" &&
      account.accountId.length > 0
  );
}

/**
 * Get provider display configuration
 */
export function getProviderConfig(provider: string) {
  switch (provider) {
    case "siwn":
      return {
        name: "NEAR",
        icon: "🔗",
        color: "text-white",
        backgroundColor: "bg-[#000000]",
      };
    default:
      return {
        name:
          provider?.charAt(0).toUpperCase() + provider?.slice(1) || "Unknown",
        icon: "🔗",
        color: "text-muted-foreground",
        backgroundColor: "bg-gray-100",
      };
  }
}

/**
 * Handle OAuth callback URL cleanup and refresh
 */
export function handleAccountLinkRefresh(
  refreshAccounts: () => Promise<void>,
  win: Pick<Window, "location" | "history"> = window,
  delayMs = 1000
): () => Promise<void> {
  refreshAccounts();

  const urlParams = new URLSearchParams(win.location?.search || "");
  const hasCallback =
    urlParams.has("code") ||
    urlParams.has("state") ||
    urlParams.has("callbackUrl");

  if (hasCallback) {
    const cleanUrl = `${win.location?.pathname || ""}${
      win.location?.hash || ""
    }`;
    win.history.replaceState(null, "", cleanUrl);

    setTimeout(() => {
      refreshAccounts();
    }, delayMs);
  }

  return refreshAccounts;
}
