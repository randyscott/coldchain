import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { format } from 'date-fns';
import type { Reading } from '../../api/client';

interface Props {
  readings: Reading[];
  thresholdHigh?: number;
  thresholdLow?: number;
  height?: number;
}

export function TemperatureChart({ readings, thresholdHigh, thresholdLow, height = 300 }: Props) {
  const data = useMemo(() => {
    return [...readings]
      .reverse()
      .map((r) => ({
        time: new Date(r.time).getTime(),
        temperature: r.temperature,
        humidity: r.humidity,
      }));
  }, [readings]);

  const yDomain = useMemo((): [number, number] => {
    const temps = data.map(d => d.temperature).filter((t): t is number => t != null);
    const candidates = [...temps];
    if (thresholdHigh != null) candidates.push(thresholdHigh);
    if (thresholdLow != null) candidates.push(thresholdLow);
    if (candidates.length === 0) return [0, 10];
    const min = Math.min(...candidates);
    const max = Math.max(...candidates);
    const padding = Math.max((max - min) * 0.1, 1);
    return [
      Math.floor(min - padding),
      Math.ceil(max + padding),
    ];
  }, [data, thresholdHigh, thresholdLow]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-cold-400 text-sm">
        No readings available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" />
        <XAxis
          dataKey="time"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(ts) => format(new Date(ts), 'HH:mm')}
          stroke="#4a7fb5"
          fontSize={11}
          tickLine={false}
        />
        <YAxis
          domain={yDomain}
          stroke="#4a7fb5"
          fontSize={11}
          tickLine={false}
          tickFormatter={(v) => `${v}°`}
        />
        <Tooltip
          contentStyle={{
            background: '#002d5c',
            border: '1px solid #1e3a5f',
            borderRadius: '8px',
            fontSize: '12px',
          }}
          labelFormatter={(ts) => format(new Date(ts as number), 'MMM d, HH:mm:ss')}
          formatter={(value: number, name: string) => {
            if (name === 'temperature') return [`${value.toFixed(2)}°C`, 'Temperature'];
            if (name === 'humidity') return [`${value.toFixed(1)}%`, 'Humidity'];
            return [value, name];
          }}
        />
        {thresholdHigh != null && (
          <ReferenceLine
            y={thresholdHigh}
            stroke="#dc2626"
            strokeDasharray="6 4"
            strokeWidth={1.5}
            label={{
              value: `High: ${thresholdHigh}°`,
              position: 'right',
              fill: '#dc2626',
              fontSize: 11,
            }}
          />
        )}
        {thresholdLow != null && (
          <ReferenceLine
            y={thresholdLow}
            stroke="#3b82f6"
            strokeDasharray="6 4"
            strokeWidth={1.5}
            label={{
              value: `Low: ${thresholdLow}°`,
              position: 'right',
              fill: '#3b82f6',
              fontSize: 11,
            }}
          />
        )}
        <Line
          type="monotone"
          dataKey="temperature"
          stroke="#3399ff"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#3399ff', stroke: '#001d3d', strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
