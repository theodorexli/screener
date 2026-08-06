import { useState } from "react";
import { ExternalLink } from "lucide-react";

const createPill = (
  id: string, original: string, expanded: string, color = '', url = '', originalType: 'text' | 'icon' = 'text', expandedType: 'text' | 'icon' = 'text') => ({
  id, original, expanded, color, url, originalType, expandedType
});

function Pill({ pill }: { pill: ReturnType<typeof createPill> }) {
  const [h, setH] = useState(false);
  const c = pill.color || '#c084fc';
  
  return (
    <span
      data-pill={pill.id}
      style={{
        display: 'inline-flex', alignItems: 'center', borderRadius: '9999px',
        padding: h ? '0.25rem 0.5rem' : '0.25rem 0.25rem',
        background: h ? 'linear-gradient(-75deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0.05))' : 'transparent',
        backdropFilter: h ? 'blur(8px)' : 'none',
        WebkitBackdropFilter: h ? 'blur(8px)' : 'none',
        boxShadow: h ? 'inset 0 0.125em 0.125em rgba(0, 0, 0, 0.15), 0 0.15em 0.05em -0.1em rgba(0, 0, 0, 0.3)' : 'none',
        overflow: 'visible', whiteSpace: 'nowrap', 
        transition: 'all 0.6s ease, gap 0.5s ease',
        verticalAlign: 'middle', margin: h ? '0 0.125rem' : 0,
        cursor: pill.url ? 'pointer' : 'default',
        gap: h ? '0.375rem' : 0,
        flexShrink: 0,
        lineHeight: 1,
      }}
      onClick={pill.url ? () => window.open(pill.url, '_blank') : undefined}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
    >
      {pill.originalType === 'text' ? (
        <span style={{ transition: 'all 0.6s ease, color 0.3s ease', color: h ? c : undefined }}>{pill.original}</span>
      ) : (
        <img src={pill.original} alt={pill.expanded} style={{ height: '16px', width: 'auto', flexShrink: 0, display: 'block', transition: 'all 0.5s ease, filter 0.3s ease, transform 0.5s ease', filter: h ? 'brightness(1.1)' : 'brightness(1)', transform: 'translateX(0)' }} />
      )}
      {pill.expandedType === 'text' ? (
        <span style={{ opacity: h ? 1 : 0, width: h ? 'auto' : 0, overflow: 'hidden', transition: 'all 0.5s ease, color 0.3s ease', flexShrink: 0, maxWidth: h ? '200px' : 0, whiteSpace: 'nowrap', color: c, lineHeight: '1.2' }}>{pill.expanded}</span>
      ) : (
        <ExternalLink style={{ opacity: h ? 1 : 0, width: h ? '0.75rem' : 0, overflow: 'hidden', transition: 'all 0.5s ease, color 0.3s ease', flexShrink: 0, height: '0.75rem', color: c }} />
      )}
    </span>
  );
}

export function TXL() {
  return (
    <div className="text-xs text-muted-foreground leading-relaxed mb-3 pb-3 border-b flex items-center flex-wrap">
      <span style={{display: 'inline-flex', alignItems: 'center', height: '24px', lineHeight: 1, paddingBottom: '2px'}}>
        <strong style={{marginRight: '0.25rem'}}>Screener</strong><span>is maintained by</span>
        <Pill pill={createPill('txl', 'TXL', 'icon', '#c084fc', 'https://txl.app/projects', 'text', 'icon')} />
      </span>
    </div>
  );
}
