import { usePlausible } from "next-plausible";
import type { GovernanceEvents } from "@/types/analytics";

type EmptyObject = Record<string, never>;

export function useGovernanceAnalytics() {
  const plausible = usePlausible();

  return <K extends keyof GovernanceEvents>(
    event: K,
    ...args: GovernanceEvents[K] extends EmptyObject
      ? [options?: { props?: GovernanceEvents[K] }]
      : [options: { props: GovernanceEvents[K] }]
  ) => {
    plausible(event, args[0] as { props: GovernanceEvents[K] });
  };
}
