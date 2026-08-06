'use client';

import * as Collapsible from '@radix-ui/react-collapsible';
import { BookIcon, ChevronDownIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ComponentProps } from 'react';

export type SourcesProps = ComponentProps<typeof Collapsible.Root>;

export const Sources = ({ className, ...props }: SourcesProps) => (
  <Collapsible.Root
    className={cn('not-prose text-primary text-xs', className)}
    {...props}
  />
);

export type SourcesTriggerProps = ComponentProps<typeof Collapsible.Trigger> & {
  count: number;
};

export const SourcesTrigger = ({
  className,
  count,
  children,
  ...props
}: SourcesTriggerProps) => (
  <Collapsible.Trigger className={cn('flex items-center gap-2', className)} {...props}>
    {children ?? (
      <>
        <p className="font-medium">Used {count} {count === 1 ? 'source' : 'sources'}</p>
        <ChevronDownIcon className="h-4 w-4 transition-transform duration-200 data-[state=open]:rotate-180" />
      </>
    )}
  </Collapsible.Trigger>
);

export type SourcesContentProps = ComponentProps<typeof Collapsible.Content>;

export const SourcesContent = ({
  className,
  ...props
}: SourcesContentProps) => (
  <Collapsible.Content
    className={cn(
      'mt-3 flex w-fit flex-col gap-2',
      'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
      className
    )}
    {...props}
  />
);

export type SourceProps = ComponentProps<'a'> & {
  title?: string;
};

export const Source = ({ href, title, children, className, ...props }: SourceProps) => (
  <a
    className={cn('flex items-center gap-2 hover:underline', className)}
    href={href}
    rel="noreferrer"
    target="_blank"
    {...props}
  >
    {children ?? (
      <>
        <BookIcon className="h-4 w-4" />
        <span className="block font-medium">{title || href}</span>
      </>
    )}
  </a>
);

