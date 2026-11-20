import { Calendar, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { useI18n } from '@/i18n/I18nContext';
import { cn } from '@/lib/cn';
import { triggerHaptic } from '@/lib/telegram';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatLocalDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatLocalTimeInput(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function getNowLocalDateTimeValue(): string {
  const now = new Date();
  return `${formatLocalDateInput(now)}T${formatLocalTimeInput(now)}`;
}

export function isoToLocalDateTimeValue(iso?: string | null): string {
  if (!iso) return getNowLocalDateTimeValue();
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return getNowLocalDateTimeValue();
  return `${formatLocalDateInput(parsed)}T${formatLocalTimeInput(parsed)}`;
}

export function localDateTimeValueToIso(localValue?: string | null): string | undefined {
  if (!localValue || !localValue.trim()) return undefined;
  const [datePart, timePart = '12:00'] = localValue.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  if (!y || !m || !d) return undefined;
  const localDate = new Date(y, m - 1, d, Number.isFinite(hh) ? hh : 12, Number.isFinite(mm) ? mm : 0, 0, 0);
  if (Number.isNaN(localDate.getTime())) return undefined;
  return localDate.toISOString();
}

interface GlassDateTimeInputProps {
  value: string;
  onChange: (nextLocalValue: string) => void;
  label?: string;
  className?: string;
}

export function GlassDateTimeInput({
  value,
  onChange,
  label,
  className,
}: GlassDateTimeInputProps) {
  const { t } = useI18n();
  const safeValue = value || getNowLocalDateTimeValue();
  const [datePart, timePart = '12:00'] = safeValue.split('T');

  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const twoDaysAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2);

  const presets = [
    { key: 'today', label: t.dashboard.periods.today, dateStr: formatLocalDateInput(today) },
    { key: 'yesterday', label: t.transactions.yesterdayLabel, dateStr: formatLocalDateInput(yesterday) },
    { key: 'twoDaysAgo', label: t.transactions.twoDaysAgoLabel, dateStr: formatLocalDateInput(twoDaysAgo) },
  ];

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        {label && (
          <label className="text-xs font-semibold text-slate-600 dark:text-zinc-300">
            {label}
          </label>
        )}

        <div className="inline-flex items-center gap-1">
          {presets.map((preset) => {
            const active = datePart === preset.dateStr;
            return (
              <motion.button
                key={preset.key}
                type="button"
                whileTap={{ scaleX: 1.06, scaleY: 0.9 }}
                onClick={() => {
                  triggerHaptic('selection');
                  onChange(`${preset.dateStr}T${timePart}`);
                }}
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors',
                  active
                    ? 'liquid-glass-lens text-slate-950 dark:text-white'
                    : 'liquid-glass-pill text-slate-600 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-white',
                )}
              >
                {preset.label}
              </motion.button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2">
        <div className="relative col-span-3">
          <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 dark:text-zinc-400" />
          <input
            type="date"
            aria-label={label ? `${label} (date)` : 'Date'}
            value={datePart}
            onChange={(e) => {
              if (!e.target.value) return;
              onChange(`${e.target.value}T${timePart}`);
            }}
            className="liquid-glass-input py-2 pl-8 pr-2.5 text-xs font-medium sm:text-sm"
          />
        </div>

        <div className="relative col-span-2">
          <Clock className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 dark:text-zinc-400" />
          <input
            type="time"
            aria-label={label ? `${label} (time)` : 'Time'}
            value={timePart.slice(0, 5)}
            onChange={(e) => {
              if (!e.target.value) return;
              onChange(`${datePart}T${e.target.value}`);
            }}
            className="liquid-glass-input py-2 pl-8 pr-2 text-xs font-medium sm:text-sm"
          />
        </div>
      </div>
    </div>
  );
}
