import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const indicatorRef = React.useRef<HTMLDivElement | null>(null)
  const closestTabRef = React.useRef<HTMLElement | null>(null)
  const justDraggedRef = React.useRef(false)
  const [indicatorStyle, setIndicatorStyle] = React.useState<React.CSSProperties>({})
  const [isDragging, setIsDragging] = React.useState(false)
  const [dragStartX, setDragStartX] = React.useState(0)
  const [dragStartLeft, setDragStartLeft] = React.useState(0)
  const [currentLeft, setCurrentLeft] = React.useState(0)
  
  React.useEffect(() => {
    const updateIndicator = () => {
      if (!listRef.current || isDragging || justDraggedRef.current) return
      
      const activeTab = listRef.current.querySelector('[data-state="active"]') as HTMLElement
      if (!activeTab) return
      
      const listRect = listRef.current.getBoundingClientRect()
      const tabRect = activeTab.getBoundingClientRect()
      
      const left = tabRect.left - listRect.left
      setCurrentLeft(left)
      setIndicatorStyle({
        left: `${left}px`,
        width: `${tabRect.width}px`,
      })
    }
    
    // Initial update
    const timeoutId = setTimeout(updateIndicator, 0)
    
    updateIndicator()
    
    // Update on resize
    const resizeObserver = new ResizeObserver(updateIndicator)
    if (listRef.current) {
      resizeObserver.observe(listRef.current)
    }
    
    // Update when tabs change
    const mutationObserver = new MutationObserver(updateIndicator)
    if (listRef.current) {
      mutationObserver.observe(listRef.current, {
        attributes: true,
        attributeFilter: ['data-state'],
        subtree: true,
      })
    }
    
    return () => {
      clearTimeout(timeoutId)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [children, isDragging])
  
  const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!indicatorRef.current || !listRef.current) return
    
    setIsDragging(true)
    const rect = indicatorRef.current.getBoundingClientRect()
    setDragStartX(e.clientX)
    setDragStartLeft(rect.left - listRef.current.getBoundingClientRect().left)
  }, [])
  
  React.useEffect(() => {
    if (!isDragging) return
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!listRef.current || !indicatorRef.current) return
      
      const listRect = listRef.current.getBoundingClientRect()
      const diff = e.clientX - dragStartX
      const indicatorWidth = parseFloat(indicatorStyle.width as string || '0')
      const rawLeft = dragStartLeft + diff
      
      // Get all tabs and their positions for snapping
      const tabs = Array.from(listRef.current.querySelectorAll('[role="tab"]')) as HTMLElement[]
      let snappedLeft = rawLeft
      let minDistance = Infinity
      let closestTab: HTMLElement | null = null
      
      // Find the closest tab to snap to
      for (const tab of tabs) {
        const tabRect = tab.getBoundingClientRect()
        const tabLeft = tabRect.left - listRect.left
        const tabCenter = tabLeft + tabRect.width / 2
        const indicatorCenter = rawLeft + indicatorWidth / 2
        const distance = Math.abs(indicatorCenter - tabCenter)
        
        if (distance < minDistance) {
          minDistance = distance
          // Snap to the tab's left position
          snappedLeft = tabLeft
          closestTab = tab
        }
      }
      
      // Constrain to bounds
      const constrainedLeft = Math.max(4, Math.min(listRect.width - 4 - indicatorWidth, snappedLeft))
      
      setCurrentLeft(constrainedLeft)
      setIndicatorStyle(prev => ({
        ...prev,
        left: `${constrainedLeft}px`,
      }))
      
      // Store the closest tab for mouse up
      if (closestTab) {
        closestTabRef.current = closestTab
      }
    }
    
    const handleMouseUp = () => {
      if (!listRef.current) return
      
      // Use the closest tab from the last mouse move
      const closestTab = closestTabRef.current
      
      if (closestTab) {
        // Set flag to prevent indicator from updating immediately
        justDraggedRef.current = true
        
        // Try multiple methods to trigger the tab change
        // Method 1: Direct click
        closestTab.click()
        
        // Method 2: Dispatch mouse events
        const mouseDownEvent = new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view: window,
        })
        const mouseUpEvent = new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          view: window,
        })
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
        })
        
        closestTab.dispatchEvent(mouseDownEvent)
        closestTab.dispatchEvent(mouseUpEvent)
        closestTab.dispatchEvent(clickEvent)
        
        // Method 3: Try to get the value and trigger via Radix
        const tabValue = closestTab.getAttribute('data-value') || 
                        closestTab.getAttribute('value') ||
                        closestTab.id?.match(/trigger-(.+)$/)?.[1]
        
        if (tabValue) {
          // Find the Tabs root and try to set value
          const tabsRoot = listRef.current.closest('[data-radix-tabs-root]') || 
                         listRef.current.parentElement
          if (tabsRoot) {
            // Try to find and click the trigger with this value
            const triggerWithValue = tabsRoot.querySelector(`[value="${tabValue}"]`) as HTMLElement
            if (triggerWithValue && triggerWithValue !== closestTab) {
              triggerWithValue.click()
            }
          }
        }
        
        // Wait for the tab to actually change before allowing indicator updates
        setTimeout(() => {
          justDraggedRef.current = false
        }, 150)
      } else {
        // Fallback: find which tab the indicator center is over
        const listRect = listRef.current.getBoundingClientRect()
        const indicatorWidth = parseFloat(indicatorStyle.width as string || '0')
        const indicatorCenter = currentLeft + indicatorWidth / 2
        
        const tabs = Array.from(listRef.current.querySelectorAll('[role="tab"]')) as HTMLElement[]
        for (const tab of tabs) {
          const tabRect = tab.getBoundingClientRect()
          const tabLeft = tabRect.left - listRect.left
          const tabRight = tabLeft + tabRect.width
          
          if (indicatorCenter >= tabLeft && indicatorCenter <= tabRight) {
            justDraggedRef.current = true
            
            // Try multiple methods to trigger the tab change
            tab.click()
            
            const mouseDownEvent = new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
              view: window,
            })
            const mouseUpEvent = new MouseEvent('mouseup', {
              bubbles: true,
              cancelable: true,
              view: window,
            })
            const clickEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
            })
            
            tab.dispatchEvent(mouseDownEvent)
            tab.dispatchEvent(mouseUpEvent)
            tab.dispatchEvent(clickEvent)
            
            setTimeout(() => {
              justDraggedRef.current = false
            }, 150)
            break
          }
        }
      }
      
      setIsDragging(false)
      
      // Clean up
      closestTabRef.current = null
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, dragStartX, dragStartLeft, indicatorStyle])
  
  const setRefs = React.useCallback((node: HTMLDivElement | null) => {
    // Update the forwarded ref
    if (typeof ref === 'function') {
      ref(node)
    } else if (ref) {
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = node
    }
    // Update the internal ref
    listRef.current = node
  }, [ref])
  
  return (
    <TabsPrimitive.List
      ref={setRefs}
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground relative",
        className
      )}
      {...props}
    >
      <div
        ref={indicatorRef}
        className={cn(
          "absolute top-1 bottom-1 bg-background rounded-sm shadow-sm z-0 select-none",
          !isDragging && "transition-all duration-500"
        )}
        style={{
          ...indicatorStyle,
          transitionTimingFunction: !isDragging ? 'cubic-bezier(0.4, 0, 0.2, 1)' : undefined,
        }}
      />
      {/* Transparent drag handle above buttons */}
      <div
        ref={indicatorRef}
        className="absolute top-1 bottom-1 cursor-grab active:cursor-grabbing z-30 pointer-events-auto"
        style={indicatorStyle}
        onMouseDown={handleMouseDown}
        draggable={false}
      />
      {children}
    </TabsPrimitive.List>
  )
})
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground data-[state=inactive]:text-muted-foreground relative z-10",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=inactive]:hidden",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
