"use client";

interface ProposalCardsProps {
  proposals: unknown[];
}

export function ProposalCards({ proposals }: ProposalCardsProps) {
  if (!Array.isArray(proposals) || proposals.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {proposals.map((proposal, index) => (
        <pre
          key={`proposal-${index}`}
          className="rounded-lg border border-dashed border-border/60 bg-muted/70 p-3 text-xs font-mono text-muted-foreground overflow-x-auto"
        >
          {JSON.stringify(proposal, null, 2)}
        </pre>
      ))}
    </div>
  );
}
