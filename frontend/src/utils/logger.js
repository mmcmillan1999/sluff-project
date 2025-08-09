// Production-safe logger utility
// Silences console output in production while preserving it in development

const isDevelopment = process.env.NODE_ENV === 'development';

const logger = {
    log: isDevelopment ? console.log.bind(console) : () => {},
    error: console.error.bind(console), // Always show errors
    warn: isDevelopment ? console.warn.bind(console) : () => {},
    info: isDevelopment ? console.info.bind(console) : () => {},
    debug: isDevelopment ? console.debug.bind(console) : () => {},
    table: isDevelopment ? console.table?.bind(console) : () => {},
    group: isDevelopment ? console.group?.bind(console) : () => {},
    groupEnd: isDevelopment ? console.groupEnd?.bind(console) : () => {},
};

// For quick migration: override global console in production
if (!isDevelopment && typeof window !== 'undefined') {
    // Preserve original console for errors
    const originalError = console.error;
    
    // Override console methods
    window.console = {
        ...console,
        log: () => {},
        warn: () => {},
        info: () => {},
        debug: () => {},
        table: () => {},
        group: () => {},
        groupEnd: () => {},
        error: originalError, // Keep errors visible
    };
}

export default logger;