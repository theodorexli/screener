'use client';

import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ComponentProps } from 'react';

export type ToolProps = ComponentProps<typeof Collapsible.Root>;

export const Tool = ({ defaultOpen = false, className, ...props }: ToolProps) => (
  <Collapsible.Root defaultOpen={defaultOpen} className={cn('border rounded-lg', className)} {...props} />
);

export type ToolHeaderProps = Omit<ComponentProps<typeof Collapsible.Trigger>, 'type'> & {
  type: string;
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  articleCount?: number;
};

const stateConfig = {
  'input-streaming': { icon: Loader2, label: 'Running', color: 'text-blue-500' },
  'input-available': { icon: Clock, label: 'Pending', color: 'text-yellow-500' },
  'output-available': { icon: CheckCircle2, label: 'Completed', color: 'text-green-500' },
  'output-error': { icon: XCircle, label: 'Error', color: 'text-red-500' },
};

export const ToolHeader = ({ type: toolType, state, articleCount, className, ...props }: ToolHeaderProps) => {
  const config = stateConfig[state];
  const Icon = config.icon;
  
  // Show article count in label when completed
  const label = state === 'output-available' && articleCount !== undefined
    ? `Found ${articleCount} ${articleCount === 1 ? 'article' : 'articles'}`
    : config.label;

  return (
    <Collapsible.Trigger
      type="button"
      className={cn(
        'flex w-full items-center justify-between p-3 text-left hover:bg-muted/50 transition-colors group',
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Icon className={cn('h-4 w-4 flex-shrink-0', config.color)} />
        <span className="font-medium text-sm truncate">{toolType}</span>
        <span className={cn('text-xs px-1.5 py-0.5 rounded', config.color, 'bg-muted')}>
          {label}
        </span>
      </div>
      <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform duration-200" />
    </Collapsible.Trigger>
  );
};

export type ToolContentProps = ComponentProps<typeof Collapsible.Content>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <Collapsible.Content
    className={cn(
      'overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down',
      className
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<'div'> & {
  input: any;
};

export const ToolInput = ({ input, className, ...props }: ToolInputProps) => (
  <div className={cn('border-t p-3 bg-muted/30', className)} {...props}>
    <div className="text-xs font-medium text-muted-foreground mb-2">Parameters</div>
    <pre className="text-xs bg-background p-2 rounded border overflow-x-auto">
      {JSON.stringify(input, null, 2)}
    </pre>
  </div>
);

export type ToolOutputProps = ComponentProps<'div'> & {
  output: React.ReactNode;
  errorText?: string;
  articleCount?: number;
};

export const ToolOutput = ({ output, errorText, articleCount, className, ...props }: ToolOutputProps) => (
  <div className={cn('border-t p-3', className)} {...props}>
    {errorText ? (
      <>
        <div className="text-xs font-medium text-red-500 mb-2">Error</div>
        <div className="text-sm text-red-600 dark:text-red-400">{errorText}</div>
      </>
    ) : (
      <>
        <div className="text-xs font-medium text-muted-foreground mb-2">
          Output{articleCount !== undefined ? `: ${articleCount} ${articleCount === 1 ? 'article' : 'articles'} found` : ''}
        </div>
        <div className="text-sm">{output}</div>
      </>
    )}
  </div>
);

