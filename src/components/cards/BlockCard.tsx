/**
 * @file BlockCard.tsx
 * @brief Overview card — the active 5-hour block with countdown and burn.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useUsageStore } from '../../store/useUsageStore';
import { useNow } from '../../hooks/useNow';
import { fmtUSD, fmtTok, clockTime, countdown, relTime } from '../../lib/format';
import { bindingSession, displayWindow } from '../../lib/limits';
import { CountUp } from '../ui/CountUp';

/**
 * The current 5-hour rate-limit window: estimated cost, progress through the
 * window, and a live countdown to the reset.
 */
export function BlockCard() {
  const block = useUsageStore((s) => s.snapshot?.block);
  const blocks = useUsageStore((s) => s.snapshot?.blocks);
  const limitResetTs = useUsageStore((s) => s.snapshot?.usageLimitResetTs);
  const limits = useUsageStore((s) => s.limits);
  const now = useNow(1000);

  // binding live session across scoped accounts — real %, real reset time
  const liveSession = bindingSession(limits);
  const sessionPct = typeof liveSession?.pct === 'number' ? liveSession.pct : null;

  if (!block) {
    const used = blocks ? blocks.filter((b) => !b.isGap) : [];
    const lastEnd = used.length ? used[used.length - 1].actualEnd : null;
    const limited = limitResetTs != null && limitResetTs > now;
    return (
      <div className="panel stat-card">
        <div className="stat-label">current 5h block</div>
        <div className={`stat-value${limited ? '' : ' dim'}`}>
          {limited ? 'limited' : '—'}
        </div>
        <div className="stat-foot">
          <span className="stat-sub">
            {limited
              ? `resets in ${countdown(limitResetTs - now)} → ${clockTime(limitResetTs)}`
              : lastEnd
                ? `last ended ${relTime(lastEnd, now)}`
                : 'no active window'}
          </span>
        </div>
      </div>
    );
  }

  const win = displayWindow(block, liveSession, now);
  const remaining = Math.max(0, win.end - now);
  const progress = Math.min(1, Math.max(0, (now - win.start) / (win.end - win.start)));

  return (
    <div className="panel stat-card">
      <div className="stat-label">current 5h block</div>
      <div className="stat-value">
        <CountUp value={block.cost} format={fmtUSD} />
      </div>
      <div className="bar">
        {/* is-live adds the idle light sweep — this bar tracks a real window */}
        <div className="bar-fill is-live" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="stat-foot">
        <span className="stat-sub">
          {sessionPct != null
            ? `session ${Math.round(sessionPct)}% · `
            : ''}
          {fmtTok(block.in + block.out)} tok · {block.entries} msgs
          {block.burn && sessionPct == null
            ? ` · ${fmtTok(block.burn.tokensPerMinIndicator)}/min`
            : ''}
        </span>
        <span
          className="stat-sub"
          title={`${win.live ? 'live session window' : 'estimated window'} ${clockTime(win.start)} – ${clockTime(win.end)}`}
        >
          {countdown(remaining)} → {clockTime(win.end)}
        </span>
      </div>
    </div>
  );
}
