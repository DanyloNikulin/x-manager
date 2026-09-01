'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

export default function ConnectingLine({
  showAddButton,
  onAdd,
}: {
  showAddButton: boolean;
  onAdd: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative flex flex-col items-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="w-0.5 h-6 bg-slate-300 dark:bg-slate-600" />
      {showAddButton && (
        <button
          type="button"
          onClick={onAdd}
          className={`
            absolute top-1/2 -translate-y-1/2
            w-6 h-6 rounded-full border-2 border-dashed
            flex items-center justify-center
            transition-all duration-150
            ${
              hovered
                ? 'border-teal-500 dark:border-teal-400 text-teal-500 dark:text-teal-400 scale-110'
                : 'border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500'
            }
            bg-white dark:bg-slate-800
            hover:border-teal-500 dark:hover:border-teal-400
            hover:text-teal-500 dark:hover:text-teal-400
          `}
          aria-label="Insert tweet here"
        >
          <Plus className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
