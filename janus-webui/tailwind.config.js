/** @type {import('tailwindcss').Config} */
// Colors are RGB-triplet CSS variables (defined per theme in index.css under
// [data-theme=...]) so themes switch at runtime without a rebuild.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--app-font, 'Inter')", 'Consolas', 'system-ui', '-apple-system', 'sans-serif']
      },
      colors: {
        // Surfaces (VS Code Dark+ names kept; values come from CSS variables)
        surface: {
          app: 'rgb(var(--c-surface-app) / <alpha-value>)',
          DEFAULT: 'rgb(var(--c-surface) / <alpha-value>)',
          raised: 'rgb(var(--c-surface-raised) / <alpha-value>)',
          border: 'rgb(var(--c-surface-border) / <alpha-value>)',
          input: 'rgb(var(--c-surface-input) / <alpha-value>)'
        },
        accent: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          hover: 'rgb(var(--c-accent-hover) / <alpha-value>)',
          muted: 'rgb(var(--c-accent-muted) / <alpha-value>)',
          fg: 'rgb(var(--c-accent-fg) / <alpha-value>)'
        },
        // Remapped zinc scale so existing classes pick up the active theme
        zinc: {
          50: 'rgb(var(--c-zinc-50) / <alpha-value>)',
          100: 'rgb(var(--c-zinc-100) / <alpha-value>)',
          200: 'rgb(var(--c-zinc-200) / <alpha-value>)',
          300: 'rgb(var(--c-zinc-300) / <alpha-value>)',
          400: 'rgb(var(--c-zinc-400) / <alpha-value>)',
          500: 'rgb(var(--c-zinc-500) / <alpha-value>)',
          600: 'rgb(var(--c-zinc-600) / <alpha-value>)',
          700: 'rgb(var(--c-zinc-700) / <alpha-value>)',
          800: 'rgb(var(--c-zinc-800) / <alpha-value>)',
          900: 'rgb(var(--c-zinc-900) / <alpha-value>)',
          950: 'rgb(var(--c-zinc-950) / <alpha-value>)'
        },
        blue: {
          300: 'rgb(var(--c-blue-300) / <alpha-value>)',
          400: 'rgb(var(--c-blue-400) / <alpha-value>)',
          500: 'rgb(var(--c-blue-500) / <alpha-value>)',
          600: 'rgb(var(--c-blue-600) / <alpha-value>)',
          700: 'rgb(var(--c-blue-700) / <alpha-value>)'
        }
      },
      keyframes: {
        'ios-backdrop-in': {
          from: { opacity: '0' },
          to: { opacity: '1' }
        },
        'ios-modal-in': {
          from: { opacity: '0', transform: 'scale(0.88)' },
          to: { opacity: '1', transform: 'scale(1)' }
        },
        'ios-backdrop-out': {
          from: { opacity: '1' },
          to: { opacity: '0' }
        },
        'ios-modal-out': {
          from: { opacity: '1', transform: 'scale(1)' },
          to: { opacity: '0', transform: 'scale(0.88)' }
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' }
        },
        'fade-out': {
          from: { opacity: '1' },
          to: { opacity: '0' }
        }
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out both',
        'fade-out': 'fade-out 0.2s ease-in both',
        'ios-backdrop-in': 'ios-backdrop-in 0.38s cubic-bezier(0.32, 0.72, 0, 1) both',
        'ios-modal-in': 'ios-modal-in 0.52s cubic-bezier(0.32, 0.72, 0, 1) both',
        'ios-backdrop-out': 'ios-backdrop-out 0.38s cubic-bezier(0.32, 0.72, 0, 1) both',
        'ios-modal-out': 'ios-modal-out 0.52s cubic-bezier(0.32, 0.72, 0, 1) both'
      }
    }
  },
  plugins: []
}
