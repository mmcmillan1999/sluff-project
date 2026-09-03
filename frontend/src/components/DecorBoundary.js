import React from 'react';
import { reportError } from '../utils/errorReporter';

// Boundary for ornament — the spider, banners, coach callouts, the tips
// beacon, the venue wheel. A crash in decoration must never take the table
// down with it (the root ErrorBoundary answers with a full-screen reload
// card), so this reports the error and renders nothing in its place.
//
// A function child runs inside the boundary. A render helper called in the
// parent (`{renderThing()}`) throws during the parent's own render, where no
// boundary below it can catch anything.
const DecorContent = ({ render }) => render();

class DecorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { failed: false };
    }

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error, info) {
        // eslint-disable-next-line no-console
        console.error('[DecorBoundary] Decorative subtree crashed:', error, info?.componentStack);
        reportError(error?.message || 'Decor render error', error?.stack || info?.componentStack);
    }

    render() {
        if (this.state.failed) return null;
        const { children } = this.props;
        return typeof children === 'function' ? <DecorContent render={children} /> : children;
    }
}

export default DecorBoundary;
