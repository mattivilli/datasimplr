export function LogoMark({ className = "size-8" }: { className?: string }) {
  return <img src="/logo.png" alt="" className={`shrink-0 rounded-lg ${className}`} />;
}
