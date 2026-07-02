/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        nbtc: {
          red: '#C00000',
          'red-dark': '#8B0000',
          'red-light': '#FFE5E5',
          navy: '#1A365D',
          gold: '#B8860B',
        },
        spectrum: {
          green: '#16A34A',
          gray: '#9CA3AF',
          red: '#DC2626',
        }
      },
      fontFamily: {
        thai: ['Noto Sans Thai', 'Sarabun', 'sans-serif'],
        mono: ['Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
