import clsx from 'clsx';
import type { DashboardKpi } from '../../types/models';

const tones: Record<DashboardKpi['tone'], string> = {
  primary: 'border-[#335D16] bg-[#141E11] text-[#DFFFC3]',
  secondary: 'border-[#6F671D] bg-[#221E12] text-[#FAF2A6]',
  neutral: 'border-[#2D333A] bg-[#181C20] text-[#D8DEE7]',
  danger: 'border-[#5A2028] bg-[#261317] text-[#FFB7BD]',
};

export function KpiCard({ item }: { item: DashboardKpi }) {
  return (
    <div className={clsx('rounded-xl border p-4 shadow-[0_0_18px_rgba(0,0,0,.35)]', tones[item.tone])}>
      <p className='text-xs uppercase tracking-[0.09em] opacity-80'>{item.label}</p>
      <p className='mt-2 text-2xl font-bold'>{item.value}</p>
      <p className='mt-1 text-xs text-[#A8AFB8]'>{item.subtitle}</p>
    </div>
  );
}
