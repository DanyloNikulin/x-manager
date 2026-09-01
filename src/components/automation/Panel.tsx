'use client';

import type { ReactNode } from 'react';

export default function Panel({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 bg-[linear-gradient(135deg,rgba(15,23,42,0.02),rgba(20,184,166,0.06))]">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-slate-900 text-white p-2">{icon}</div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">{subtitle}</p>
          </div>
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}
