import React, { useState, useEffect, useRef } from 'react';
import './LayoutDevPanel.css';

const LayoutDevPanel = ({ onClose, emitEvent, currentTableState }) => {
    const [selectedElement, setSelectedElement] = useState(null);
    const [undockedElements, setUndockedElements] = useState(new Set());
    const [changes, setChanges] = useState([]);
    const [layoutMode, setLayoutMode] = useState('');
    const [isPanelDragging, setIsPanelDragging] = useState(false);
    const [panelPosition, setPanelPosition] = useState({ x: 20, y: 20 });
    // Use refs for non-reactive registries to avoid unnecessary re-renders
    const originalStylesRef = useRef(new Map());
    const idCounterRef = useRef(0);
    const [collapsedSections, setCollapsedSections] = useState({
        info: false,
        state: true,  // Start collapsed
        selection: false,
        changes: true  // Start collapsed
    });
    const [isPanelMinimized, setIsPanelMinimized] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [previewCss, setPreviewCss] = useState('');
    const panelRef = useRef(null);
    const dragOffset = useRef({ x: 0, y: 0 });

    useEffect(() => {
        // Detect current layout mode
        const width = window.innerWidth;
        const height = window.innerHeight;
        const orientation = width > height ? 'landscape' : 'portrait';
        
        // Detect zoom level (not 100% accurate but gives a good indication)
        const zoomLevel = Math.round(window.devicePixelRatio * 100);
        
        let mode = '';
        if (width >= 1024) {
            mode = 'desktop';
        } else if (width >= 768) {
            mode = 'tablet-' + orientation;
        } else {
            mode = 'mobile-' + orientation;
        }
        
        // Add zoom warning to mode if not at 100%
        if (zoomLevel !== 100) {
            mode += ` (⚠️ Zoom: ${zoomLevel}%)`;
        }
        
        setLayoutMode(mode);
        
        // Make all game elements selectable
        makeElementsSelectable();
        
        return () => {
            // Cleanup: remove event listeners and restore elements
            cleanupElements();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Provide a stable ID for any element we touch and return the ID string
    const ensureElementId = (element) => {
        if (!element) return null;
        let id = element.getAttribute('data-layout-id');
        if (!id) {
            id = `ld-${++idCounterRef.current}`;
            element.setAttribute('data-layout-id', id);
        }
        return id;
    };

    const makeElementsSelectable = () => {
        // Target all major game elements
        const selectors = [
            // Header and advertising elements
            '.advertising-header',
            '.advertising-header-wrapper',
            '.header-content',
            '.ad-container',
            '.ad-placeholder',
            '#advertising-header',
            '[class*="banner"]',
            '[class*="header"]',
            '[class*="ad-"]',
            '[class*="advertisement"]',
            
            // Game elements
            '.player-seat',
            '.player-seat-left',
            '.player-seat-right',
            '.player-seat-bottom',
            '.table-oval',
            '.trick-pile-container',
            '.widow-seat',
            '.player-hand',
            '.player-hand-container',
            '.game-footer',
            '.hand-container',
            '[class*="player-hand"]',
            '[class*="hand-container"]',
            '.played-card-left',
            '.played-card-right',
            '.played-card-bottom',
            '.card-display',
            '.insurance-controls',
            '.action-prompt-container',
            '.progress-bar-area',
            '.chat-button',
            '.menu-button',
            '.trump-indicator-puck',
            '.dealer-deck-container',
            '.widow-cards-inline',
            '.trick-plate',
            '[class*="card-"]',
            '[class*="button"]',
            '[class*="control"]'
        ];
        
        selectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(element => {
                // Skip the dev panel itself
                if (element.closest('.layout-dev-panel')) return;

                // Store original styles
                const id = ensureElementId(element);
                if (!originalStylesRef.current.has(id)) {
                    const cs = getComputedStyle(element);
                    originalStylesRef.current.set(id, {
                        position: element.style.position || getComputedStyle(element).position,
                        left: element.style.left || cs.left,
                        top: element.style.top || cs.top,
                        right: element.style.right || cs.right,
                        bottom: element.style.bottom || cs.bottom,
                        width: element.style.width || cs.width,
                        height: element.style.height || cs.height,
                        transform: element.style.transform || cs.transform,
                        zIndex: element.style.zIndex || cs.zIndex
                    });
                }
                
                // Add selection handler
                element.addEventListener('click', handleElementClick);
                element.style.cursor = 'pointer';
                element.classList.add('layout-dev-selectable');
            });
        });
    };

    const cleanupElements = () => {
        document.querySelectorAll('.layout-dev-selectable').forEach(element => {
            element.removeEventListener('click', handleElementClick);
            element.style.cursor = '';
            element.classList.remove('layout-dev-selectable', 'layout-dev-selected', 'layout-dev-undocked');
            // Ensure drag/resize handlers are removed if present
            disableDragResize(element);
        });
    };

    const handleElementClick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        
    const element = e.currentTarget;
    // Ignore clicks within the dev panel
    if (element.closest && element.closest('.layout-dev-panel')) return;
        
        // Clear previous selection
        document.querySelectorAll('.layout-dev-selected').forEach(el => {
            el.classList.remove('layout-dev-selected');
        });
        
        // Select new element
        element.classList.add('layout-dev-selected');
        setSelectedElement(element);
    };

    const getElementId = (element) => {
    return element?.getAttribute('data-layout-id') || ensureElementId(element);
    };

    const getElementDescription = (element) => {
        if (!element) return 'None';
        
        const classes = element.className.split(' ').filter(c => !c.startsWith('layout-dev')).join('.');
        const id = element.id ? `#${element.id}` : '';
        const text = element.textContent ? ` "${element.textContent.substring(0, 20)}..."` : '';
    const devId = element.getAttribute('data-layout-id');
    return `${element.tagName.toLowerCase()}${id}${classes ? '.' + classes : ''}${devId ? ` [${devId}]` : ''}${text}`;
    };

    const handleUndock = () => {
        if (!selectedElement) return;
        
    const elementId = getElementId(selectedElement);
        
        if (undockedElements.has(elementId)) {
            // Re-dock element
            dockElement(selectedElement, elementId);
        } else {
            // Undock element
            undockElement(selectedElement, elementId);
        }
    };

    const undockElement = (element, elementId) => {
        // Store current computed position
        const rect = element.getBoundingClientRect();
        const computedStyle = getComputedStyle(element);
        const isFixed = computedStyle.position === 'fixed';
        
        // For fixed elements (like headers), maintain fixed positioning
        if (isFixed) {
            element.style.position = 'fixed';
            element.style.left = rect.left + 'px';
            element.style.top = rect.top + 'px';
        } else {
            const parentRect = element.offsetParent ? element.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
            element.style.position = 'absolute';
            element.style.left = (rect.left - parentRect.left) + 'px';
            element.style.top = (rect.top - parentRect.top) + 'px';
        }
        
        // Set explicit width and height to maintain size
        element.style.width = rect.width + 'px';
        element.style.height = rect.height + 'px';
        
        // Override any constraints that prevent resizing
        element.style.minHeight = 'unset';
        element.style.maxHeight = 'unset';
        element.style.minWidth = 'unset';
        element.style.maxWidth = 'unset';
        element.style.padding = computedStyle.padding; // Keep current padding but make it adjustable
        element.style.boxSizing = 'border-box';
        
    element.classList.add('layout-dev-undocked');
        
        // Enable drag and resize
        enableDragResize(element);
        
        setUndockedElements(prev => new Set([...prev, elementId]));
    };

    const dockElement = (element, elementId) => {
        // Record change before docking
        recordChange(element, elementId);
        
        // Disable drag and resize
        disableDragResize(element);
        
        element.classList.remove('layout-dev-undocked');
        
        setUndockedElements(prev => {
            const newSet = new Set(prev);
            newSet.delete(elementId);
            return newSet;
        });
    };

    const enableDragResize = (element) => {
    let isDragging = false;
        let isResizing = false;
        let startX, startY, startWidth, startHeight, startLeft, startTop;
        
        const handleMouseDown = (e) => {
            if (e.target.classList.contains('layout-dev-resize-handle')) {
                isResizing = true;
                startX = e.clientX;
                startY = e.clientY;
                startWidth = parseInt(getComputedStyle(element).width, 10);
                startHeight = parseInt(getComputedStyle(element).height, 10);
            } else {
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                startLeft = element.offsetLeft;
                startTop = element.offsetTop;
            }
            
            e.preventDefault();
        };
        
        const handleMouseMove = (e) => {
            if (isDragging) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                element.style.left = (startLeft + dx) + 'px';
                element.style.top = (startTop + dy) + 'px';
                element.style.right = 'auto';
                element.style.bottom = 'auto';
                element.style.transform = 'none';
            } else if (isResizing) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                element.style.width = (startWidth + dx) + 'px';
                element.style.height = (startHeight + dy) + 'px';
            }
        };
        
        const handleMouseUp = () => {
            isDragging = false;
            isResizing = false;
            try {
                const elementId = getElementId(element);
                if (elementId) {
                    recordChange(element, elementId);
                }
            } catch (e) {
                // noop
            }
        };
        
        // Add resize handle
        if (!element.querySelector('.layout-dev-resize-handle')) {
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'layout-dev-resize-handle';
            element.appendChild(resizeHandle);
        }
        
        element.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        
        // Store handlers for cleanup
        element._layoutDevHandlers = { handleMouseDown, handleMouseMove, handleMouseUp };
    };

    const disableDragResize = (element) => {
        if (element._layoutDevHandlers) {
            element.removeEventListener('mousedown', element._layoutDevHandlers.handleMouseDown);
            document.removeEventListener('mousemove', element._layoutDevHandlers.handleMouseMove);
            document.removeEventListener('mouseup', element._layoutDevHandlers.handleMouseUp);
            delete element._layoutDevHandlers;
        }
        
        // Remove resize handle
        const handle = element.querySelector('.layout-dev-resize-handle');
        if (handle) handle.remove();
    };

    const recordChange = (element, elementId) => {
    const original = originalStylesRef.current.get(elementId);
        const current = {
            position: element.style.position,
            left: element.style.left,
            top: element.style.top,
            right: element.style.right,
            bottom: element.style.bottom,
            width: element.style.width,
            height: element.style.height,
            transform: element.style.transform,
            zIndex: element.style.zIndex
        };
        
        const change = {
            id: Date.now(),
            elementId,
            description: getElementDescription(element),
            original,
            current,
            timestamp: new Date().toISOString()
        };
        
        setChanges(prev => [...prev, change]);
    };

    // Build a best-effort CSS selector for an element
    const getElementSelector = (element) => {
        if (!element) return null;
        if (element.id) return `#${element.id}`;
        const classes = (element.className || '')
            .split(' ')
            .filter(c => c && !c.startsWith('layout-dev'));
        if (classes.length) return `${element.tagName.toLowerCase()}.${classes.join('.')}`;
        return element.tagName.toLowerCase();
    };

    // Create a CSS patch from recorded changes
    const buildCssPatch = () => {
        const byElement = new Map();
        changes.forEach(c => {
            const el = document.querySelector(`[data-layout-id="${c.elementId}"]`);
            const selector = getElementSelector(el) || `[data-layout-id="${c.elementId}"]`;
            if (!byElement.has(selector)) byElement.set(selector, {});
            const rule = byElement.get(selector);
            const cur = c.current || {};
            // Only include properties we actually changed inline
            ['position','left','top','right','bottom','width','height','transform','zIndex','padding','paddingTop','paddingBottom','paddingLeft','paddingRight','boxSizing'].forEach(k => {
                if (el && el.style && el.style[k] && el.style[k] !== '' && el.style[k] !== 'auto' && el.style[k] !== 'none') {
                    rule[k] = el.style[k];
                } else if (cur[k]) {
                    rule[k] = cur[k];
                }
            });
        });

        let css = '/* LayoutDev CSS Patch */\n';
        byElement.forEach((rule, selector) => {
            const entries = Object.entries(rule)
                .filter(([k,v]) => v && v !== 'auto' && v !== 'none')
                .map(([k,v]) => {
                    // Convert camelCase to kebab-case
                    const prop = k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
                    return `  ${prop}: ${v};`;
                });
            if (entries.length) {
                css += `${selector} {\n${entries.join('\n')}\n}\n\n`;
            }
        });
        return css.trim();
    };

    const copyCssPatch = async () => {
        const css = buildCssPatch();
        try {
            await navigator.clipboard.writeText(css);
            alert('CSS patch copied to clipboard');
        } catch {
            console.log(css);
            alert('Copied failed. CSS printed to console.');
        }
    };

    const copyJsonChanges = async () => {
        const payload = {
            layoutMode,
            screenSize: { width: window.innerWidth, height: window.innerHeight },
            changes: changes.map(c => ({
                elementId: c.elementId,
                description: c.description,
                original: c.original,
                current: c.current
            })),
            timestamp: new Date().toISOString()
        };
        const text = JSON.stringify(payload, null, 2);
        try {
            await navigator.clipboard.writeText(text);
            alert('JSON changes copied to clipboard');
        } catch {
            console.log(text);
            alert('Copy failed. JSON printed to console.');
        }
    };

    const revertChange = (changeId) => {
    const change = changes.find(c => c.id === changeId);
        if (!change) return;
        
        // Find element
    const element = document.querySelector(`[data-layout-id="${change.elementId}"]`);
        
        if (element && change.original) {
            Object.entries(change.original).forEach(([prop, value]) => {
                if (value && value !== 'none' && value !== 'auto') {
                    element.style[prop] = value;
                }
            });
        }
        
        // Remove from changes
        setChanges(prev => prev.filter(c => c.id !== changeId));
    };

    const logChanges = async () => {
        if (changes.length === 0) return;
        if (!window.confirm(`Log ${changes.length} change(s) to backend?`)) {
            return;
        }
        
        const payload = {
            layoutMode,
            screenSize: {
                width: window.innerWidth,
                height: window.innerHeight
            },
            changes: changes.map(c => ({
                elementId: c.elementId,
                description: c.description,
                original: c.original,
                current: c.current
            })),
            timestamp: new Date().toISOString()
        };
        
        console.log('Layout Changes to Log:', payload);
        
        // Emit to backend
        if (emitEvent) {
            emitEvent('layoutDevChanges', payload);
        }
        
        // Clear changes after logging
        setChanges([]);
        alert(`Logged ${payload.changes.length} layout changes for ${layoutMode} mode`);
    };

    // Keep preview CSS in sync with current change list
    useEffect(() => {
        try {
            // Build only when preview is visible to avoid extra work
            if (showPreview) {
                // buildCssPatch is declared below; function hoisting covers this
                const css = buildCssPatch();
                setPreviewCss(css);
            }
        } catch (e) {
            setPreviewCss('/* Error generating preview */');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [changes, showPreview]);

    // Panel dragging handlers
    const handlePanelMouseDown = (e) => {
        // Ignore clicks on header control buttons
        if (e.target.closest('button')) return;
        setIsPanelDragging(true);
        dragOffset.current = {
            x: e.clientX - panelPosition.x,
            y: e.clientY - panelPosition.y
        };
    };

    const handlePanelMouseMove = (e) => {
        if (isPanelDragging) {
            setPanelPosition({
                x: e.clientX - dragOffset.current.x,
                y: e.clientY - dragOffset.current.y
            });
        }
    };

    const handlePanelMouseUp = () => {
        setIsPanelDragging(false);
    };

    useEffect(() => {
        if (isPanelDragging) {
            document.addEventListener('mousemove', handlePanelMouseMove);
            document.addEventListener('mouseup', handlePanelMouseUp);
        }
        
        return () => {
            document.removeEventListener('mousemove', handlePanelMouseMove);
            document.removeEventListener('mouseup', handlePanelMouseUp);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isPanelDragging]);

    const toggleSection = (section) => {
        setCollapsedSections(prev => ({
            ...prev,
            [section]: !prev[section]
        }));
    };

    // Keyboard: ESC to clear selection
    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.layout-dev-selected').forEach(el => el.classList.remove('layout-dev-selected'));
                setSelectedElement(null);
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    return (
        <div 
            ref={panelRef}
            className={`layout-dev-panel ${isPanelMinimized ? 'minimized' : ''}`}
            style={{
                left: panelPosition.x + 'px',
                top: panelPosition.y + 'px',
                width: isPanelMinimized ? '200px' : (window.innerWidth < 768 ? '90vw' : '400px'),
                maxWidth: isPanelMinimized ? '200px' : '90vw',
                maxHeight: isPanelMinimized ? '40px' : '80vh'
            }}
        >
            <div 
                className="layout-dev-panel-header"
                onMouseDown={handlePanelMouseDown}
            >
                <h3 style={{ fontSize: isPanelMinimized ? '14px' : '16px' }}>
                    {isPanelMinimized ? '🎨 Layout' : 'Layout Developer'}
                </h3>
                <div style={{ display: 'flex', gap: '5px' }}>
                    <button 
                        onClick={() => setIsPanelMinimized(!isPanelMinimized)} 
                        className="layout-dev-minimize"
                        title={isPanelMinimized ? 'Expand' : 'Minimize'}
                    >
                        {isPanelMinimized ? '□' : '−'}
                    </button>
                    <button onClick={onClose} className="layout-dev-close">✕</button>
                </div>
            </div>
            
            {!isPanelMinimized && (
                <div className="layout-dev-panel-content" style={{ overflowY: 'auto', maxHeight: 'calc(80vh - 50px)' }}>
                    <div className="layout-dev-section">
                        <div 
                            className="layout-dev-section-header"
                            onClick={() => toggleSection('info')}
                            style={{ cursor: 'pointer', userSelect: 'none', padding: '5px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px' }}
                        >
                            <strong>{collapsedSections.info ? '▶' : '▼'} Layout Info</strong>
                        </div>
                        {!collapsedSections.info && (
                            <div className="layout-dev-info" style={{ marginTop: '5px' }}>
                                <strong>Mode:</strong> {layoutMode}
                                <div style={{ fontSize: '11px', marginTop: '5px' }}>
                                    <strong>Viewport:</strong> {window.innerWidth} × {window.innerHeight}px
                                </div>
                                {window.devicePixelRatio !== 1 && (
                                    <div style={{ 
                                        color: '#ff9800', 
                                        fontSize: '11px', 
                                        marginTop: '5px',
                                        padding: '5px',
                                        background: 'rgba(255,152,0,0.1)',
                                        borderRadius: '3px'
                                    }}>
                                        ⚠️ Browser zoom detected! Set to 100% for accurate layout editing.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    
                    {currentTableState && (
                        <div className="layout-dev-section" style={{ marginTop: '10px' }}>
                            <div
                                className="layout-dev-section-header"
                                onClick={() => toggleSection('state')}
                                style={{ cursor: 'pointer', userSelect: 'none', padding: '5px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px' }}
                            >
                                <strong>{collapsedSections.state ? '▶' : '▼'} Game State</strong>
                            </div>
                            {!collapsedSections.state && (
                                <div className="layout-dev-state-info" style={{ marginTop: '5px' }}>
                                    <div className="layout-dev-state-item">
                                        <span className="layout-dev-state-label">Game State:</span>
                                        <span className="layout-dev-state-value">{currentTableState.state || 'Unknown'}</span>
                                    </div>
                                    <div className="layout-dev-state-item">
                                        <span className="layout-dev-state-label">Bid Type:</span>
                                        <span className="layout-dev-state-value">{currentTableState.bidWinnerInfo?.bid || 'None'}</span>
                                    </div>
                                    <div className="layout-dev-state-item">
                                        <span className="layout-dev-state-label">Cards in Hand:</span>
                                        <span className="layout-dev-state-value">
                                            {currentTableState.bidWinnerInfo?.bid === 'Frog' ? '14' :
                                                currentTableState.state === 'Exchange Phase' ? '12' :
                                                currentTableState.hand?.length || '0'}
                                        </span>
                                    </div>
                                    <div className="layout-dev-state-item">
                                        <span className="layout-dev-state-label">Players:</span>
                                        <span className="layout-dev-state-value">
                                            {Object.keys(currentTableState.players || {}).length}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    
                    <div className="layout-dev-section" style={{ marginTop: '10px' }}>
                        <div 
                            className="layout-dev-section-header"
                            onClick={() => toggleSection('selection')}
                            style={{ cursor: 'pointer', userSelect: 'none', padding: '5px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px' }}
                        >
                            <strong>{collapsedSections.selection ? '▶' : '▼'} Selected Element</strong>
                        </div>
                        {!collapsedSections.selection && (
                            <div className="layout-dev-selection" style={{ marginTop: '5px' }}>
                                <div className="layout-dev-element-desc">
                                    {getElementDescription(selectedElement)}
                                </div>
                    {selectedElement && (
                        <>
                            <button onClick={handleUndock} className="layout-dev-btn">
                                {undockedElements.has(getElementId(selectedElement)) ? '🔒 Dock' : '🔓 Undock'}
                            </button>
                            
                            {/* Quick adjustments - always visible for selected element */}
                            <div style={{ marginTop: '10px', fontSize: '11px' }}>
                                <div style={{ marginBottom: '5px', color: '#4fc3f7' }}>Quick Adjustments:</div>
                                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                    <button 
                                        onClick={() => {
                                            // Use border-box sizing to make height adjustments intuitive
                                            selectedElement.style.boxSizing = 'border-box';
                                            const rect = selectedElement.getBoundingClientRect();
                                            const newHeight = Math.max(0, Math.round(rect.height - 10));
                                            selectedElement.style.height = newHeight + 'px';
                                            selectedElement.style.minHeight = 'unset';
                                            selectedElement.style.maxHeight = 'unset';
                        const elementId = getElementId(selectedElement);
                        recordChange(selectedElement, elementId);
                                        }}
                                        className="layout-dev-btn"
                                        style={{ fontSize: '11px', padding: '4px 8px' }}
                                        title="Decrease height by 10px"
                                    >
                                        ↕️ H-10
                                    </button>
                    <button 
                                        onClick={() => {
                                            selectedElement.style.boxSizing = 'border-box';
                                            const rect = selectedElement.getBoundingClientRect();
                                            const newHeight = Math.max(0, Math.round(rect.height + 10));
                                            selectedElement.style.height = newHeight + 'px';
                                            selectedElement.style.minHeight = 'unset';
                                            selectedElement.style.maxHeight = 'unset';
                        const elementId = getElementId(selectedElement);
                        recordChange(selectedElement, elementId);
                                        }}
                                        className="layout-dev-btn"
                                        style={{ fontSize: '11px', padding: '4px 8px' }}
                                        title="Increase height by 10px"
                                    >
                                        ↕️ H+10
                                    </button>
                    <button 
                                        onClick={() => {
                                            selectedElement.style.boxSizing = 'border-box';
                                            const rect = selectedElement.getBoundingClientRect();
                                            const newWidth = Math.max(0, Math.round(rect.width - 10));
                                            selectedElement.style.width = newWidth + 'px';
                                            selectedElement.style.minWidth = 'unset';
                                            selectedElement.style.maxWidth = 'unset';
                        const elementId = getElementId(selectedElement);
                        recordChange(selectedElement, elementId);
                                        }}
                                        className="layout-dev-btn"
                                        style={{ fontSize: '11px', padding: '4px 8px' }}
                                        title="Decrease width by 10px"
                                    >
                                        ↔️ W-10
                                    </button>
                    <button 
                                        onClick={() => {
                                            selectedElement.style.boxSizing = 'border-box';
                                            const rect = selectedElement.getBoundingClientRect();
                                            const newWidth = Math.max(0, Math.round(rect.width + 10));
                                            selectedElement.style.width = newWidth + 'px';
                                            selectedElement.style.minWidth = 'unset';
                                            selectedElement.style.maxWidth = 'unset';
                        const elementId = getElementId(selectedElement);
                        recordChange(selectedElement, elementId);
                                        }}
                                        className="layout-dev-btn"
                                        style={{ fontSize: '11px', padding: '4px 8px' }}
                                        title="Increase width by 10px"
                                    >
                                        ↔️ W+10
                                    </button>
                                    <button 
                                        onClick={() => {
                                            selectedElement.style.padding = '0px';
                        const elementId = getElementId(selectedElement);
                        recordChange(selectedElement, elementId);
                                        }}
                                        className="layout-dev-btn"
                                        style={{ fontSize: '11px', padding: '4px 8px' }}
                                        title="Remove all padding"
                                    >
                                        📐 No Pad
                                    </button>
                                    <button 
                                        onClick={() => {
                                            const computed = getComputedStyle(selectedElement);
                                            const paddingTop = parseInt(computed.paddingTop) || 0;
                                            const paddingBottom = parseInt(computed.paddingBottom) || 0;
                                            const paddingLeft = parseInt(computed.paddingLeft) || 0;
                                            const paddingRight = parseInt(computed.paddingRight) || 0;
                                            
                                            selectedElement.style.paddingTop = Math.max(0, paddingTop - 5) + 'px';
                                            selectedElement.style.paddingBottom = Math.max(0, paddingBottom - 5) + 'px';
                                            selectedElement.style.paddingLeft = Math.max(0, paddingLeft - 5) + 'px';
                                            selectedElement.style.paddingRight = Math.max(0, paddingRight - 5) + 'px';
                        const elementId = getElementId(selectedElement);
                        recordChange(selectedElement, elementId);
                                        }}
                                        className="layout-dev-btn"
                                        style={{ fontSize: '11px', padding: '4px 8px' }}
                                        title="Reduce padding by 5px on all sides"
                                    >
                                        📐 Pad-5
                                    </button>
                                </div>
                                
                                {/* Position adjustments */}
                                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '5px' }}>
                                    <button 
                                        onClick={() => {
                                            const rect = selectedElement.getBoundingClientRect();
                                            const parent = selectedElement.offsetParent || document.body;
                                            const parentRect = parent.getBoundingClientRect();
                                            selectedElement.style.position = selectedElement.style.position || 'relative';
                                            selectedElement.style.top = ((rect.top - parentRect.top) - 5) + 'px';
                        const elementId = getElementId(selectedElement);
                        recordChange(selectedElement, elementId);
                                        }}
                                        className="layout-dev-btn"
                                        style={{ fontSize: '11px', padding: '4px 8px' }}
                                        title="Move up 5px"
                                    >
                                        ⬆️
                                    </button>
                                    <button 
                                        onClick={() => {
                                            const rect = selectedElement.getBoundingClientRect();
                                            const parent = selectedElement.offsetParent || document.body;
                                            const parentRect = parent.getBoundingClientRect();
                                            selectedElement.style.position = selectedElement.style.position || 'relative';
                                            selectedElement.style.top = ((rect.top - parentRect.top) + 5) + 'px';
                        const elementId = getElementId(selectedElement);
                        recordChange(selectedElement, elementId);
                                        }}
                                        className="layout-dev-btn"
                                        style={{ fontSize: '11px', padding: '4px 8px' }}
                                        title="Move down 5px"
                                    >
                                        ⬇️
                                    </button>
                                    <button 
                                        onClick={() => {
                                            const rect = selectedElement.getBoundingClientRect();
                                            const parent = selectedElement.offsetParent || document.body;
                                            const parentRect = parent.getBoundingClientRect();
                                            selectedElement.style.position = selectedElement.style.position || 'relative';
                                            selectedElement.style.left = ((rect.left - parentRect.left) - 5) + 'px';
                        const elementId = getElementId(selectedElement);
                        recordChange(selectedElement, elementId);
                                        }}
                                        className="layout-dev-btn"
                                        style={{ fontSize: '11px', padding: '4px 8px' }}
                                        title="Move left 5px"
                                    >
                                        ⬅️
                                    </button>
                                    <button 
                                        onClick={() => {
                                            const rect = selectedElement.getBoundingClientRect();
                                            const parent = selectedElement.offsetParent || document.body;
                                            const parentRect = parent.getBoundingClientRect();
                                            selectedElement.style.position = selectedElement.style.position || 'relative';
                                            selectedElement.style.left = ((rect.left - parentRect.left) + 5) + 'px';
                        const elementId = getElementId(selectedElement);
                        recordChange(selectedElement, elementId);
                                        }}
                                        className="layout-dev-btn"
                                        style={{ fontSize: '11px', padding: '4px 8px' }}
                                        title="Move right 5px"
                                    >
                                        ➡️
                                    </button>
                                </div>
                            </div>
                            
                            {undockedElements.has(getElementId(selectedElement)) && (
                                <div style={{ marginTop: '10px', fontSize: '11px', color: '#4fc3f7' }}>
                                    <small>Element is undocked - drag to move, use corner to resize</small>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
                    </div>
                    
                    <div className="layout-dev-section" style={{ marginTop: '10px' }}>
                        <div 
                            className="layout-dev-section-header"
                            onClick={() => toggleSection('changes')}
                            style={{ cursor: 'pointer', userSelect: 'none', padding: '5px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px' }}
                        >
                            <strong>{collapsedSections.changes ? '▶' : '▼'} Changes ({changes.length})</strong>
                        </div>
                        {!collapsedSections.changes && (
                            <div className="layout-dev-changes" style={{ marginTop: '5px' }}>
                                <div className="layout-dev-changes-list">
                        {changes.map(change => (
                            <div key={change.id} className="layout-dev-change-item">
                                <span>{change.description}</span>
                                <button 
                                    onClick={() => revertChange(change.id)}
                                    className="layout-dev-revert"
                                    title="Revert to default"
                                >
                                    ✕
                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    
                    {changes.length > 0 && (
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
                            <button onClick={logChanges} className="layout-dev-btn layout-dev-log">
                                📤 Log Changes to Database
                            </button>
                            <button onClick={copyCssPatch} className="layout-dev-btn">
                                📋 Copy CSS Patch
                            </button>
                            <button onClick={copyJsonChanges} className="layout-dev-btn">
                                🧾 Copy JSON
                            </button>
                            <button onClick={() => setShowPreview(v => !v)} className="layout-dev-btn">
                                {showPreview ? '🙈 Hide Preview' : '👁️ Preview CSS'}
                            </button>
                            <button onClick={() => setChanges([])} className="layout-dev-btn" title="Clear all recorded changes">
                                🧹 Clear All
                            </button>
                        </div>
                    )}

                    {showPreview && (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ marginBottom: '6px', color: '#4fc3f7', fontSize: '12px' }}>Preview CSS Patch</div>
                            <textarea
                                readOnly
                                value={previewCss}
                                style={{ width: '100%', minHeight: '160px', fontFamily: 'monospace', fontSize: '12px', padding: '8px', background: 'rgba(0,0,0,0.4)', color: '#e0e0e0', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px' }}
                            />
                        </div>
                    )}
                    
                    <div className="layout-dev-instructions" style={{ marginTop: '10px', fontSize: '10px' }}>
                        <small>
                            Drag header to move. Click sections to expand/collapse.
                        </small>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LayoutDevPanel;