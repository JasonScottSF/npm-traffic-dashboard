/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef9ff',
          100: '#d9f1ff',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
        }
      }
    }
  },
  plugins: []
}
