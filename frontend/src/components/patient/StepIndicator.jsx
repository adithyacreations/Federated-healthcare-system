/**
 * StepIndicator — numbered step row. Completed/active steps are orange-filled,
 * upcoming steps are outlined grey. `steps` is an array of label strings.
 */
const StepIndicator = ({ steps, current = 0 }) => (
  <div className="flex items-center gap-2 mb-6">
    {steps.map((label, i) => {
      const done = i < current;
      const active = i === current;
      return (
        <div key={label} className="flex items-center gap-2 flex-1 last:flex-none">
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                active || done ? 'bg-orange-500 text-white' : 'bg-white border border-hairline text-muted'
              }`}
            >
              {done ? '✓' : i + 1}
            </span>
            <span className={`text-sm font-medium hidden sm:block ${active ? 'text-ink' : 'text-muted'}`}>
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 flex-1 rounded-full ${done ? 'bg-orange-500' : 'bg-hairline'}`} />
          )}
        </div>
      );
    })}
  </div>
);

export default StepIndicator;
