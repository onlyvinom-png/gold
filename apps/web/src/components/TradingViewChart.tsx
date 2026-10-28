import { useEffect, useRef } from 'react';

export interface ChartTheme {
  background?: string;
  textColor?: string;
  gridColor?: string;
  borderColor?: string;
}

interface TradingViewChartProps {
  symbol: string;
  interval: string;
  theme?: ChartTheme;
  height?: number;
  studies?: string[];
}

/**
 * Official TradingView Advanced Chart Widget (embed).
 * The widget is a standalone iframe feed — it is NOT the source of the
 * analysis engine's numbers. Those come from the server-side market-data
 * provider and are shown separately in the UI.
 */
export function TradingViewChart({
  symbol,
  interval,
  theme,
  height = 420,
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scriptId = 'goldscope-tradingview-widget';

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const render = () => {
      container.innerHTML = '';
      const inner = document.createElement('div');
      inner.className = 'tradingview-widget-container__widget';
      inner.style.height = `${height}px`;
      inner.style.width = '100%';

      const script = document.createElement('script');
      script.src =
        'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
      script.async = true;
      script.type = 'text/javascript';
      script.innerHTML = JSON.stringify({
        autosize: true,
        symbol,
        interval,
        timezone: 'Etc/UTC',
        theme: theme?.background ? 'dark' : 'dark',
        style: '1',
        locale: 'en',
        backgroundColor: theme?.background ?? '#0d0f14',
        gridColor: theme?.gridColor ?? '#1f2431',
        hide_top_toolbar: false,
        hide_legend: false,
        allow_symbol_change: true,
        save_image: false,
        calendar: false,
        support_host: 'https://www.tradingview.com',
studies: undefined,
      });

      inner.appendChild(script);
      container.appendChild(inner);
    };

    render();

    return () => {
      container.innerHTML = '';
    };
  }, [symbol, interval, height, theme?.background, theme?.gridColor]);

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-ink-800">
      <div ref={containerRef} data-testid="tradingview-container" />
      <p className="px-3 py-2 text-[11px] leading-relaxed text-slate-500">
        TradingView Advanced Chart Widget — chart data may be delayed and is provided by
        TradingView. All computed levels in GoldScope come from the server-side market-data
        provider, not from this chart.
      </p>
    </div>
  );
}

export default TradingViewChart;
