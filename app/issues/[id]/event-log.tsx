import type { FoundryEvent } from "@/lib/foundry/log";

export function EventLog({ events }: { events: FoundryEvent[] }) {
  return (
    <details className="rounded-md border border-border p-4">
      <summary className="cursor-pointer text-sm text-muted-foreground">Event log</summary>
      <ol className="mt-3 flex flex-col gap-2 font-mono text-xs">
        {events.length === 0 ? (
          <li className="text-muted-foreground">No events yet.</li>
        ) : (
          events.map((event, index) => (
            <li key={`${event.ts}-${index}`}>
              <span className="text-muted-foreground">{event.ts}</span> {event.kind}
              {typeof event.payload.source === "string" ? ` · ${event.payload.source}` : ""}
              {typeof event.payload.reason === "string" ? ` · ${event.payload.reason}` : ""}
            </li>
          ))
        )}
      </ol>
    </details>
  );
}
