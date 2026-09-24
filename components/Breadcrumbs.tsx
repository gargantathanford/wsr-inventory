import Link from "next/link";

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="flex items-center gap-1.5 text-xs font-mono text-graphite-500 flex-wrap">
      <Link href="/dashboard" className="hover:text-graphite-200">
        Dashboard
      </Link>
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <span className="text-graphite-700">/</span>
          {item.href ? (
            <Link href={item.href} className="hover:text-graphite-200">
              {item.label}
            </Link>
          ) : (
            <span className="text-graphite-300">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
