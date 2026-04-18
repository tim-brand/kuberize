const styles: Record<string, string> = {
  Pending: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  Deploying: "bg-blue-100 text-blue-800 animate-pulse dark:bg-blue-900/40 dark:text-blue-200",
  Provisioning: "bg-blue-100 text-blue-800 animate-pulse dark:bg-blue-900/40 dark:text-blue-200",
  Running: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  Ready: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  Error: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  Stopped: "bg-zinc-300 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200",
};

export function DeployStatus({ phase }: { phase?: string }) {
  const label = phase ?? "Pending";
  const cls = styles[label] ?? styles.Pending;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}
