import { useState, useMemo, useRef, useCallback, useEffect, memo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ArrowUpDown, ArrowUp, ArrowDown, Palette, X, Plus, HelpCircle, Bookmark } from "lucide-react";
import { type StockTicker } from "@/data/stockTickers";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { fetchTableConfig } from "@/services/api";

interface StockTableProps {
  onRowClick: (stock: StockTicker | null) => void;
  selectedStock: StockTicker | null;
  watchlist: StockTicker[];
  isLoading?: boolean;
  stickyHeaderOffset?: number;
  watchlists?: Array<{ id: string; name: string; symbols: string[] }>;
  activeWatchlist?: string;
  symbolMetadata?: Record<string, { longName?: string; website?: string }>;
}

interface ColorRule {
  operator: "<" | ">" | "<=" | ">=" | "==" | "vwap_above_price" | "vwap_below_price";
  value?: number; // Optional for special operators like vwap comparisons
  color: string;
}

interface ColumnColorRules {
  [columnKey: string]: ColorRule[];
}

const DEFAULT_WIDTHS: Record<string, number> = {
  symbol: 110,
  price: 80,
  changePercent: 90,
  change: 90,
  volume: 90,
  rsi: 80,
  macd: 80,
  vwap: 80,
};

const MOBILE_WIDTHS: Record<string, number> = {
  symbol: 120,
  price: 100,
  changePercent: 100,
  change: 100,
  volume: 110,
  rsi: 100,
  macd: 100,
  vwap: 100,
};

type SortColumn = keyof StockTicker | null;
type SortDirection = "asc" | "desc";

export const StockTable = memo(function StockTable({ onRowClick, selectedStock, watchlist, isLoading = false, stickyHeaderOffset = 0, watchlists = [], activeWatchlist = "", symbolMetadata: _symbolMetadata = {} }: StockTableProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS);

  // Detect mobile screen size and set appropriate default widths
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768; // md breakpoint
      setIsMobile(mobile);
      if (mobile) {
        setColumnWidths(MOBILE_WIDTHS);
      } else {
        setColumnWidths(DEFAULT_WIDTHS);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  const [sortColumn, setSortColumn] = useState<SortColumn>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [columnColorRules, setColumnColorRules] = useState<ColumnColorRules>({});
  const [openColorPopover, setOpenColorPopover] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ rowIndex: number; columnKey: string } | null>(null);
  // Editing buffer - use ref to prevent re-renders during editing
  const editingRulesRef = useRef<ColumnColorRules>({});
  const tableRef = useRef<HTMLTableElement>(null);
  const prevWatchlistRef = useRef<string>("");

  // Column order for keyboard navigation
  const columnOrder = useMemo(() => ["symbol", "price", "changePercent", "change", "volume", "rsi", "macd", "vwap"], []);

  // Find other watchlists that contain this symbol
  const getOtherWatchlists = useCallback((symbol: string): Array<{ id: string; name: string }> => {
    if (!watchlists.length || !activeWatchlist) return [];
    
    const symbolUpper = symbol.toUpperCase();
    const otherWatchlists = watchlists
      .filter(wl => {
        // Exclude current watchlist
        if (wl.id === activeWatchlist) return false;
        // Check if symbol exists in this watchlist's symbols array
        if (!wl.symbols || !Array.isArray(wl.symbols)) return false;
        // Case-insensitive comparison - check if any symbol in the array matches
        return wl.symbols.some(s => String(s).toUpperCase() === symbolUpper);
      })
      .map(wl => ({ id: wl.id, name: wl.name }));
    
    return otherWatchlists;
  }, [watchlists, activeWatchlist]);

  // Clear selectedCell when selectedStock is deselected
  useEffect(() => {
    if (!selectedStock) {
      setSelectedCell(null);
    }
  }, [selectedStock]);

  // Clear selectedCell when watchlist actually changes (by comparing symbols)
  useEffect(() => {
    const currentWatchlistKey = watchlist.map(s => s.symbol).join(",");
    if (prevWatchlistRef.current && prevWatchlistRef.current !== currentWatchlistKey) {
      setSelectedCell(null);
    }
    prevWatchlistRef.current = currentWatchlistKey;
  }, [watchlist]);

  // Load default table configuration and color rules
  useEffect(() => {
    // Load default config from API
    fetchTableConfig()
      .then((data) => {
          // Apply default sort
          if (data.defaultSort) {
            setSortColumn(data.defaultSort.column as keyof StockTicker);
            setSortDirection(data.defaultSort.direction as "asc" | "desc");
          }

          // Load saved color rules from localStorage
          const saved = localStorage.getItem("column-color-rules");
          let savedRules: ColumnColorRules = {};
          
          if (saved) {
            try {
              savedRules = JSON.parse(saved);
            } catch (e) {
              console.error("Failed to parse color rules:", e);
            }
          }

          // Merge default color rules with saved rules (defaults take precedence if not already set)
          // Ensure defaults are always included, even if API doesn't return them
          const apiDefaults = (data.defaultColorRules || {}) as ColumnColorRules;
          
          // Hardcoded fallback defaults in case API doesn't return them (synchronous)
          const fallbackDefaults: ColumnColorRules = {
            changePercent: [
              { operator: ">", value: 0, color: "#22c55e" },
              { operator: "<", value: 0, color: "#ef4444" }
            ],
            change: [
              { operator: ">", value: 0, color: "#22c55e" },
              { operator: "<", value: 0, color: "#ef4444" }
            ],
            vwap: [
              { operator: "vwap_below_price", color: "#22c55e" },
              { operator: "vwap_above_price", color: "#ef4444" }
            ],
            rsi: [
              { operator: "<", value: 30, color: "#ef4444" },
              { operator: ">", value: 70, color: "#22c55e" }
            ],
            macd: [
              { operator: ">", value: 0, color: "#22c55e" },
              { operator: "<", value: 0, color: "#ef4444" }
            ]
          };
          
          // Merge fallback defaults with API defaults (API takes precedence, but fallback fills missing ones)
          const defaultRules: ColumnColorRules = { ...fallbackDefaults, ...apiDefaults };
          const mergedRules: ColumnColorRules = { ...defaultRules };
          Object.keys(savedRules).forEach((key) => {
            // Ensure saved rules are arrays and only contain rules for this column
            if (!Array.isArray(savedRules[key])) {
              return; // Skip invalid entries
            }
            if (!mergedRules[key]) {
              // Filter out invalid rules
              mergedRules[key] = (savedRules[key] as ColorRule[]).filter(rule => {
                const isVwapOp = rule.operator === 'vwap_above_price' || rule.operator === 'vwap_below_price';
                return rule.operator && rule.color && (isVwapOp || rule.value !== undefined);
              });
            } else {
              // Merge arrays, keeping defaults first, only if savedRules[key] is an array
              const defaultRulesForColumn = Array.isArray(defaultRules[key]) ? defaultRules[key] as ColorRule[] : [];
              const savedRulesForColumn = Array.isArray(savedRules[key]) ? savedRules[key] as ColorRule[] : [];
              // Filter out invalid rules from saved rules
              const validSavedRules = savedRulesForColumn.filter(rule => {
                const isVwapOp = rule.operator === 'vwap_above_price' || rule.operator === 'vwap_below_price';
                return rule.operator && rule.color && (isVwapOp || rule.value !== undefined);
              });
              
              // Remove default rules from saved rules to avoid duplicates
              // Also remove any rules with values 25 or 75
              const userRulesOnly = validSavedRules.filter(savedRule => {
                // Remove rules with values 25 or 75
                if (savedRule.value === 25 || savedRule.value === 75) {
                  return false;
                }
                // Remove if it matches a default rule
                return !defaultRulesForColumn.some(defaultRule => 
                  defaultRule.operator === savedRule.operator &&
                  (defaultRule.value === savedRule.value || (defaultRule.value === undefined && savedRule.value === undefined)) &&
                  defaultRule.color === savedRule.color
                );
              });
              
              // Combine defaults with user rules only (no duplicates)
              mergedRules[key] = [...defaultRulesForColumn, ...userRulesOnly];
            }
          });

          // Clean up: Remove any rules with values 25 or 75 from all columns
          Object.keys(mergedRules).forEach((key) => {
            mergedRules[key] = mergedRules[key].filter(rule => {
              return rule.value !== 25 && rule.value !== 75;
            });
          });

          setColumnColorRules(mergedRules);
          editingRulesRef.current = JSON.parse(JSON.stringify(mergedRules));
          localStorage.setItem("column-color-rules", JSON.stringify(mergedRules));
        })
        .catch((err) => {
          console.error("Failed to load table config:", err);
          // Fallback to localStorage only
          const saved = localStorage.getItem("column-color-rules");
          if (saved) {
            try {
              const parsed = JSON.parse(saved);
              setColumnColorRules(parsed);
              editingRulesRef.current = JSON.parse(JSON.stringify(parsed));
            } catch (e) {
              console.error("Failed to parse color rules:", e);
            }
          }
        });
  }, []);



  const handleMouseDown = useCallback((columnKey: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const startX = e.clientX;
    const defaultWidths = isMobile ? MOBILE_WIDTHS : DEFAULT_WIDTHS;
    const startWidth = columnWidths[columnKey] || defaultWidths[columnKey];

    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - startX;
      const newWidth = Math.max(50, startWidth + diff);
      setColumnWidths((prev) => ({
        ...prev,
        [columnKey]: newWidth,
      }));
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [columnWidths, isMobile]);

  // Handle sort button click - cycles through: none -> asc -> desc -> none
  const handleSortClick = useCallback((columnKey: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    const isCurrentlySorted = sortColumn === columnKey;
    
    if (!isCurrentlySorted) {
      // Not sorted - set to ascending
      setSortColumn(columnKey as keyof StockTicker);
      setSortDirection("asc");
    } else if (sortDirection === "asc") {
      // Currently ascending - switch to descending
      setSortDirection("desc");
    } else {
      // Currently descending - clear sort
      setSortColumn(null);
    }
  }, [sortColumn, sortDirection]);

  const filteredStocks = useMemo(() => {
    let result = watchlist;

    // Apply sorting
    if (sortColumn) {
      result = [...result].sort((a, b) => {
        const aValue = a[sortColumn];
        const bValue = b[sortColumn];

        // Handle undefined/null values
        if (aValue === undefined || aValue === null) return 1;
        if (bValue === undefined || bValue === null) return -1;

        // Handle different types
        if (typeof aValue === "number" && typeof bValue === "number") {
          return sortDirection === "asc" ? aValue - bValue : bValue - aValue;
        }

        if (typeof aValue === "string" && typeof bValue === "string") {
          return sortDirection === "asc"
            ? aValue.localeCompare(bValue)
            : bValue.localeCompare(aValue);
        }

        return 0;
      });
    }

    return result;
  }, [watchlist, sortColumn, sortDirection]);

  // Keyboard navigation for spreadsheet-like behavior
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedCell || filteredStocks.length === 0) return;

      const { rowIndex, columnKey } = selectedCell;
      const currentColIndex = columnOrder.indexOf(columnKey);
      
      if (currentColIndex === -1) return;

      let newRowIndex = rowIndex;
      let newColIndex = currentColIndex;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          newRowIndex = Math.max(0, rowIndex - 1);
          break;
        case "ArrowDown":
          e.preventDefault();
          newRowIndex = Math.min(filteredStocks.length - 1, rowIndex + 1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          newColIndex = Math.max(0, currentColIndex - 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          newColIndex = Math.min(columnOrder.length - 1, currentColIndex + 1);
          break;
        case "Escape":
          e.preventDefault();
          setSelectedCell(null);
          return;
        default:
          return;
      }

      if (newRowIndex !== rowIndex || newColIndex !== currentColIndex) {
        setSelectedCell({
          rowIndex: newRowIndex,
          columnKey: columnOrder[newColIndex],
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCell, filteredStocks.length, columnOrder]);

  // Convert hex to rgba for better opacity control (Safari/iOS compatible)
  const hexToRgba = (hex: string, alpha: number) => {
    if (!hex || !hex.startsWith('#')) {
      return hex; // Return as-is if not a valid hex color
    }
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) {
      return hex; // Return as-is if parsing failed
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  // Get cell color based on rules (with special handling for VWAP vs Price)
  const getCellColor = (columnKey: string, value: number | undefined, stock?: StockTicker): string | null => {
    if (value === undefined || value === null) return null;
    
    const rules = columnColorRules[columnKey] || [];
    
    for (const rule of rules) {
      let matches = false;
      switch (rule.operator) {
        case "<":
          matches = rule.value !== undefined && value < rule.value;
          break;
        case ">":
          matches = rule.value !== undefined && value > rule.value;
          break;
        case "<=":
          matches = rule.value !== undefined && value <= rule.value;
          break;
        case ">=":
          matches = rule.value !== undefined && value >= rule.value;
          break;
        case "==":
          matches = rule.value !== undefined && value === rule.value;
          break;
        case "vwap_above_price":
          // VWAP > Price (stock trading below VWAP - bearish)
          matches = stock !== undefined && stock.price !== undefined && stock.price !== null && value > stock.price;
          break;
        case "vwap_below_price":
          // VWAP < Price (stock trading above VWAP - bullish)
          matches = stock !== undefined && stock.price !== undefined && stock.price !== null && value < stock.price;
          break;
      }
      if (matches) {
        return rule.color;
      }
    }
    return null;
  };


  const formatVolume = (num: number) => {
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    return num.toLocaleString();
  };

  // Edit color rules - only updates editing buffer ref, NO re-renders at all
  const addColorRule = useCallback((columnKey: string, rule: ColorRule, forceUpdate?: () => void) => {
    // Validate rule before adding
    const isVwapOp = rule.operator === 'vwap_above_price' || rule.operator === 'vwap_below_price';
    if (!rule.operator || !rule.color || (!isVwapOp && rule.value === undefined)) {
      return; // Invalid rule, don't add it
    }
    
    if (!editingRulesRef.current[columnKey]) {
      editingRulesRef.current[columnKey] = [];
    }
    editingRulesRef.current[columnKey] = [...editingRulesRef.current[columnKey], rule];
    // Let the caller decide if they want to update UI
    if (forceUpdate) forceUpdate();
  }, []);

  const removeColorRule = useCallback((columnKey: string, index: number, forceUpdate?: () => void) => {
    if (editingRulesRef.current[columnKey]) {
      editingRulesRef.current[columnKey] = editingRulesRef.current[columnKey].filter((_, i) => i !== index);
      if (editingRulesRef.current[columnKey].length === 0) {
        delete editingRulesRef.current[columnKey];
      }
      // Let the caller decide if they want to update UI
      if (forceUpdate) forceUpdate();
    }
  }, []);

  const updateColorRule = useCallback((columnKey: string, index: number, rule: ColorRule) => {
    if (editingRulesRef.current[columnKey]) {
      editingRulesRef.current[columnKey] = [...editingRulesRef.current[columnKey]];
      editingRulesRef.current[columnKey][index] = rule;
      // NO re-render during typing - inputs will manage their own state
    }
  }, []);

  // Save editing rules to main state and localStorage
  const saveEditingRules = useCallback(() => {
    setColumnColorRules(editingRulesRef.current);
    localStorage.setItem("column-color-rules", JSON.stringify(editingRulesRef.current));
  }, []);

  // Handle sort change from ColumnHeader
  const handleSortChange = useCallback((column: SortColumn, direction: SortDirection) => {
    setSortColumn(column);
    setSortDirection(direction);
  }, []);

  // Handle popover open change
  const handlePopoverOpenChange = useCallback((columnKey: string, open: boolean) => {
    setOpenColorPopover(open ? columnKey : null);
  }, []);

  // Number input that manages its own state to prevent parent re-renders
  const NumberInput = ({ initialValue, onValueChange, disabled }: { 
    initialValue: number; 
    onValueChange: (value: number) => void;
    disabled: boolean;
  }) => {
    const [localValue, setLocalValue] = useState(String(initialValue));
    
    useEffect(() => {
      setLocalValue(String(initialValue));
    }, [initialValue]);
    
    return (
      <Input
        type="number"
        value={localValue}
        onChange={(e) => {
          e.stopPropagation();
          setLocalValue(e.target.value);
          const numValue = parseFloat(e.target.value);
          if (!isNaN(numValue)) {
            onValueChange(numValue);
          }
        }}
        onKeyDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onFocus={(e) => e.stopPropagation()}
        onBlur={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        disabled={disabled}
        className="h-7 text-xs flex-1 px-2 py-0 focus-visible:ring-0 focus-visible:ring-offset-0 hover:bg-accent transition-colors"
        placeholder="Value"
      />
    );
  };

  // Column header component with popover - memoized to prevent re-renders
  const ColumnHeader = memo(({ 
    columnKey, 
    label, 
    textAlign = "left",
    isOpen,
    onOpenChange,
    columnColorRulesProp,
    sortColumnProp,
    sortDirectionProp,
    columnWidth,
    onSortClick,
    onMouseDown,
    onSortChange,
    onSaveEditingRules,
    onAddColorRule,
    onRemoveColorRule,
    onUpdateColorRule
  }: { 
    columnKey: string; 
    label: string;
    textAlign?: "left" | "right";
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    columnColorRulesProp: ColumnColorRules;
    sortColumnProp: SortColumn;
    sortDirectionProp: SortDirection;
    columnWidth: number;
    onSortClick: (columnKey: string, e: React.MouseEvent) => void;
    onMouseDown: (columnKey: string, e: React.MouseEvent) => void;
    onSortChange: (column: SortColumn, direction: SortDirection) => void;
    onSaveEditingRules: () => void;
    onAddColorRule: (columnKey: string, rule: ColorRule, forceUpdate?: () => void) => void;
    onRemoveColorRule: (columnKey: string, index: number, forceUpdate?: () => void) => void;
    onUpdateColorRule: (columnKey: string, index: number, rule: ColorRule) => void;
  }) => {
    const isNumeric = columnKey !== "symbol";
    
    // ALL state local to this component - completely isolated from parent
    const [, setLocalRulesVersion] = useState(0);
    const [isEditing, setIsEditing] = useState(false);
    const [showAddRule, setShowAddRule] = useState(false);
    const [newRule, setNewRule] = useState<Partial<ColorRule>>({ operator: "<", value: 0, color: "#ef4444" });
    
    const forceLocalUpdate = useCallback(() => setLocalRulesVersion(v => v + 1), []);
    
    // Sync editing buffer when popover opens - do this immediately
    useEffect(() => {
      if (isOpen && !isEditing) {
        // Sync editing buffer with current rules when popover opens (but not in editing mode)
        const currentRules = JSON.parse(JSON.stringify(columnColorRulesProp));
        editingRulesRef.current = currentRules;
      }
    }, [isOpen, isEditing, columnColorRulesProp]);
    
    // Get rules - always read from current rules when popover first opens, then use editing buffer when editing
    const rules = (() => {
      // When in editing mode, use editing buffer
      if (isEditing) {
        const editingRules = editingRulesRef.current[columnKey];
        if (Array.isArray(editingRules)) {
          return editingRules;
        }
      }
      // Otherwise, always use current rules (this ensures defaults show up)
      const currentRules = columnColorRulesProp[columnKey];
      if (Array.isArray(currentRules)) {
        return currentRules;
      }
      return [];
    })();
    
    const isSorted = sortColumnProp === columnKey;

    const handleOpenChangeInternal = useCallback((open: boolean) => {
      // Only close if explicitly requested
      if (!open && isOpen) {
        onOpenChange(false);
        // Reset editing mode when closing
        setIsEditing(false);
        setShowAddRule(false);
        // Reset editing buffer when closing without saving
        editingRulesRef.current = JSON.parse(JSON.stringify(columnColorRulesProp));
      } else if (open && !isOpen) {
        onOpenChange(true);
      }
    }, [isOpen, onOpenChange, columnColorRulesProp]);

    return (
      <Popover 
        open={isOpen} 
        onOpenChange={handleOpenChangeInternal}
        modal={false}
      >
        <PopoverTrigger asChild>
          <TableHead 
            className={`h-12 md:h-10 text-sm py-2 relative cursor-pointer select-none hover:bg-muted/50 focus:outline-none focus:ring-0 ${textAlign === "right" ? "text-right" : ""} ${columnKey === "symbol" ? "sticky left-0 z-20 bg-background" : ""}`}
            style={{ width: columnWidth }}
            onClick={(e) => {
              e.stopPropagation();
              if (isOpen) {
                onOpenChange(false);
              } else {
                onOpenChange(true);
              }
            }}
          >
            <div className={`flex items-center gap-1 ${textAlign === "right" ? "justify-end" : ""}`}>
              {label}
              {(isSorted || sortColumnProp === null) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 hover:bg-muted"
                  onClick={(e) => onSortClick(columnKey, e)}
                  title={`Sort by ${label}`}
                >
                  {isSorted ? (
                    sortDirectionProp === "asc" ? (
                      <ArrowUp className="h-3 w-3 text-primary" />
                    ) : (
                      <ArrowDown className="h-3 w-3 text-primary" />
                    )
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-50" />
                  )}
                </Button>
              )}
              {rules.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isOpen) {
                      onOpenChange(false);
                    } else {
                      onOpenChange(true);
                    }
                  }}
                  title="Color rules"
                >
                  <Palette className="h-3 w-3 text-primary" />
                </Button>
              )}
            </div>
            <div
              className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/50 active:bg-primary z-10"
              onMouseDown={(e) => onMouseDown(columnKey, e)}
              onClick={(e) => e.stopPropagation()}
            />
          </TableHead>
        </PopoverTrigger>
        <PopoverContent 
          className="w-80 outline-none focus:outline-none" 
          align="start"
          onEscapeKeyDown={() => onOpenChange(false)}
        >
          <div className="space-y-3">
            {/* Sort Section */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-medium">Sort</Label>
                <ButtonGroup>
                  <Button
                    variant={!isSorted ? "default" : "outline"}
                    size="sm"
                    className="h-6 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSortChange(null, "asc");
                    }}
                  >
                    <X className="h-3 w-3 mr-1" />
                    None
                  </Button>
                  <Button
                    variant={isSorted && sortDirectionProp === "asc" ? "default" : "outline"}
                    size="sm"
                    className="h-6 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSortChange(columnKey as keyof StockTicker, "asc");
                    }}
                  >
                    <ArrowUp className="h-3 w-3 mr-1" />
                    Asc
                  </Button>
                  <Button
                    variant={isSorted && sortDirectionProp === "desc" ? "default" : "outline"}
                    size="sm"
                    className="h-6 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSortChange(columnKey as keyof StockTicker, "desc");
                    }}
                  >
                    <ArrowDown className="h-3 w-3 mr-1" />
                    Desc
                  </Button>
                </ButtonGroup>
              </div>
            </div>

            {/* Color Rules Section */}
            {isNumeric && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Color Rules</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isEditing) {
                        // Save and exit editing mode
                        onSaveEditingRules();
                        setIsEditing(false);
                        setShowAddRule(false);
                      } else {
                        // Enter editing mode - copy current rules to editing buffer
                        editingRulesRef.current = JSON.parse(JSON.stringify(columnColorRulesProp));
                        setIsEditing(true);
                        forceLocalUpdate();
                      }
                    }}
                    className="h-6 text-xs px-2"
                  >
                    {isEditing ? 'Save Rules' : 'Edit Rules'}
                  </Button>
                </div>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {rules.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-2 text-center">
                      No color rules configured
                    </div>
                  ) : (
                    rules.map((rule, index) => {
                    const isVwapOperator = rule.operator === 'vwap_above_price' || rule.operator === 'vwap_below_price';
                    return (
                      <div key={index} className="flex items-center gap-1.5 py-0.5">
                        <Select
                          value={rule.operator}
                          onValueChange={(value) => {
                            const newOperator = value as ColorRule["operator"];
                            const isVwapOp = newOperator === 'vwap_above_price' || newOperator === 'vwap_below_price';
                            onUpdateColorRule(columnKey, index, {
                              ...rule,
                              operator: newOperator,
                              // Remove value field for VWAP operators
                              ...(isVwapOp ? { value: undefined } : {}),
                            });
                          }}
                          disabled={!isEditing}
                        >
                          <SelectTrigger className={`${isVwapOperator ? 'w-32' : 'w-16'} h-7 text-xs px-2 py-0 focus:ring-0 focus:ring-offset-0 hover:bg-accent`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="<" className="text-xs">&lt;</SelectItem>
                            <SelectItem value=">" className="text-xs">&gt;</SelectItem>
                            <SelectItem value="<=" className="text-xs">&lt;=</SelectItem>
                            <SelectItem value=">=" className="text-xs">&gt;=</SelectItem>
                            <SelectItem value="==" className="text-xs">==</SelectItem>
                            {columnKey === 'vwap' && (
                              <>
                                <SelectItem value="vwap_above_price" className="text-xs">VWAP &gt; Price</SelectItem>
                                <SelectItem value="vwap_below_price" className="text-xs">VWAP &lt; Price</SelectItem>
                              </>
                            )}
                          </SelectContent>
                        </Select>
                        {!isVwapOperator && (
                          <NumberInput
                            initialValue={rule.value ?? 0}
                            onValueChange={(value) => {
                              onUpdateColorRule(columnKey, index, {
                                ...rule,
                                value: value,
                              });
                            }}
                            disabled={!isEditing}
                          />
                        )}
                        <Input
                          type="color"
                          value={rule.color}
                          onChange={(e) => {
                            onUpdateColorRule(columnKey, index, {
                              ...rule,
                              color: e.target.value,
                            });
                          }}
                          disabled={!isEditing}
                          className="w-8 h-7 p-0 m-0 border border-input cursor-pointer [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-none"
                        />
                        {isEditing && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveColorRule(columnKey, index, forceLocalUpdate);
                            }}
                            className="h-7 w-7 p-0"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    );
                  })
                  )}
                  {showAddRule && isEditing && (
                    <div 
                      className="flex items-center gap-1.5 py-0.5"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Select
                        value={newRule.operator || "<"}
                        onValueChange={(value) => setNewRule((prev) => ({ ...prev, operator: value as ColorRule["operator"] }))}
                      >
                        <SelectTrigger className={`${newRule.operator === 'vwap_above_price' || newRule.operator === 'vwap_below_price' ? 'w-32' : 'w-16'} h-7 text-xs px-2 py-0 focus:ring-0 focus:ring-offset-0 hover:bg-accent`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="<" className="text-xs">&lt;</SelectItem>
                          <SelectItem value=">" className="text-xs">&gt;</SelectItem>
                          <SelectItem value="<=" className="text-xs">&lt;=</SelectItem>
                          <SelectItem value=">=" className="text-xs">&gt;=</SelectItem>
                          <SelectItem value="==" className="text-xs">==</SelectItem>
                          {columnKey === 'vwap' && (
                            <>
                              <SelectItem value="vwap_above_price" className="text-xs">VWAP &gt; Price</SelectItem>
                              <SelectItem value="vwap_below_price" className="text-xs">VWAP &lt; Price</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                      {newRule.operator !== 'vwap_above_price' && newRule.operator !== 'vwap_below_price' && (
                        <Input
                          type="number"
                          placeholder="Value"
                          value={newRule.value !== undefined ? newRule.value : ""}
                          onChange={(e) => {
                            e.stopPropagation();
                            const value = e.target.value === "" ? undefined : parseFloat(e.target.value);
                            setNewRule((prev) => ({ ...prev, value: value !== undefined && !isNaN(value) ? value : undefined }));
                          }}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const isVwapOp = newRule.operator === 'vwap_above_price' || newRule.operator === 'vwap_below_price';
                              const hasValue = isVwapOp || (typeof newRule.value === 'number');
                              const hasRequiredFields = newRule.operator && newRule.color && hasValue;
                              if (hasRequiredFields) {
                                const ruleToAdd = isVwapOp 
                                  ? { operator: newRule.operator!, color: newRule.color! }
                                  : { operator: newRule.operator!, value: newRule.value!, color: newRule.color! };
                                onAddColorRule(columnKey, ruleToAdd as ColorRule, forceLocalUpdate);
                                setNewRule({ operator: "<", value: 0, color: "#ef4444" });
                              }
                            }
                          }}
                          onFocus={(e) => e.stopPropagation()}
                          onBlur={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="h-7 text-xs flex-1 px-2 py-0 focus-visible:ring-0 focus-visible:ring-offset-0 hover:bg-accent transition-colors"
                        />
                      )}
                      <Input
                        type="color"
                        value={newRule.color || "#ef4444"}
                        onChange={(e) => {
                          e.stopPropagation();
                          setNewRule((prev) => ({ ...prev, color: e.target.value }));
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="w-8 h-7 p-0 m-0 border border-input cursor-pointer [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-none"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowAddRule(false);
                          setNewRule({ operator: "<", value: 0, color: "#ef4444" });
                        }}
                        className="h-7 w-7 p-0"
                      >
                        <X className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      {isEditing && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            if (showAddRule) {
                              // If form is open, add the rule
                              const isVwapOp = newRule.operator === 'vwap_above_price' || newRule.operator === 'vwap_below_price';
                              // For non-VWAP operators, value must be a number (including 0)
                              const hasValue = isVwapOp || (typeof newRule.value === 'number');
                              const hasRequiredFields = newRule.operator && newRule.color && hasValue;
                              if (hasRequiredFields) {
                                const ruleToAdd = isVwapOp 
                                  ? { operator: newRule.operator!, color: newRule.color! }
                                  : { operator: newRule.operator!, value: newRule.value!, color: newRule.color! };
                                onAddColorRule(columnKey, ruleToAdd as ColorRule, forceLocalUpdate);
                                setNewRule({ operator: "<", value: 0, color: "#ef4444" });
                              }
                            } else {
                              // If form is closed, show it
                              setShowAddRule(true);
                            }
                          }}
                          className="h-7 w-full justify-start text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Plus className="h-3 w-3 mr-1.5" />
                          Add rule
                        </Button>
                      )}
                    </div>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  }, (prevProps, nextProps) => {
    // Return true if props are equal (skip re-render), false if different (re-render)
    // Only check if this column's rules changed, not all rules
    const prevRules = prevProps.columnColorRulesProp[prevProps.columnKey];
    const nextRules = nextProps.columnColorRulesProp[nextProps.columnKey];
    const rulesEqual = JSON.stringify(prevRules) === JSON.stringify(nextRules);
    
    return (
      prevProps.columnKey === nextProps.columnKey &&
      prevProps.label === nextProps.label &&
      prevProps.textAlign === nextProps.textAlign &&
      prevProps.isOpen === nextProps.isOpen &&
      prevProps.columnWidth === nextProps.columnWidth &&
      prevProps.sortColumnProp === nextProps.sortColumnProp &&
      prevProps.sortDirectionProp === nextProps.sortDirectionProp &&
      rulesEqual
    );
  });

  return (
    <div 
      className="w-full"
      onClick={(e) => {
        // Clear selection when clicking outside the table
        if (e.target === e.currentTarget) {
          setSelectedCell(null);
        }
      }}
      tabIndex={0}
    >
      <div className="px-0">
        <Table ref={tableRef} className="table-fixed min-w-full">
        <TableHeader 
          className="sticky z-20 bg-background border-b"
          style={{ position: 'sticky', top: `${stickyHeaderOffset}px` }}
        >
          <TableRow className="hover:bg-transparent bg-background">
            <ColumnHeader 
              columnKey="symbol" 
              label="Ticker" 
              textAlign="left"
              isOpen={openColorPopover === "symbol"}
              onOpenChange={(open) => handlePopoverOpenChange("symbol", open)}
              columnColorRulesProp={columnColorRules}
              sortColumnProp={sortColumn}
              sortDirectionProp={sortDirection}
              columnWidth={columnWidths.symbol}
              onSortClick={handleSortClick}
              onMouseDown={handleMouseDown}
              onSortChange={handleSortChange}
              onSaveEditingRules={saveEditingRules}
              onAddColorRule={addColorRule}
              onRemoveColorRule={removeColorRule}
              onUpdateColorRule={updateColorRule}
            />
            <ColumnHeader 
              columnKey="price" 
              label="Price" 
              textAlign="right"
              isOpen={openColorPopover === "price"}
              onOpenChange={(open) => handlePopoverOpenChange("price", open)}
              columnColorRulesProp={columnColorRules}
              sortColumnProp={sortColumn}
              sortDirectionProp={sortDirection}
              columnWidth={columnWidths.price}
              onSortClick={handleSortClick}
              onMouseDown={handleMouseDown}
              onSortChange={handleSortChange}
              onSaveEditingRules={saveEditingRules}
              onAddColorRule={addColorRule}
              onRemoveColorRule={removeColorRule}
              onUpdateColorRule={updateColorRule}
            />
            <ColumnHeader 
              columnKey="changePercent" 
              label="Change %" 
              textAlign="right"
              isOpen={openColorPopover === "changePercent"}
              onOpenChange={(open) => handlePopoverOpenChange("changePercent", open)}
              columnColorRulesProp={columnColorRules}
              sortColumnProp={sortColumn}
              sortDirectionProp={sortDirection}
              columnWidth={columnWidths.changePercent}
              onSortClick={handleSortClick}
              onMouseDown={handleMouseDown}
              onSortChange={handleSortChange}
              onSaveEditingRules={saveEditingRules}
              onAddColorRule={addColorRule}
              onRemoveColorRule={removeColorRule}
              onUpdateColorRule={updateColorRule}
            />
            <ColumnHeader 
              columnKey="change" 
              label="Change $" 
              textAlign="right"
              isOpen={openColorPopover === "change"}
              onOpenChange={(open) => handlePopoverOpenChange("change", open)}
              columnColorRulesProp={columnColorRules}
              sortColumnProp={sortColumn}
              sortDirectionProp={sortDirection}
              columnWidth={columnWidths.change}
              onSortClick={handleSortClick}
              onMouseDown={handleMouseDown}
              onSortChange={handleSortChange}
              onSaveEditingRules={saveEditingRules}
              onAddColorRule={addColorRule}
              onRemoveColorRule={removeColorRule}
              onUpdateColorRule={updateColorRule}
            />
            <ColumnHeader 
              columnKey="volume" 
              label="Volume" 
              textAlign="right"
              isOpen={openColorPopover === "volume"}
              onOpenChange={(open) => handlePopoverOpenChange("volume", open)}
              columnColorRulesProp={columnColorRules}
              sortColumnProp={sortColumn}
              sortDirectionProp={sortDirection}
              columnWidth={columnWidths.volume}
              onSortClick={handleSortClick}
              onMouseDown={handleMouseDown}
              onSortChange={handleSortChange}
              onSaveEditingRules={saveEditingRules}
              onAddColorRule={addColorRule}
              onRemoveColorRule={removeColorRule}
              onUpdateColorRule={updateColorRule}
            />
            <ColumnHeader 
              columnKey="rsi" 
              label="RSI (d)" 
              textAlign="right"
              isOpen={openColorPopover === "rsi"}
              onOpenChange={(open) => handlePopoverOpenChange("rsi", open)}
              columnColorRulesProp={columnColorRules}
              sortColumnProp={sortColumn}
              sortDirectionProp={sortDirection}
              columnWidth={columnWidths.rsi}
              onSortClick={handleSortClick}
              onMouseDown={handleMouseDown}
              onSortChange={handleSortChange}
              onSaveEditingRules={saveEditingRules}
              onAddColorRule={addColorRule}
              onRemoveColorRule={removeColorRule}
              onUpdateColorRule={updateColorRule}
            />
            <ColumnHeader 
              columnKey="macd" 
              label="MACD" 
              textAlign="right"
              isOpen={openColorPopover === "macd"}
              onOpenChange={(open) => handlePopoverOpenChange("macd", open)}
              columnColorRulesProp={columnColorRules}
              sortColumnProp={sortColumn}
              sortDirectionProp={sortDirection}
              columnWidth={columnWidths.macd}
              onSortClick={handleSortClick}
              onMouseDown={handleMouseDown}
              onSortChange={handleSortChange}
              onSaveEditingRules={saveEditingRules}
              onAddColorRule={addColorRule}
              onRemoveColorRule={removeColorRule}
              onUpdateColorRule={updateColorRule}
            />
            <ColumnHeader 
              columnKey="vwap" 
              label="VWAP" 
              textAlign="right"
              isOpen={openColorPopover === "vwap"}
              onOpenChange={(open) => handlePopoverOpenChange("vwap", open)}
              columnColorRulesProp={columnColorRules}
              sortColumnProp={sortColumn}
              sortDirectionProp={sortDirection}
              columnWidth={columnWidths.vwap}
              onSortClick={handleSortClick}
              onMouseDown={handleMouseDown}
              onSortChange={handleSortChange}
              onSaveEditingRules={saveEditingRules}
              onAddColorRule={addColorRule}
              onRemoveColorRule={removeColorRule}
              onUpdateColorRule={updateColorRule}
            />
          </TableRow>
        </TableHeader>
        <TooltipProvider>
        <TableBody>
          {isLoading && filteredStocks.length === 0 ? (
            // Show skeleton rows while loading
            Array.from({ length: 10 }).map((_, index) => (
              <TableRow key={`skeleton-${index}`} className="h-12 md:h-10">
                <TableCell className="py-2 sticky left-0 z-10 bg-background" style={{ width: columnWidths.symbol }}>
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-5 rounded-lg bg-muted animate-pulse flex-shrink-0" />
                    <div className="h-4 w-16 bg-muted animate-pulse rounded" />
                  </div>
                </TableCell>
                <TableCell className="text-right py-2" style={{ width: columnWidths.price }}>
                  <div className="h-4 w-20 bg-muted animate-pulse rounded ml-auto" />
                </TableCell>
                <TableCell className="text-right py-2" style={{ width: columnWidths.changePercent }}>
                  <div className="h-4 w-16 bg-muted animate-pulse rounded ml-auto" />
                </TableCell>
                <TableCell className="text-right py-2" style={{ width: columnWidths.change }}>
                  <div className="h-4 w-16 bg-muted animate-pulse rounded ml-auto" />
                </TableCell>
                <TableCell className="text-right py-2" style={{ width: columnWidths.volume }}>
                  <div className="h-4 w-20 bg-muted animate-pulse rounded ml-auto" />
                </TableCell>
                <TableCell className="text-right py-2" style={{ width: columnWidths.rsi }}>
                  <div className="h-4 w-12 bg-muted animate-pulse rounded ml-auto" />
                </TableCell>
                <TableCell className="text-right py-2" style={{ width: columnWidths.macd }}>
                  <div className="h-4 w-12 bg-muted animate-pulse rounded ml-auto" />
                </TableCell>
                <TableCell className="text-right py-2" style={{ width: columnWidths.vwap }}>
                  <div className="h-4 w-16 bg-muted animate-pulse rounded ml-auto" />
                </TableCell>
              </TableRow>
            ))
          ) : filteredStocks.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground h-12 text-sm">
                No stocks found.
              </TableCell>
            </TableRow>
          ) : (
            filteredStocks.map((stock, rowIndex) => {
            const isPlaceholder = stock.price === 0 && stock.change === 0 && stock.changePercent === 0;
            
            // Calculate colors for cells
            const priceColor = getCellColor("price", stock.price, stock);
            const changePercentColor = getCellColor("changePercent", stock.changePercent, stock);
            const changeColor = getCellColor("change", stock.change, stock);
            
            return (
            <TableRow
              key={stock.symbol}
              onClick={(e) => {
                // Only trigger row click if clicking directly on the row (not on a cell)
                if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'TR') {
                  if (!isPlaceholder) {
                    onRowClick(stock);
                  }
                }
              }}
              className={`transition-colors h-12 md:h-10 ${
                isPlaceholder ? "" : "cursor-pointer"
              } ${
                selectedStock && selectedStock.symbol === stock.symbol
                  ? "bg-muted/50"
                  : "hover:bg-muted/50"
              }`}
            >
              <TableCell 
                className={`font-medium text-sm py-2 transition-all duration-200 sticky left-0 z-10 bg-background ${
                  selectedCell?.rowIndex === rowIndex && selectedCell?.columnKey === "symbol"
                    ? "outline outline-2 outline-primary"
                    : "hover:outline hover:outline-1 hover:outline-primary/30"
                }`}
                style={{ 
                  width: columnWidths.symbol,
                  outlineOffset: selectedCell?.rowIndex === rowIndex && selectedCell?.columnKey === "symbol" ? "-2px" : undefined
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isPlaceholder) {
                    setSelectedCell({ rowIndex, columnKey: "symbol" });
                    onRowClick(stock);
                  }
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onRowClick(stock);
                }}
              >
                <div className="flex items-center gap-2">
                  {(() => {
                    // Get logo URL from stock or construct using ticker endpoint (per logo.dev docs)
                    // The ticker endpoint works best for stock symbols - no website needed
                    const logoUrl = stock.logoUrl || `${import.meta.env.VITE_WORKER_URL || ''}/api/logos/${encodeURIComponent(stock.symbol)}`;
                    return (
                      <img
                        src={logoUrl}
                        alt={`${stock.symbol} logo`}
                        className="w-5 h-5 rounded-lg object-cover flex-shrink-0"
                        onError={(e) => {
                          // Replace with question mark icon on error
                          e.currentTarget.style.display = 'none';
                          const placeholder = e.currentTarget.nextElementSibling as HTMLElement;
                          if (placeholder) {
                            placeholder.style.display = 'flex';
                            placeholder.classList.remove('hidden');
                          }
                        }}
                      />
                    );
                  })()}
                  <div 
                    className="w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0 text-gray-400 hidden"
                    style={{ display: 'none' }}
                  >
                    <HelpCircle className="w-4 h-4" />
                  </div>
                  <span>{stock.symbol}</span>
                  {(() => {
                    const otherWatchlists = getOtherWatchlists(stock.symbol);
                    if (otherWatchlists.length > 0) {
                      return (
                        <Tooltip delayDuration={200}>
                          <TooltipTrigger asChild>
                            <button 
                              type="button" 
                              className="inline-flex items-center justify-center w-5 h-5 text-purple-500 hover:text-purple-600 active:text-purple-700 cursor-help flex-shrink-0 focus:outline-none touch-manipulation"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                              onTouchStart={(e) => e.stopPropagation()}
                              aria-label={`${otherWatchlists.map(wl => wl.name).join(", ")}`}
                            >
                              <Bookmark className="w-4 h-4 flex-shrink-0 fill-purple-500 text-purple-500" strokeWidth={2} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="text-xs px-2 py-1 z-50 max-w-[200px]">
                            <p className="font-normal">{otherWatchlists.map(wl => wl.name).join(", ")}</p>
                          </TooltipContent>
                        </Tooltip>
                      );
                    }
                    return null;
                  })()}
                </div>
              </TableCell>
              <TableCell 
                className={`text-right font-medium text-sm py-2 tabular-nums transition-all duration-200 ${
                  selectedCell?.rowIndex === rowIndex && selectedCell?.columnKey === "price"
                    ? "outline outline-2 outline-primary"
                    : "hover:outline hover:outline-1 hover:outline-primary/30"
                }`}
                style={{ 
                  width: columnWidths.price,
                  backgroundColor: priceColor ? hexToRgba(priceColor, 0.2) : undefined,
                  color: priceColor || undefined,
                  outlineOffset: selectedCell?.rowIndex === rowIndex && selectedCell?.columnKey === "price" ? "-2px" : "-1px"
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isPlaceholder) {
                    setSelectedCell({ rowIndex, columnKey: "price" });
                    onRowClick(stock);
                  }
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!isPlaceholder) {
                    onRowClick(stock);
                  }
                }}
              >
                {isPlaceholder ? (
                  <div className="h-4 w-16 bg-muted rounded animate-pulse ml-auto" />
                ) : (
                  `$${stock.price.toFixed(2)}`
                )}
              </TableCell>
              <TableCell
                className={`text-right text-sm py-2 tabular-nums transition-all duration-200 ${
                  selectedCell?.rowIndex === rowIndex && selectedCell?.columnKey === "changePercent"
                    ? "outline outline-2 outline-primary"
                    : "hover:outline hover:outline-1 hover:outline-primary/30"
                }`}
                style={{ 
                  width: columnWidths.changePercent,
                  backgroundColor: changePercentColor ? hexToRgba(changePercentColor, 0.2) : undefined,
                  color: changePercentColor || undefined,
                  outlineOffset: selectedCell?.rowIndex === rowIndex && selectedCell?.columnKey === "changePercent" ? "-2px" : "-1px"
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isPlaceholder) {
                    setSelectedCell({ rowIndex, columnKey: "changePercent" });
                    onRowClick(stock);
                  }
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!isPlaceholder) {
                    onRowClick(stock);
                  }
                }}
              >
                {isPlaceholder ? (
                  <div className="h-4 w-14 bg-muted rounded animate-pulse ml-auto" />
                ) : (
                  <>
                    {stock.changePercent >= 0 ? "+" : ""}
                    {stock.changePercent.toFixed(2)}%
                  </>
                )}
              </TableCell>
              <TableCell
                className={`text-right text-sm py-2 tabular-nums transition-all duration-200 ${
                  selectedCell?.rowIndex === rowIndex && selectedCell?.columnKey === "change"
                    ? "outline outline-2 outline-primary"
                    : "hover:outline hover:outline-1 hover:outline-primary/30"
                }`}
                style={{ 
                  width: columnWidths.change,
                  backgroundColor: changeColor ? hexToRgba(changeColor, 0.2) : undefined,
                  color: changeColor || undefined,
                  outlineOffset: selectedCell?.rowIndex === rowIndex && selectedCell?.columnKey === "change" ? "-2px" : "-1px"
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedCell({ rowIndex, columnKey: "change" });
                  onRowClick(stock);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onRowClick(stock);
                }}
              >
                {isPlaceholder ? (
                  <div className="h-4 w-14 bg-muted rounded animate-pulse ml-auto" />
                ) : (
                  <>
                    {stock.change >= 0 ? "+$" : "-$"}{Math.abs(stock.change).toFixed(2)}
                  </>
                )}
              </TableCell>
              <TableCell 
                className={`text-right text-sm py-2 transition-all duration-200 ${
                  selectedCell?.rowIndex === rowIndex && selectedCell?.columnKey === "volume"
                    ? "outline outline-2 outline-primary"
                    : "hover:outline hover:outline-1 hover:outline-primary/30"
                }`}
                style={{ 
                  width: columnWidths.volume,
                  backgroundColor: getCellColor("volume", stock.volume, stock) ? `${getCellColor("volume", stock.volume, stock)}20` : undefined,
                  color: getCellColor("volume", stock.volume, stock) || undefined,
                  outlineOffset: selectedCell?.rowIndex === rowIndex && selectedCell?.columnKey === "volume" ? "-2px" : "-1px"
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isPlaceholder) {
                    setSelectedCell({ rowIndex, columnKey: "volume" });
                    onRowClick(stock);
                  }
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!isPlaceholder) {
                    onRowClick(stock);
                  }
                }}
              >
                {isPlaceholder ? (
                  <div className="h-4 w-16 bg-muted rounded animate-pulse ml-auto" />
                ) : (
                  formatVolume(stock.volume)
                )}
              </TableCell>
              <TableCell 
                className={`text-right text-sm py-2 transition-all duration-200 ${
                  selectedCell?.rowIndex === rowIndex && selectedCell?.columnKey === "rsi"
                    ? "outline outline-2 outline-primary"
                    : "hover:outline hover:outline-1 hover:outline-primary/30"
                }`}
                style={{ 
                  width: columnWidths.rsi,
                  backgroundColor: (() => {
                    const color = getCellColor("rsi", stock.rsi, stock);
                    return color ? hexToRgba(color, 0.2) : undefined;
                  })(),
                  color: getCellColor("rsi", stock.rsi, stock) || undefined,
                  outlineOffset: selectedCell?.rowIndex === rowIndex && selectedCell?.columnKey === "rsi" ? "-2px" : "-1px"
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isPlaceholder) {
                    setSelectedCell({ rowIndex, columnKey: "rsi" });
                    onRowClick(stock);
                  }
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!isPlaceholder) {
                    onRowClick(stock);
                  }
                }}
              >
                {isPlaceholder ? (
                  <div className="h-4 w-12 bg-muted rounded animate-pulse ml-auto" />
                ) : (
                  stock.rsi?.toFixed(2) || "—"
                )}
              </TableCell>
              <TableCell 
                className={`text-right text-sm py-2 tabular-nums transition-all duration-200 ${
                  selectedCell?.rowIndex === rowIndex && selectedCell?.columnKey === "macd"
                    ? "outline outline-2 outline-primary"
                    : "hover:outline hover:outline-1 hover:outline-primary/30"
                }`}
                style={{ 
                  width: columnWidths.macd,
                  backgroundColor: (() => {
                    const color = getCellColor("macd", stock.macd, stock);
                    return color ? hexToRgba(color, 0.2) : undefined;
                  })(),
                  color: getCellColor("macd", stock.macd, stock) || undefined,
                  outlineOffset: selectedCell?.rowIndex === rowIndex && selectedCell?.columnKey === "macd" ? "-2px" : "-1px"
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isPlaceholder) {
                    setSelectedCell({ rowIndex, columnKey: "macd" });
                    onRowClick(stock);
                  }
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!isPlaceholder) {
                    onRowClick(stock);
                  }
                }}
              >
                {isPlaceholder ? (
                  <div className="h-4 w-12 bg-muted rounded animate-pulse ml-auto" />
                ) : (
                  stock.macd !== undefined ? stock.macd.toFixed(2) : "—"
                )}
              </TableCell>
              {(() => {
                const vwapColor = getCellColor("vwap", stock.vwap, stock);
                return (
                  <TableCell 
                    className={`text-right text-sm py-2 tabular-nums transition-all duration-200 ${
                      selectedCell?.rowIndex === rowIndex && selectedCell?.columnKey === "vwap"
                        ? "outline outline-2 outline-primary"
                        : "hover:outline hover:outline-1 hover:outline-primary/30"
                    }`}
                    style={{ 
                      width: columnWidths.vwap,
                      backgroundColor: vwapColor ? hexToRgba(vwapColor, 0.2) : undefined,
                      color: vwapColor || undefined,
                      outlineOffset: selectedCell?.rowIndex === rowIndex && selectedCell?.columnKey === "vwap" ? "-2px" : "-1px"
                    }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isPlaceholder) {
                    setSelectedCell({ rowIndex, columnKey: "vwap" });
                    onRowClick(stock);
                  }
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!isPlaceholder) {
                    onRowClick(stock);
                  }
                }}
              >
                    {isPlaceholder ? (
                      <div className="h-4 w-16 bg-muted rounded animate-pulse ml-auto" />
                    ) : (
                      stock.vwap ? `$${stock.vwap.toFixed(2)}` : "—"
                    )}
                  </TableCell>
                );
              })()}
            </TableRow>
            );
          })
          )}
        </TableBody>
        </TooltipProvider>
      </Table>
      </div>
      {/* Bottom margin for mobile search bars - inside scrollable area */}
      <div className="h-24 flex-shrink-0" />
    </div>
  );
});

