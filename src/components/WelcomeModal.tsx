import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, ChevronLeft, ChevronRight, VolumeX } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { LiquidGlassFilters } from "@/components/ui/liquid-glass-filters";
import { TXL } from "@/components/TXL";

interface WelcomeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Liquid glass style constants
const liquidGlassBase = {
  background: 'linear-gradient(-75deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0.05))',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  boxShadow: `
    inset 0 0.125em 0.125em rgba(0, 0, 0, 0.1),
    0 0.25em 0.125em -0.125em rgba(0, 0, 0, 0.2)
  `,
};

const liquidGlassHover = {
  boxShadow: `
    inset 0 0.125em 0.125em rgba(0, 0, 0, 0.15),
    0 0.15em 0.05em -0.1em rgba(0, 0, 0, 0.3)
  `,
};

export function WelcomeModal({ open, onOpenChange }: WelcomeModalProps) {
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [showArrows, setShowArrows] = useState(false);
  const [isMuted, setIsMuted] = useState(true); // Start muted for autoplay to work
  const [hasUnmutedBefore, setHasUnmutedBefore] = useState(() => {
    // Check if user has unmuted before (persisted in localStorage)
    return localStorage.getItem('video-has-unmuted') === 'true';
  });
  const isHoveredRef = useRef(false);
  const mobileVideoRef = useRef<HTMLVideoElement>(null);
  const desktopVideoRef = useRef<HTMLVideoElement>(null);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const [carouselEl, setCarouselEl] = useState<HTMLDivElement | null>(null);
  const setCarouselRef = useCallback((node: HTMLDivElement | null) => {
    carouselRef.current = node;
    setCarouselEl(node);
  }, []);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Get the currently visible video (mobile or desktop)
  const getCurrentVideo = (): HTMLVideoElement | null => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024;
    return isMobile ? mobileVideoRef.current : desktopVideoRef.current;
  };

  // Toggle mute/unmute
  const toggleMute = () => {
    const willBeUnmuted = isMuted; // If currently muted, clicking will unmute
    setIsMuted(!isMuted);
    const video = getCurrentVideo();
    if (video) {
      video.muted = !isMuted;
    }
    // If user is unmuting, mark that they've unmuted before
    if (willBeUnmuted && !hasUnmutedBefore) {
      setHasUnmutedBefore(true);
      localStorage.setItem('video-has-unmuted', 'true');
    }
  };

  // Sync video muted state when isMuted changes
  useEffect(() => {
    const video = getCurrentVideo();
    if (video) {
      video.muted = isMuted;
    }
  }, [isMuted]);

  // Pause video when navigating away from video page (mobile only) or when modal closes
  useEffect(() => {
    // Pause both videos if modal is closed
    if (!open) {
      if (mobileVideoRef.current) {
        mobileVideoRef.current.pause();
        mobileVideoRef.current.muted = true;
        mobileVideoRef.current.volume = 0;
      }
      if (desktopVideoRef.current) {
        desktopVideoRef.current.pause();
        desktopVideoRef.current.muted = true;
        desktopVideoRef.current.volume = 0;
      }
      return;
    }
    
    // Check if we're on mobile by checking window width
    // On mobile (< 1024px), we have a carousel with pages
    // On desktop (>= 1024px), video is always visible
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024;
    const mobileVideo = mobileVideoRef.current;
    const desktopVideo = desktopVideoRef.current;
    
    if (isMobile) {
      // Mobile: pause when not on page 0 (video page), play when on page 0
      if (currentPage !== 0) {
        // Force pause and mute to stop sound immediately
        if (mobileVideo) {
          mobileVideo.pause();
          mobileVideo.muted = true;
          mobileVideo.volume = 0;
        }
        // Also pause desktop video (shouldn't be visible, but just in case)
        if (desktopVideo) {
          desktopVideo.pause();
          desktopVideo.muted = true;
          desktopVideo.volume = 0;
        }
      } else {
        // Restart video from beginning when returning to video page
        if (mobileVideo) {
          mobileVideo.currentTime = 0;
          mobileVideo.volume = 1;
          mobileVideo.muted = isMuted;
          mobileVideo.play().catch(err => {
            // Ignore autoplay errors
            console.log('Video play error (may be autoplay policy):', err);
          });
        }
        // Ensure desktop video is paused on mobile
        if (desktopVideo) {
          desktopVideo.pause();
          desktopVideo.muted = true;
          desktopVideo.volume = 0;
        }
      }
    } else {
      // Desktop: video is always visible, so always play
      if (desktopVideo) {
        desktopVideo.volume = 1;
        desktopVideo.muted = isMuted;
        desktopVideo.play().catch(err => {
          console.log('Video play error (may be autoplay policy):', err);
        });
      }
      // Ensure mobile video is paused on desktop
      if (mobileVideo) {
        mobileVideo.pause();
        mobileVideo.muted = true;
        mobileVideo.volume = 0;
      }
    }
  }, [currentPage, open, isMuted]);

  // Reset loading state when modal opens and check if video is already loaded
  useEffect(() => {
    if (open) {
      setCurrentPage(0);
      // Reset scroll position to 0 when modal opens
      if (carouselRef.current) {
        carouselRef.current.scrollLeft = 0;
      }
      // Small delay to ensure video element is rendered
      const checkVideoReady = () => {
        const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024;
        const video = isMobile ? mobileVideoRef.current : desktopVideoRef.current;
        if (video) {
          // Check if video is already loaded (cached)
          // readyState 3 = HAVE_FUTURE_DATA, 4 = HAVE_ENOUGH_DATA
          if (video.readyState >= 3) {
            setIsVideoLoading(false);
          } else {
            setIsVideoLoading(true);
          }
        } else {
          // If video ref not ready yet, check again after a short delay
          setTimeout(checkVideoReady, 50);
        }
      };
      checkVideoReady();
    }
  }, [open]);

  // Handle scroll to detect current page and show/hide arrows
  useEffect(() => {
    if (!open || !carouselEl) return;

    const carousel = carouselEl;

    let scrollTimeout: NodeJS.Timeout;
    let rafId: number | null = null;

    // Helper function to update page state
    const updatePage = () => {
      const scrollLeft = carousel.scrollLeft;
      const pageWidth = carousel.clientWidth;
      
      if (pageWidth === 0) return;
      
      // Calculate which page we're on - use Math.round for reliable snap detection
      // Add a small offset (5% of page width) to handle edge cases
      const offset = pageWidth * 0.05;
      const rawPage = (scrollLeft + offset) / pageWidth;
      const detectedPage = Math.round(rawPage);
      const clampedPage = Math.min(Math.max(detectedPage, 0), 2);
      
      setCurrentPage(clampedPage);
      
      // Immediately pause video if navigating away from page 0 (video page)
      if (clampedPage !== 0) {
        if (mobileVideoRef.current) {
          mobileVideoRef.current.pause();
          mobileVideoRef.current.muted = true;
          mobileVideoRef.current.volume = 0;
        }
        if (desktopVideoRef.current) {
          desktopVideoRef.current.pause();
          desktopVideoRef.current.muted = true;
          desktopVideoRef.current.volume = 0;
        }
      }
    };

    // Initial check - use a small delay to ensure carousel is fully rendered
    const initialCheck = setTimeout(() => {
      updatePage();
    }, 50);
    
    // Use requestAnimationFrame for smoother updates during scroll
    const handleScroll = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        updatePage();
        setShowArrows(true);
      });
      
      // Hide arrows after scrolling stops
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        updatePage(); // Final check
        if (!isHoveredRef.current) {
          setShowArrows(false);
        }
      }, 300);
    };

    // Also listen for scrollend event if available (better for snap detection)
    const handleScrollEnd = () => {
      // Use a small delay to ensure scroll position is finalized
      setTimeout(() => {
        updatePage();
        if (!isHoveredRef.current) {
          setShowArrows(false);
        }
      }, 10);
    };
    
    carousel.addEventListener('scroll', handleScroll, { passive: true });
    // scrollend is supported in modern browsers and works better with scroll-snap
    if ('onscrollend' in window) {
      carousel.addEventListener('scrollend', handleScrollEnd);
    }
    
    // Also listen for touch events to catch touch scrolling
    const handleTouchEnd = () => {
      setTimeout(() => {
        updatePage();
      }, 100);
    };
    
    carousel.addEventListener('touchend', handleTouchEnd, { passive: true });
    
    return () => {
      clearTimeout(initialCheck);
      carousel.removeEventListener('scroll', handleScroll);
      if ('onscrollend' in window) {
        carousel.removeEventListener('scrollend', handleScrollEnd);
      }
      carousel.removeEventListener('touchend', handleTouchEnd);
      if (rafId) cancelAnimationFrame(rafId);
      clearTimeout(scrollTimeout);
    };
  }, [open, carouselEl]);

  // Extra bouncy easing function with more pronounced bounce
  const easeOutBounce = (t: number): number => {
    const n1 = 7.5625;
    const d1 = 2.75;
    
    if (t < 1 / d1) {
      return n1 * t * t;
    } else if (t < 2 / d1) {
      return n1 * (t -= 1.5 / d1) * t + 0.75;
    } else if (t < 2.5 / d1) {
      return n1 * (t -= 2.25 / d1) * t + 0.9375;
    } else {
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    }
  };

  // Custom scroll with extra bouncy animation
  const scrollToPage = (target: number, duration: number = 300) => {
    if (!carouselRef.current) return;
    const start = carouselRef.current.scrollLeft;
    const pageWidth = carouselRef.current.clientWidth;
    const distance = target * pageWidth - start;
    let startTime: number | null = null;

    const animateScroll = (currentTime: number) => {
      if (startTime === null) startTime = currentTime;
      const timeElapsed = currentTime - startTime;
      const progress = Math.min(timeElapsed / duration, 1);
      
      // Apply extra bouncy easing - overshoot slightly then settle
      let eased = easeOutBounce(progress);
      
      // Add extra bounce by overshooting then settling
      if (progress > 0.7) {
        const overshoot = (progress - 0.7) / 0.3;
        const bounce = Math.sin(overshoot * Math.PI * 3) * 0.1 * (1 - overshoot);
        eased = Math.min(1, eased + bounce);
      }
      
      carouselRef.current!.scrollLeft = start + distance * eased;

      if (progress < 1) {
        requestAnimationFrame(animateScroll);
      } else {
        // Animation completed - ensure current page is updated
        const clampedTarget = Math.min(Math.max(target, 0), 2);
        setCurrentPage(clampedTarget);
        // Also trigger a scroll event to ensure page detection is accurate
        if (carouselRef.current) {
          const event = new Event('scroll', { bubbles: true });
          carouselRef.current.dispatchEvent(event);
        }
      }
    };

    requestAnimationFrame(animateScroll);
  };

  // Navigation functions
  const goToPage = (page: number) => {
    scrollToPage(page, 500);
  };

  const goToNext = () => {
    if (currentPage < 2) {
      goToPage(currentPage + 1);
    }
  };

  const goToPrev = () => {
    if (currentPage > 0) {
      goToPage(currentPage - 1);
    }
  };

  // Glassy hover handlers with bouncy scale effect
  const pageIndicatorHandlers = {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      setShowArrows(true);
      const el = e.currentTarget;
      el.style.transform = 'translateX(-50%) scale(1.15)';
      el.style.boxShadow = liquidGlassHover.boxShadow;
      // Keep blur consistent to avoid white flash
      el.style.backdropFilter = 'blur(8px)';
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      const el = e.currentTarget;
      el.style.transform = 'translateX(-50%) scale(1)';
      el.style.boxShadow = liquidGlassBase.boxShadow;
      el.style.backdropFilter = 'blur(8px)';
    },
  };

  const arrowHandlers = {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      setShowArrows(true);
      const el = e.currentTarget;
      el.style.transform = 'translateY(-50%) scale(1.2)';
      el.style.boxShadow = liquidGlassHover.boxShadow;
      // Keep blur consistent to avoid white flash
      el.style.backdropFilter = 'blur(8px)';
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      const el = e.currentTarget;
      el.style.transform = 'translateY(-50%) scale(1)';
      el.style.boxShadow = liquidGlassBase.boxShadow;
      el.style.backdropFilter = 'blur(8px)';
    },
  };

  return (
    <>
      <LiquidGlassFilters />
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[480px] lg:max-w-5xl h-[85vh] sm:h-auto sm:max-h-[90vh] min-h-0 sm:min-h-auto p-0 overflow-hidden flex flex-col w-[95vw] sm:w-full rounded-lg gap-0 top-[7.5vh] sm:top-[50%] translate-y-0 sm:translate-y-[-50%] data-[state=open]:slide-in-from-top-[7.5vh] sm:data-[state=open]:slide-in-from-top-[48%] data-[state=closed]:slide-out-to-top-[7.5vh] sm:data-[state=closed]:slide-out-to-top-[48%]">
        {/* Header - Always visible on mobile */}
        <div className="lg:hidden flex-shrink-0 px-4 pt-3 pb-3 sm:pt-4 sm:pb-4 border-b bg-background">
          <DialogHeader className="!space-y-0 !pb-0">
            <div className="flex items-center gap-3 !pb-0 !mb-0">
              <img 
                src="/Screener.svg" 
                alt="Screener logo" 
                className="h-8 w-8"
              />
              <div className="flex-1">
                <DialogTitle className="text-xl sm:text-2xl !mb-0 text-left">Screener</DialogTitle>
                <p className="text-muted-foreground !mb-0 pt-1 pb-0 text-left" style={{ fontSize: '0.875rem' }}>
                 Hand-curated screener tracking the most important equities
                </p>
              </div>
            </div>
          </DialogHeader>
        </div>
        
        {/* Mobile: Swipeable carousel, Desktop: Grid layout */}
        <div 
          className="lg:grid lg:grid-cols-2 lg:gap-0 flex-1 min-h-0 overflow-hidden relative"
          onMouseEnter={() => {
            isHoveredRef.current = true;
            setShowArrows(true);
          }}
          onMouseLeave={() => {
            isHoveredRef.current = false;
            setShowArrows(false);
          }}
        >
          {/* Mobile carousel container */}
          <div 
            ref={setCarouselRef} 
            className="lg:hidden flex items-stretch overflow-x-auto snap-x snap-mandatory scrollbar-hide flex-1 min-h-0 h-full"
            style={{
              scrollBehavior: 'auto',
              scrollSnapType: 'x mandatory',
              WebkitOverflowScrolling: 'touch',
              overscrollBehaviorX: 'contain',
              scrollPadding: '0',
            }}
            onTouchStart={(e) => {
              setShowArrows(true);
              const touch = e.touches[0];
              touchStartRef.current = { x: touch.clientX, y: touch.clientY };
            }}
            onTouchMove={(e) => {
              if (!touchStartRef.current) return;
              
              const touch = e.touches[0];
              const deltaX = Math.abs(touch.clientX - touchStartRef.current.x);
              const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);
              
              // If vertical movement is significantly greater than horizontal, prevent horizontal scroll
              // This allows vertical scrolling within pages
              if (deltaY > deltaX && deltaY > 10) {
                e.preventDefault();
              }
            }}
            onTouchEnd={() => {
              touchStartRef.current = null;
              setTimeout(() => setShowArrows(false), 2000);
            }}
          >
            {/* Page 1: Video */}
            <div 
              className="min-w-full snap-start flex-shrink-0 relative flex items-center justify-center overflow-hidden w-full h-full max-w-full cursor-pointer"
              style={{ scrollSnapAlign: 'start', scrollSnapStop: 'always' }}
              onClick={toggleMute}
            >
              {isVideoLoading && (
                <div className="absolute inset-0 flex items-center justify-center z-10 bg-background">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Loading video...</p>
                  </div>
                </div>
              )}
              <video
                ref={mobileVideoRef}
                src="/intro.mp4"
                autoPlay
                loop
                muted={isMuted}
                playsInline
                className="w-full h-full object-cover object-center"
                style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
                onLoadStart={() => setIsVideoLoading(true)}
                onCanPlay={() => {
                  setIsVideoLoading(false);
                  // Ensure video plays when ready (autoplay might fail)
                  if (mobileVideoRef.current && open && currentPage === 0) {
                    mobileVideoRef.current.play().catch(err => {
                      console.log('Video play error (may be autoplay policy):', err);
                    });
                  }
                }}
                onLoadedData={() => {
                  setIsVideoLoading(false);
                  // Ensure video plays when data is loaded
                  if (mobileVideoRef.current && open && currentPage === 0) {
                    mobileVideoRef.current.play().catch(err => {
                      console.log('Video play error (may be autoplay policy):', err);
                    });
                  }
                }}
                onPlaying={() => setIsVideoLoading(false)}
                onError={() => setIsVideoLoading(false)}
              />
              {/* Mute button overlay - only shown when muted */}
              {isMuted && (
                <div className="absolute top-4 left-4 z-20">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMute();
                    }}
                    className={`${hasUnmutedBefore ? 'p-2.5' : 'px-4 py-2.5'} rounded-full transition-all duration-200 hover:scale-110 outline-none focus:outline-none focus:ring-0 flex items-center gap-2.5`}
                    style={{
                      ...liquidGlassBase,
                      transition: 'transform 0.2s cubic-bezier(0.68, -0.55, 0.265, 1.55), box-shadow 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'scale(1.05)';
                      e.currentTarget.style.boxShadow = liquidGlassHover.boxShadow;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                      e.currentTarget.style.boxShadow = liquidGlassBase.boxShadow;
                    }}
                    aria-label="Unmute video"
                  >
                    <VolumeX className="w-5 h-5 text-black flex-shrink-0" />
                    {!hasUnmutedBefore && (
                      <span 
                        className="font-semibold text-black whitespace-nowrap"
                        style={{
                          fontSize: '1rem',
                          lineHeight: '1.25rem',
                          textShadow: '-0.2px -0.2px 0 rgba(128, 128, 128, 0.6), 0.2px -0.2px 0 rgba(128, 128, 128, 0.6), -0.2px 0.2px 0 rgba(128, 128, 128, 0.6), 0.2px 0.2px 0 rgba(128, 128, 128, 0.6)'
                        }}
                      >
                        Unmute for a better experience!
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>
            
            {/* Page 2: Content */}
            <div 
              className="min-w-full snap-start flex-shrink-0 w-full h-full flex flex-col" 
              style={{ 
                scrollSnapAlign: 'start', 
                scrollSnapStop: 'always'
              }}
            >
              <div 
                className="flex-1 overflow-y-auto px-4"
                style={{
                  WebkitOverflowScrolling: 'touch',
                  overscrollBehaviorY: 'auto',
                  overscrollBehaviorX: 'contain',
                  touchAction: 'pan-y',
                  minHeight: 0
                }}
                onTouchStart={(e) => {
                  // Stop propagation to prevent carousel from handling vertical scrolls
                  const touch = e.touches[0];
                  touchStartRef.current = { x: touch.clientX, y: touch.clientY };
                }}
                onTouchMove={(e) => {
                  if (!touchStartRef.current) return;
                  
                  const touch = e.touches[0];
                  const deltaX = Math.abs(touch.clientX - touchStartRef.current.x);
                  const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);
                  
                  // If scrolling vertically, stop propagation to carousel
                  if (deltaY > deltaX && deltaY > 5) {
                    e.stopPropagation();
                  }
                }}
              >
                <div className="mt-2 sm:mt-4 w-full max-w-full">
                  <a 
                    href="https://x.com/commonsenseplay/status/1989140372698853654"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block relative cursor-pointer group w-full max-w-full"
                  >
                    <img 
                      src="/Tweet.png" 
                      alt="Returns chart" 
                      className="w-full max-w-full h-auto rounded-lg block"
                      style={{ 
                        border: '1px solid rgb(47, 51, 54)',
                        borderRadius: '12px',
                        boxSizing: 'border-box'
                      }}
                    />
                    <div 
                      data-image-overlay
                      className="absolute top-1/2 left-1/2 rounded-full w-10 h-10 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-all duration-150 ease-in-out flex items-center justify-center"
                      style={{
                        transform: 'translate(-50%, -50%)',
                        ...liquidGlassBase,
                        transition: 'opacity 0.2s cubic-bezier(0.68, -0.55, 0.265, 1.55), transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55), box-shadow 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1.2)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1)';
                      }}
                    >
                      <span className="text-lg font-bold text-white drop-shadow-sm">𝕏</span>
                    </div>
                  </a>
                </div>

                <div className="space-y-4 py-3 sm:py-4 pb-24">
                  <div>
                    <p className="text-sm leading-relaxed">
                      Valuations are at all-time highs but it's hard to stay entirely uninvested with interest rates where they are. 
                      This screener is designed to track a few of the most important equities and pulls in a few technical indicators to help you better time entries. 
                    </p>
                  </div>
                  
                  <div>
                    <h3 className="font-semibold text-base mb-2">General rule of thumb:</h3>
                    <ol className="list-decimal list-inside space-y-2 text-sm leading-relaxed">
                      <li>Daily RSI oversold means it's a good time to buy (a bit).</li>
                      <li>Daily RSI overbought means it's a good time to sell (a bit).</li>
                      <li>Start with smaller positions and DCA when possible.</li>
                  </ol>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Page 3: Footer */}
            <div 
              className="min-w-full snap-start flex-shrink-0 w-full h-full px-4 py-3 sm:py-4" 
              style={{ 
                scrollSnapAlign: 'start', 
                scrollSnapStop: 'always'
              }}
            >
              {/* Built with section */}
              <TXL />
            
              {/* Disclaimer section */}
              <div className="space-y-1 text-xs text-muted-foreground leading-relaxed pb-3 sm:pb-4 mb-8 sm:mb-12">
                <p style={{ lineHeight: '24px', marginBottom: '2px' }}>
                  <strong>Stale data:</strong> Data may be delayed by 15+ minutes.
                </p>
                <p style={{ marginTop: 0, lineHeight: '24px', marginBottom: '2px' }}>
                  <strong>Not financial advice:</strong> For informational purposes only.
                </p>
              </div>
            </div>
          </div>
          
          {/* Page indicators (dots) - positioned relative to parent */}
          <div 
            className="lg:hidden absolute bottom-4 left-1/2 z-30 pointer-events-auto flex gap-2 px-4 py-2 rounded-full"
            style={{
              transform: 'translateX(-50%)',
              ...liquidGlassBase,
              transition: 'transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55), box-shadow 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
            }}
            {...pageIndicatorHandlers}
          >
            {[0, 1, 2].map((page) => (
              <button
                key={page}
                onClick={() => goToPage(page)}
                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                  currentPage === page
                    ? 'bg-foreground/90 dark:bg-white/90 scale-110'
                    : 'bg-foreground/40 dark:bg-white/40'
                }`}
                aria-label={`Go to page ${page + 1}`}
              />
            ))}
          </div>
          
          {/* Left arrow - visible when not on first page and hovered */}
          <button
            onClick={goToPrev}
            disabled={currentPage === 0}
            className={`lg:hidden absolute left-2 top-1/2 z-30 p-2.5 rounded-full ${
              currentPage === 0 || !showArrows ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'
            }`}
            style={{
              transform: 'translateY(-50%)',
              ...liquidGlassBase,
              transition: 'opacity 0.2s cubic-bezier(0.68, -0.55, 0.265, 1.55), transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55), box-shadow 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
            }}
            {...arrowHandlers}
            aria-label="Previous page"
          >
            <ChevronLeft className="w-5 h-5 text-foreground drop-shadow-sm" />
          </button>
          
          {/* Right arrow - visible when not on last page and hovered */}
          <button
            onClick={goToNext}
            disabled={currentPage === 2}
            className={`lg:hidden absolute right-2 top-1/2 z-30 p-2.5 rounded-full ${
              currentPage === 2 || !showArrows ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'
            }`}
            style={{
              transform: 'translateY(-50%)',
              ...liquidGlassBase,
              transition: 'opacity 0.2s cubic-bezier(0.68, -0.55, 0.265, 1.55), transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55), box-shadow 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
            }}
            {...arrowHandlers}
            aria-label="Next page"
          >
            <ChevronRight className="w-5 h-5 text-foreground drop-shadow-sm" />
          </button>
          
          {/* Desktop: Video on left */}
          <div 
            className="hidden lg:flex relative items-center justify-center bg-background overflow-hidden min-h-0 cursor-pointer"
            onClick={toggleMute}
          >
            {isVideoLoading && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-8 w-8 animate-spin text-white" />
                  <p className="text-sm text-white/70">Loading video...</p>
                </div>
              </div>
            )}
            <video
              ref={desktopVideoRef}
              src="/intro.mp4"
              autoPlay
              loop
              muted={isMuted}
              playsInline
              className="w-full object-contain"
              style={{ width: '100%', minWidth: '100%', maxWidth: '100%', height: 'auto' }}
              onLoadStart={() => setIsVideoLoading(true)}
              onCanPlay={() => {
                setIsVideoLoading(false);
                // Ensure video plays when ready (autoplay might fail)
                if (desktopVideoRef.current && open) {
                  desktopVideoRef.current.play().catch(err => {
                    console.log('Video play error (may be autoplay policy):', err);
                  });
                }
              }}
              onLoadedData={() => {
                setIsVideoLoading(false);
                // Ensure video plays when data is loaded
                if (desktopVideoRef.current && open) {
                  desktopVideoRef.current.play().catch(err => {
                    console.log('Video play error (may be autoplay policy):', err);
                  });
                }
              }}
              onPlaying={() => setIsVideoLoading(false)}
              onError={() => setIsVideoLoading(false)}
            />
            {/* Mute button overlay - only shown when muted */}
            {isMuted && (
              <div className="absolute bottom-4 left-4 z-20">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMute();
                  }}
                  className={`${hasUnmutedBefore ? 'p-2.5' : 'px-4 py-2.5'} rounded-full transition-all duration-200 hover:scale-110 outline-none focus:outline-none focus:ring-0 flex items-center gap-2.5`}
                  style={{
                    ...liquidGlassBase,
                    transition: 'transform 0.2s cubic-bezier(0.68, -0.55, 0.265, 1.55), box-shadow 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.05)';
                    e.currentTarget.style.boxShadow = liquidGlassHover.boxShadow;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.boxShadow = liquidGlassBase.boxShadow;
                  }}
                  aria-label="Unmute video"
                >
                  <VolumeX className="w-5 h-5 text-black drop-shadow-lg flex-shrink-0" />
                  {!hasUnmutedBefore && (
                    <span 
                      className="font-semibold text-black whitespace-nowrap"
                      style={{
                        fontSize: '1rem',
                        lineHeight: '1.25rem',
                        textShadow: '-0.2px -0.2px 0 rgba(128, 128, 128, 0.6), 0.2px -0.2px 0 rgba(128, 128, 128, 0.6), -0.2px 0.2px 0 rgba(128, 128, 128, 0.6), 0.2px 0.2px 0 rgba(128, 128, 128, 0.6)'
                      }}
                    >
                      Unmute for a better experience!
                    </span>
                  )}
                </button>
              </div>
            )}
          </div>
          
          {/* Desktop: Content on right */}
          <div className="hidden lg:flex p-6 flex-col min-h-0 overflow-hidden">
            {/* Sticky Header */}
            <div className="flex-shrink-0 pb-4 border-b bg-background">
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <img 
                    src="/Screener.svg" 
                    alt="Screener logo" 
                    className="h-6 w-6"
                  />
                  <DialogTitle className="text-2xl">Screener</DialogTitle>
                </div>
                <DialogDescription className="text-base text-muted-foreground">
                 Hand-curated screener tracking the most important equities
                </DialogDescription>
              </DialogHeader>
            </div>
            
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
              <div className="mt-4">
                <a 
                  href="https://x.com/commonsenseplay/status/1989140372698853654"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block relative cursor-pointer group w-full max-w-full"
                >
                  <img 
                    src="/Tweet.png" 
                    alt="Returns chart" 
                    className="w-full max-w-full h-auto rounded-lg block"
                    style={{ 
                      border: '1px solid rgb(47, 51, 54)',
                      borderRadius: '12px',
                      boxSizing: 'border-box'
                    }}
                  />
                  <div 
                    data-image-overlay
                    className="absolute top-1/2 left-1/2 rounded-full w-10 h-10 opacity-0 group-hover:opacity-100 transition-all duration-150 ease-in-out flex items-center justify-center"
                    style={{
                      transform: 'translate(-50%, -50%)',
                      ...liquidGlassBase,
                      transition: 'opacity 0.2s cubic-bezier(0.68, -0.55, 0.265, 1.55), transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55), box-shadow 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1.2)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1)';
                    }}
                  >
                    <span className="text-lg font-bold text-white drop-shadow-sm">𝕏</span>
                  </div>
                </a>
              </div>

              <div className="space-y-4 py-4 flex-1">
                <div>
                  <p className="text-sm leading-relaxed">
                    Valuations are at all-time highs but it's hard to stay entirely uninvested with interest rates where they are. 
                    This screener is designed to track a few of the most important equities and pulls in a few technical indicators to help you better time entries. 
                  </p>
                </div>
                
                <div>
                  <h3 className="font-semibold text-base mb-2">General rule of thumb:</h3>
                  <ol className="list-decimal list-inside space-y-2 text-sm leading-relaxed">
                    <li>Daily RSI oversold means it's a good time to buy (a bit).</li>
                    <li>Daily RSI overbought means it's a good time to sell (a bit).</li>
                    <li>Start with smaller positions and DCA when possible.</li>
                  </ol>
                </div>
              </div>
            </div>
            
            {/* Footer at bottom - sticky */}
            <div className="flex-shrink-0 pt-4 border-t bg-background">
              {/* Built with section */}
              <TXL />
              
              {/* Disclaimer section */}
              <div className="space-y-1 text-xs text-muted-foreground leading-relaxed">
                <p style={{ lineHeight: '24px', marginBottom: '2px' }}>
                  <strong>Stale data:</strong> Data may be delayed by 15+ minutes.
                </p>
                <p style={{ lineHeight: '24px', marginBottom: '2px', marginTop: 0 }}>
                  <strong>Not financial advice:</strong> For informational purposes only.
                </p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

