import { useMemo } from 'react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import { format } from 'date-fns';
import type { Reading, ReadingAggregate } from '../../api/client';

// ── Raw readings mode ────────────────────────────────────────────────────────

interface RawProps {
  mode: 'raw';
  readings: Reading[];
  thresholdHigh?: number;
  thresholdLow?: number;
  height?: number;
  xAxisFormat?: string;   // date-fns format string, default 'HH:mm'
}

// ── Hourly aggregate mode ────────────────────────────────────────────────────

interface AggProps {
  mode: 'aggregate';
  readings: ReadingAggregate[];
  thresholdHigh?: number;
  thresholdLow?: number;
  height?: number;
  xAxisFormat?: string;
}

type Props = RawProps | AggProps;

// ── Shared helpers ───────────────────────────────────────────────────────────

function yDomain(
  temps: (number | null | undefined)[],
  thresholdHigh?: number,
  thresholdLow?: number,
): [number, number] {
  const candidates = temps.filter((t): t is number => t != null);
  if (thresholdHigh != null) candidates.push(thresholdHigh);
  if (thresholdLow != null) candidates.push(thresholdLow);
  if (candidates.length === 0) return [0, 10];
  const min = Math.min(...candidates);
  const max = Math.max(...candidates);
  const padding = Math.max((max - min) * 0.1, 1);
  return [Math.floor(min - padding), Math.ceil(max + padding)];
}

const CHART_STYLE = {
  background: '#002d5c',
  border: '1px solid #1e3a5f',
  borderRadius: '8px',
  fontSize: '12px',
};


// ── Raw chart ────────────────────────────────────────────────────────────────

function RawChart({ readings, thresholdHigh, thresholdLow, height = 300, xAxisFormat = 'HH:mm' }: RawProps) {
  const data = useMemo(() => (
    [...readings].reverse().map(r => ({
      time: new Date(r.time).getTime(),
      temperature: r.temperature,
      humidity: r.humidity,
    }))
  ), [readings]);

  const domain = useMemo(
    () => yDomain(data.map(d => d.temperature), thresholdHigh, thresholdLow),
    [data, thresholdHigh, thresholdLow],
  );

  if (data.length === 0) return <Empty height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 40, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
        <XAxis
          dataKey="time"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={ts => format(new Date(ts), xAxisFormat)}
          stroke="#4a7fb5"
          fontSize={11}
          tickLine={false}
        />
        <YAxis domain={domain} stroke="#4a7fb5" fontSize={11} tickLine={false} tickFormatter={v => `${v}°`} />
        <Tooltip
          contentStyle={CHART_STYLE}
          labelFormatter={ts => format(new Date(ts as number), 'MMM d, HH:mm:ss')}
          formatter={(value: number, name: string) => {
            if (name === 'temperature') return [`${value.toFixed(2)}°C`, 'Temperature'];
            if (name === 'humidity') return [`${value.toFixed(1)}%`, 'Humidity'];
            return [value, name];
          }}
        />
        {thresholdHigh != null && (
          <ReferenceLine y={thresholdHigh} stroke="#dc2626" strokeDasharray="6 4" strokeWidth={1.5}
            label={{ value: `High: ${thresholdHigh}°`, position: 'right', fill: '#dc2626', fontSize: 11 }} />
        )}
        {thresholdLow != null && (
          <ReferenceLine y={thresholdLow} stroke="#3b82f6" strokeDasharray="6 4" strokeWidth={1.5}
            label={{ value: `Low: ${thresholdLow}°`, position: 'right', fill: '#3b82f6', fontSize: 11 }} />
        )}
        <Line
          type="monotone"
          dataKey="temperature"
          stroke="#3399ff"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#3399ff', stroke: '#001d3d', strokeWidth: 2 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Aggregate chart ──────────────────────────────────────────────────────────

function AggChart({ readings, thresholdHigh, thresholdLow, height = 300, xAxisFormat = 'MMM d HH:mm' }: AggProps) {
  const data = useMemo(() => (
    [...readings]
      .sort((a, b) => new Date(a.bucket).getTime() - new Date(b.bucket).getTime())
      .map(r => ({
        time: new Date(r.bucket).getTime(),
        avg: r.avg_temperature,
        min: r.min_temperature,
        max: r.max_temperature,
        count: r.reading_count,
      }))
  ), [readings]);

  const domain = useMemo(() => {
    const all = data.flatMap(d => [d.min, d.max]);
    return yDomain(all, thresholdHigh, thresholdLow);
  }, [data, thresholdHigh, thresholdLow]);

  if (data.length === 0) return <Empty height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 40, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
        <XAxis
          dataKey="time"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={ts => format(new Date(ts), xAxisFormat)}
          stroke="#4a7fb5"
          fontSize={11}
          tickLine={false}
        />
        <YAxis domain={domain} stroke="#4a7fb5" fontSize={11} tickLine={false} tickFormatter={v => `${v}°`} />
        <Tooltip
          contentStyle={CHART_STYLE}
          labelFormatter={ts => format(new Date(ts as number), 'MMM d, HH:mm')}
          formatter={(value: number, name: string) => {
            if (name === 'avg') return [`${value.toFixed(2)}°C`, 'Avg'];
            if (name === 'max') return [`${value.toFixed(2)}°C`, 'Max'];
            if (name === 'min') return [`${value.toFixed(2)}°C`, 'Min'];
            return [value, name];
          }}
        />
        <Legend
          formatter={v => ({ avg: 'Avg', min: 'Min', max: 'Max' }[v] ?? v)}
          wrapperStyle={{ fontSize: 11, color: '#4a7fb5' }}
        />
        {thresholdHigh != null && (
          <ReferenceLine y={thresholdHigh} stroke="#dc2626" strokeDasharray="6 4" strokeWidth={1.5}
            label={{ value: `High: ${thresholdHigh}°`, position: 'right', fill: '#dc2626', fontSize: 11 }} />
        )}
        {thresholdLow != null && (
          <ReferenceLine y={thresholdLow} stroke="#3b82f6" strokeDasharray="6 4" strokeWidth={1.5}
            label={{ value: `Low: ${thresholdLow}°`, position: 'right', fill: '#3b82f6', fontSize: 11 }} />
        )}
        {/* Min/max band */}
        <Area
          type="monotone"
          dataKey="max"
          stroke="none"
          fill="#3399ff"
          fillOpacity={0.1}
          legendType="none"
          tooltipType="none"
          dot={false}
          activeDot={false}
        />
        <Area
          type="monotone"
          dataKey="min"
          stroke="none"
          fill="#3399ff"
          fillOpacity={0}
          legendType="none"
          tooltipType="none"
          dot={false}
          activeDot={false}
        />
        <Line
          type="monotone"
          dataKey="max"
          stroke="#3399ff"
          strokeWidth={1}
          strokeDasharray="4 2"
          dot={false}
          activeDot={{ r: 3, fill: '#3399ff' }}
        />
        <Line
          type="monotone"
          dataKey="avg"
          stroke="#3399ff"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#3399ff', stroke: '#001d3d', strokeWidth: 2 }}
        />
        <Line
          type="monotone"
          dataKey="min"
          stroke="#3399ff"
          strokeWidth={1}
          strokeDasharray="4 2"
          dot={false}
          activeDot={{ r: 3, fill: '#3399ff' }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function Empty({ height }: { height: number }) {
  return (
    <div className="flex items-center justify-center text-cold-400 text-sm" style={{ height }}>
      No readings available
    </div>
  );
}

// ── Public component ─────────────────────────────────────────────────────────

export function TemperatureChart(props: Props) {
  if (props.mode === 'aggregate') return <AggChart {...props} />;
  return <RawChart {...props} />;
}
