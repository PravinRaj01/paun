import { useEffect, useState, type ReactNode } from "react";
import { BookOpen } from "lucide-react";
import { useGuide } from "./guide/guide-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PURITIES, type PurityId } from "@/lib/gold";

/** A number box that keeps exactly what is being typed, and reports 0 (or null, if `nullable`) when it is empty. */
export function NumField({
  label,
  hint,
  value,
  onChange,
  step = "0.01",
  placeholder = "0",
  nullable = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: number | null;
  onChange: (n: number | null) => void;
  step?: string;
  placeholder?: string;
  nullable?: boolean;
}) {
  // 0 means "not given" for a plain amount, but for a nullable field (susut) an explicit 0 is a real answer and must stay visible
  const show = (v: number | null) => (v === null || (!nullable && v === 0) ? "" : String(v));
  const [text, setText] = useState(show(value));
  // follow outside changes (a currency conversion, "Reset all") without fighting the person's typing
  useEffect(() => {
    const typed = text.trim() === "" ? (nullable ? null : 0) : Number(text);
    if (typed !== value && !(Number.isNaN(typed) && value === null)) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        className="num"
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (raw.trim() === "") return onChange(nullable ? null : 0);
          const n = Number(raw);
          onChange(Number.isFinite(n) ? Math.max(0, n) : nullable ? null : 0);
        }}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function PurityPicker({ value, onChange, label }: { value: PurityId; onChange: (p: PurityId) => void; label: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as PurityId)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {PURITIES.map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** A labelled amount in a breakdown. */
export function Row({ label, value, strong, tone }: { label: ReactNode; value: ReactNode; strong?: boolean; tone?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 ${strong ? "border-t pt-2 font-medium" : "text-muted-foreground"}`}>
      <span>{label}</span>
      <span className={`num shrink-0 ${tone ?? (strong ? "text-gold" : "")}`}>{value}</span>
    </div>
  );
}

/** One short result sentence in a coloured card. */
export function Verdict({ tone, children }: { tone: "good" | "warn" | "info"; children: ReactNode }) {
  const cls = tone === "good" ? "border-success/40 text-success" : tone === "warn" ? "border-primary/40 text-gold" : "bg-card";
  return <div className={`rounded-lg border p-4 text-center text-sm sm:text-base ${cls}`}>{children}</div>;
}

/** A small link under a result that opens the guide at the page that explains it. */
export function GuideLink({ topic, label }: { topic: "upah" | "susut" | "buy"; label: string }) {
  const guide = useGuide();
  return (
    <button type="button" onClick={() => guide.open(topic)} className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-gold hover:underline">
      <BookOpen className="h-3 w-3" aria-hidden /> {label}
    </button>
  );
}
