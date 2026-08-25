/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Slate-teal. Reads as civic and administrative without looking like a
        // consumer app, and stays legible against the risk colours.
        brand: {
          50: '#eef7f7',
          100: '#d5ebeb',
          200: '#aed7d8',
          300: '#7bbcbe',
          400: '#4a9b9e',
          500: '#2f7f83',
          600: '#22666b',
          700: '#1d5256',
          800: '#1a4347',
          900: '#18393c',
        },
        // These map 1:1 to the RiskBand enum in the backend.
        risk: {
          low: '#059669',
          moderate: '#ca8a04',
          high: '#ea580c',
          severe: '#dc2626',
        },
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        lift: '0 4px 12px -2px rgb(15 23 42 / 0.10), 0 2px 6px -2px rgb(15 23 42 / 0.06)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-up': 'fade-up 0.25s ease-out both',
      },
    },
  },
  plugins: [],
}
