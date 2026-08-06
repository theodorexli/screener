/**
 * Liquid Glass Effect Utility
 * Creates Apple-style liquid glass effects with chromatic aberration and light refraction
 */

export interface LiquidGlassStyles {
  background: string;
  backdropFilter: string;
  WebkitBackdropFilter: string;
  border: string;
  borderRadius: string;
  filter?: string;
  boxShadow: string;
  transition: string;
}

export interface LiquidGlassConfig {
  /** Base opacity for the glass background (0-1) */
  baseOpacity?: number;
  /** Hover opacity for the glass background (0-1) */
  hoverOpacity?: number;
  /** Blur amount in pixels */
  blur?: number;
  /** Saturation percentage */
  saturation?: number;
  /** Scale factor on hover */
  hoverScale?: number;
  /** Transform to preserve (e.g., 'translateX(-50%)' or 'translateY(-50%)') */
  preserveTransform?: string;
  /** Enable noise distortion filter (default: false - backdrop-filter handles refraction naturally) */
  enableDistortion?: boolean;
}

const DEFAULT_CONFIG: Required<Omit<LiquidGlassConfig, 'preserveTransform'>> & { preserveTransform: string } = {
  baseOpacity: 0.15,
  hoverOpacity: 0.25,
  blur: 60,
  saturation: 220,
  hoverScale: 1.1,
  preserveTransform: '', // Empty string means no transform to preserve
  enableDistortion: false, // Disabled by default - backdrop-filter handles refraction naturally
};

/**
 * Generates inset shadows for liquid glass edge effect
 * Matches macOS liquid glass implementation with white edge highlights
 */
function generateChromaticAberrationShadow(isHover: boolean = false): string {
  const intensity = isHover ? 1.1 : 1;
  
  // Inset shadows create the glass edge effect - refracts background naturally
  return `
    inset ${2 * intensity}px ${2 * intensity}px 0px ${-2 * intensity}px rgba(255, 255, 255, ${0.7 * intensity}),
    inset 0 0 ${3 * intensity}px ${1 * intensity}px rgba(255, 255, 255, ${0.7 * intensity})
  `.trim();
}

/**
 * Generates base liquid glass styles
 */
export function getLiquidGlassStyles(
  config: LiquidGlassConfig = {},
  isHover: boolean = false
): LiquidGlassStyles {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const opacity = isHover ? cfg.hoverOpacity : cfg.baseOpacity;
  
  const styles: LiquidGlassStyles = {
    // Very transparent background - SVG filter handles the glass effect
    background: `rgb(255 255 255 / ${Math.round(opacity * 100)}%)`,
    // Minimal backdrop blur - SVG filter does the heavy lifting
    backdropFilter: 'blur(0px)',
    WebkitBackdropFilter: 'blur(0px)',
    border: 'none',
    borderRadius: '9999px',
    boxShadow: generateChromaticAberrationShadow(isHover),
    transition: 'all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
    // SVG filter with noise texture creates the liquid glass distortion
    filter: 'url(#glass-distortion)',
  };

  return styles;
}

/**
 * Creates hover handlers for liquid glass elements
 */
export function createLiquidGlassHandlers(
  config: LiquidGlassConfig = {},
  onHoverChange?: (isHovering: boolean) => void
) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const baseStyles = getLiquidGlassStyles(cfg, false);
  const hoverStyles = getLiquidGlassStyles(cfg, true);
  
  const getTransform = (scale: number) => {
    if (cfg.preserveTransform) {
      return `${cfg.preserveTransform} scale(${scale})`;
    }
    return `scale(${scale})`;
  };

  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      const element = e.currentTarget;
      element.style.background = hoverStyles.background;
      element.style.transform = getTransform(cfg.hoverScale);
      element.style.boxShadow = hoverStyles.boxShadow;
      onHoverChange?.(true);
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      const element = e.currentTarget;
      element.style.background = baseStyles.background;
      element.style.transform = getTransform(1);
      element.style.boxShadow = baseStyles.boxShadow;
      onHoverChange?.(false);
    },
  };
}

/**
 * Applies liquid glass styles to an element
 */
export function applyLiquidGlassStyles(
  element: HTMLElement,
  config: LiquidGlassConfig = {},
  isHover: boolean = false
): void {
  const styles = getLiquidGlassStyles(config, isHover);
  
  // Apply styles directly to element.style (handles camelCase properties correctly)
  Object.entries(styles).forEach(([key, value]) => {
    // Convert camelCase to kebab-case for CSS properties that need it
    // But keep camelCase for direct style assignment
    (element.style as any)[key] = value;
  });
}

