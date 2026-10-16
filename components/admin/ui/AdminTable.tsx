import React from "react";
import { clsx } from "clsx";

export type Column<T> = {
  header: string;
  accessorKey?: keyof T;
  cell?: (item: T) => React.ReactNode;
  className?: string;
};

type AdminTableProps<T> = {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  emptyText?: string;
  className?: string;
};

export function AdminTable<T>({
  columns,
  data,
  keyExtractor,
  emptyText = "No records found.",
  className,
}: AdminTableProps<T>) {
  return (
    <div className={clsx("w-full overflow-x-auto rounded-xl border border-white/[0.07] bg-zinc-950/60", className)}>
      <table className="w-full text-left text-xs sm:text-sm text-zinc-300">
        <thead className="bg-zinc-900/80 border-b border-white/[0.07] uppercase text-[10px] sm:text-xs font-semibold tracking-wider text-zinc-400">
          <tr>
            {columns.map((col, idx) => (
              <th key={idx} className={clsx("px-4 py-3.5 sm:px-6 sm:py-4", col.className)}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-6 py-12 text-center text-zinc-500 font-medium">
                {emptyText}
              </td>
            </tr>
          ) : (
            data.map((item) => (
              <tr
                key={keyExtractor(item)}
                className="hover:bg-white/[0.02] transition-colors duration-150"
              >
                {columns.map((col, idx) => (
                  <td key={idx} className={clsx("px-4 py-3.5 sm:px-6 sm:py-4 font-normal text-zinc-200", col.className)}>
                    {col.cell ? col.cell(item) : col.accessorKey ? String(item[col.accessorKey] ?? "") : null}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
