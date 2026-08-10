export const scoreColor = (s) => {
  if (s == null) return "text-zinc-500";
  if (s >= 80) return "text-emerald-400";
  if (s >= 60) return "text-[#FF4F00]";
  if (s >= 40) return "text-amber-400";
  return "text-red-400";
};

export const ScoreBadge = ({ score, testId }) => (
  <span
    data-testid={testId}
    className={`mono text-xs px-1.5 py-0.5 border border-border bg-[#18181b] ${scoreColor(score)}`}
  >
    {score == null ? "unscored" : score.toFixed(1)}
  </span>
);

export const Overline = ({ children, className = "" }) => (
  <div className={`overline ${className}`}>{children}</div>
);

export const Panel = ({ title, action, children, className = "", testId }) => (
  <section data-testid={testId} className={`panel ${className}`}>
    {(title || action) && (
      <div className="flex items-center justify-between px-4 h-11 border-b border-border">
        <Overline>{title}</Overline>
        {action}
      </div>
    )}
    {children}
  </section>
);

export const Metric = ({ label, value, sub, accent = "text-white", testId }) => (
  <div className="panel p-5 h-full" data-testid={testId}>
    <Overline>{label}</Overline>
    <div className={`mono text-3xl tracking-tight mt-3 ${accent}`}>{value}</div>
    {sub && <div className="text-xs text-zinc-500 mt-1.5">{sub}</div>}
  </div>
);

export const Empty = ({ children }) => (
  <div className="px-4 py-10 text-center text-sm text-zinc-500">{children}</div>
);
