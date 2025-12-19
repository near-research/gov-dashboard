import type { Evaluation } from "@/types/evaluation";

interface ScreeningResultsProps {
  evaluation: Evaluation;
}

export const ScreeningResults = ({ evaluation }: ScreeningResultsProps) => {
  const qualityCriteriaLabels: Record<string, string> = {
    complete: "Complete",
    legible: "Legible",
    consistent: "Consistent",
    compliant: "Compliant",
    justified: "Justified",
    measurable: "Measurable",
  };

  const formatScore = (score: number) => `${(score * 100).toFixed(0)}%`;

  return (
    <div className="screener-results space-y-6">
      <div
        className={`status-card ${
          evaluation.overallPass ? "status-card-success" : "status-card-warning"
        }`}
      >
        <div className="status-card-header">
          <span className="status-icon">
            {evaluation.overallPass ? "✓" : "⚠"}
          </span>
          <h2 className="status-title">
            {evaluation.overallPass
              ? "Ready for Submission"
              : "Needs Improvement"}
          </h2>
        </div>
        <div className="mt-3 text-sm flex flex-wrap gap-6">
          <div>
            <strong>Quality Score:</strong>{" "}
            {formatScore(evaluation.qualityScore)}
          </div>
          <div>
            <strong>Attention Score:</strong>{" "}
            {formatScore(evaluation.attentionScore)}
          </div>
        </div>
        <p className="status-text">{evaluation.summary}</p>
      </div>

      <div className="space-y-3">
        <h3 className="section-title">Quality Criteria</h3>
        <div className="grid grid-auto gap-4">
          {Object.entries(qualityCriteriaLabels).map(([key, label]) => {
            const criterion = evaluation[key as keyof Evaluation];
            if (typeof criterion === "object" && "pass" in criterion) {
              return (
                <div key={key} className="info-card">
                  <div className="info-card-header">
                    <span
                      className={`info-card-icon ${
                        criterion.pass
                          ? "info-card-icon-success"
                          : "info-card-icon-error"
                      }`}
                    >
                      {criterion.pass ? "✓" : "✗"}
                    </span>
                    <h4 className="info-card-title">{label}</h4>
                  </div>
                  <p className="info-card-text">{criterion.reason}</p>
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="section-title">Attention Scores</h3>
        <div className="grid grid-2 gap-4">
          <div className="info-card">
            <div className="info-card-header">
              <span
                className={`badge ${
                  evaluation.relevant?.score === "high"
                    ? "badge-success"
                    : evaluation.relevant?.score === "medium"
                    ? "badge-warning"
                    : "badge-error"
                }`}
              >
                {evaluation.relevant?.score?.toUpperCase() || "UNKNOWN"}
              </span>
              <h4 className="info-card-title">Relevant</h4>
            </div>
            <p className="info-card-text">
              {evaluation.relevant?.reason || "No assessment available"}
            </p>
          </div>

          <div className="info-card">
            <div className="info-card-header">
              <span
                className={`badge ${
                  evaluation.material?.score === "high"
                    ? "badge-success"
                    : evaluation.material?.score === "medium"
                    ? "badge-warning"
                    : "badge-error"
                }`}
              >
                {evaluation.material?.score?.toUpperCase() || "UNKNOWN"}
              </span>
              <h4 className="info-card-title">Material</h4>
            </div>
            <p className="info-card-text">
              {evaluation.material?.reason || "No assessment available"}
            </p>
          </div>
        </div>
      </div>

      {evaluation.overallPass && (
        <div className="feature-card">
          <div className="feature-icon">✓</div>
          <div>
            <h3 className="feature-title">AI Screened & Approved</h3>
            <p className="feature-text">Your proposal is ready to publish!</p>
          </div>
        </div>
      )}
    </div>
  );
};
