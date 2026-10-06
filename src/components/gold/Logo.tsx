export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`font-brand font-semibold tracking-[0.08em] ${className}`}>
      P<span className="text-gold">au</span>n
    </span>
  );
}
