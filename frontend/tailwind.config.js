/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deep indigo reads as civic/administrative without looking like a
        // consumer app. Used for primary actions and the app shell.
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#4f46e5',
          600: '#4338ca',
          700: '#3730a3',
          900: '#1e1b4b',
        },
        // GRIE risk bands. These map 1:1 to the RiskBand enum in the backend.
        risk: {
          low: '#059669',
          moderate: '#d97706',
          high: '#ea580c',
          severe: '#dc2626',
        },
      },
    },
  },
  plugins: [],
}
