import { render } from '@testing-library/react';
import AdvertisingHeader from './AdvertisingHeader';

vi.mock('./InGameAdBanner', () => ({
    default: () => <div>Test advertisement</div>,
}));

describe('AdvertisingHeader view modifiers', () => {
    test.each([
        ['lobby', 'advertising-header--lobby'],
        ['game', 'advertising-header--game'],
        ['default', 'advertising-header--default'],
    ])('namespaces the %s modifier away from page layout classes', (viewType, expectedClass) => {
        const { container } = render(<AdvertisingHeader viewType={viewType} />);
        const header = container.firstElementChild;

        expect(header).toHaveClass('advertising-header', expectedClass);
        expect(header).not.toHaveClass('lobby-header');
        expect(header).not.toHaveClass('game-header');
    });
});
