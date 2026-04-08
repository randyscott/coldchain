/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        cold: {
          50: '#f0f7ff',
          100: '#dfeeff',
          200: '#b8dbff',
          300: '#7abfff',
          400: '#3399ff',
          500: '#0a74da',
          600: '#005bb5',
          700: '#004a94',
          800: '#003d7a',
          900: '#002d5c',
          950: '#001d3d',
        },
        alert: {
          ok: '#059669',
          warning: '#d97706',
          critical: '#dc2626',
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
