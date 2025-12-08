type LinkedAccount = {
  providerId: string;
  accountId?: string;
};

/**
 * Extract NEAR accountId from linked accounts
 */
export function getNearAccountId(
  linkedAccounts: LinkedAccount[]
): string | null {
  const nearAccount = linkedAccounts?.find(
    (account) => account.providerId === "siwn"
  );
  const accountId = nearAccount?.accountId;
  // Handle "accountId:network" format if present
  return accountId?.split(":")[0] ?? null;
}

/**
 * Get all linked provider names
 */
export function getLinkedProviders(linkedAccounts: any[]): string[] {
  return linkedAccounts?.map((account) => account.providerId) || [];
}

/**
 * Check if user has NEAR account linked
 */
export function hasNearLinked(linkedAccounts: any[]): boolean {
  return (
    linkedAccounts?.some(
      (account) => account.providerId === "siwn" && !!account.accountId
    ) || false
  );
}

/**
 * Get provider display configuration
 */
export function getProviderConfig(provider: string) {
  switch (provider) {
    case "google":
      return {
        name: "Google",
        icon: "🔵",
        color: "text-white",
        backgroundColor: "bg-[#4285F4]",
      };
    case "github":
      return {
        name: "GitHub",
        icon: "⚫",
        color: "text-white",
        backgroundColor: "bg-[#181717]",
      };
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
