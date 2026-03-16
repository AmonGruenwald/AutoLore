/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        parchment: {
          50: '#fdfbf7',
          100: '#faf5eb',
          200: '#f5ead1',
          300: '#eddbaf',
          400: '#e2c882',
          500: '#d4a853',
        },
        ink: {
          DEFAULT: '#1a1208',
          light: '#3d2c0f',
          muted: '#6b5a3e',
        },
      },
    },
  },
  plugins: [],
}
