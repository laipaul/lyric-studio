// Font files per family and weight (from the @fontsource packages). No imports: used by both the
// composition (browser) and the media server (Node).
export const FONT_FILES: Record<string, Record<number, { latin: string; latinExt: string }>> = {
  Inter: {
    600: { latin: "inter-latin-600-normal.woff2", latinExt: "inter-latin-ext-600-normal.woff2" },
    700: { latin: "inter-latin-700-normal.woff2", latinExt: "inter-latin-ext-700-normal.woff2" },
  },
  Montserrat: {
    900: { latin: "montserrat-latin-900-normal.woff2", latinExt: "montserrat-latin-ext-900-normal.woff2" },
  },
};
