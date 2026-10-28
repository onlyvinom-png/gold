/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        gold: {
          50: '#fdf9ec', 100: '#f8edc9', 200: '#f0da91', 300: '#e6c158',
          400: '#d9a92f', 500: '#c8911f', 600: '#a67118', 700: '#835317',
          800: '#614015', 900: '#44300f',
        },
        ink: {
          900: '#08090c', 800: '#0d0f14', 700: '#12151c', 600: '#181c25',
          500: '#1f2431', 400: '#2a3040',
        },
      },
      fontFamily: {
        sans: ['Tajawal', 'Noto Kufi Arabic', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
