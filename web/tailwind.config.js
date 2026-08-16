/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /**
         * Cool neutral scale for surfaces and text.
         *
         * Steps are tuned so adjacent surfaces are distinguishable without
         * borders, and so 300-and-lighter all clear 4.5:1 on `ink-950`.
         */
        ink: {
          1000: '#07080B',
          950: '#0B0D12',
          900: '#0F1218',
          850: '#14171F',
          800: '#191D26',
          750: '#1F242F',
          700: '#272D3A',
          600: '#343B4B',
          500: '#4B5468',
          400: '#6E7889',
          300: '#98A2B3',
          200: '#C4CAD5',
          100: '#E5E8EE',
          50: '#F6F8FA',
        },

        /** Semantic surfaces, so components stop hardcoding scale steps. */
        surface: {
          canvas: '#07080B',
          base: '#0B0D12',
          raised: '#12151C',
          overlay: '#171B24',
          hover: '#1C212C',
        },

        /** Violet-leaning indigo: distinctive without drifting into neon. */
        accent: {
          DEFAULT: '#6D5EF8',
          hover: '#5D4DF0',
          active: '#4F3FE0',
          muted: '#2A2555',
          fg: '#B9B1FF',
        },

        success: { DEFAULT: '#10B981', fg: '#5EEAD4', muted: '#0C2E28' },
        warning: { DEFAULT: '#F59E0B', fg: '#FCD34D', muted: '#3A2A0B' },
        danger: { DEFAULT: '#F43F5E', fg: '#FDA4AF', muted: '#3B1220' },
        info: { DEFAULT: '#38BDF8', fg: '#7DD3FC', muted: '#0C2B3A' },

        // Retained so any missed usage degrades gracefully rather than to black.
        studio: {
          950: '#07080B',
          900: '#0B0D12',
          850: '#12151C',
          800: '#171B24',
          750: '#1F242F',
          700: '#272D3A',
          600: '#343B4B',
          500: '#4B5468',
          400: '#6E7889',
          300: '#98A2B3',
          200: '#C4CAD5',
          100: '#E5E8EE',
        },
      },

      fontFamily: {
        sans: [
          'Inter Variable',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono Variable',
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
      },

      fontSize: {
        // Tighter tracking on larger sizes is what reads as "designed".
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
        xs: ['0.75rem', { lineHeight: '1.125rem' }],
        sm: ['0.8125rem', { lineHeight: '1.375rem' }],
        base: ['0.875rem', { lineHeight: '1.5rem' }],
        lg: ['1rem', { lineHeight: '1.625rem', letterSpacing: '-0.011em' }],
        xl: ['1.125rem', { lineHeight: '1.75rem', letterSpacing: '-0.014em' }],
        '2xl': ['1.375rem', { lineHeight: '1.875rem', letterSpacing: '-0.02em' }],
      },

      borderRadius: {
        md: '0.4375rem',
        lg: '0.625rem',
        xl: '0.875rem',
        '2xl': '1.125rem',
      },

      boxShadow: {
        // Layered, low-opacity shadows read as depth; single hard shadows read as cheap.
        subtle: '0 1px 2px rgba(0, 0, 0, 0.32)',
        card: '0 1px 2px rgba(0, 0, 0, 0.28), 0 4px 12px -4px rgba(0, 0, 0, 0.4)',
        elevated: '0 4px 12px -2px rgba(0, 0, 0, 0.4), 0 12px 32px -8px rgba(0, 0, 0, 0.5)',
        composer: '0 2px 8px -2px rgba(0, 0, 0, 0.35), 0 16px 40px -12px rgba(0, 0, 0, 0.55)',
        command: '0 8px 24px -6px rgba(0, 0, 0, 0.5), 0 32px 72px -16px rgba(0, 0, 0, 0.7)',
        'accent-glow': '0 0 0 1px rgba(109, 94, 248, 0.4), 0 4px 16px -4px rgba(109, 94, 248, 0.45)',
      },

      transitionTimingFunction: {
        // A single easing curve across the app keeps motion feeling coherent.
        swift: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },

      animation: {
        'fade-in': 'fadeIn 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-up': 'slideUp 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scaleIn 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.8s ease-in-out infinite',
        'pulse-soft': 'pulseSoft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },

      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
      },
    },
  },
  plugins: [],
};
