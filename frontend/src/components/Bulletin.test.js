import React from 'react';
import { render, screen } from '@testing-library/react';
import Bulletin from './Bulletin';
import { bulletinContent } from './bulletinContent';

// Mock the bulletinContent
jest.mock('./bulletinContent', () => ({
  bulletinContent: [
    { type: 'header', text: 'Test Header' },
    { type: 'paragraph', text: 'Test paragraph content' },
    { type: 'list-item', text: 'Test list item 1' },
    { type: 'list-item', text: 'Test list item 2' },
    { type: 'unknown', text: 'This should not render' }
  ]
}));

describe('Bulletin Component', () => {
  test('renders without crashing', () => {
    render(<Bulletin />);
    expect(screen.getByText('Test Header')).toBeInTheDocument();
  });

  test('renders header content correctly', () => {
    render(<Bulletin />);
    const header = screen.getByText('Test Header');
    expect(header).toBeInTheDocument();
    expect(header.tagName).toBe('H3');
    expect(header).toHaveClass('bulletin-header');
  });

  test('renders paragraph content correctly', () => {
    render(<Bulletin />);
    const paragraph = screen.getByText('Test paragraph content');
    expect(paragraph).toBeInTheDocument();
    expect(paragraph.tagName).toBe('P');
    expect(paragraph).toHaveClass('bulletin-paragraph');
  });

  test('renders list items correctly', () => {
    render(<Bulletin />);
    const listItem1 = screen.getByText('Test list item 1');
    const listItem2 = screen.getByText('Test list item 2');
    
    expect(listItem1).toBeInTheDocument();
    expect(listItem2).toBeInTheDocument();
    expect(listItem1.tagName).toBe('DIV');
    expect(listItem1).toHaveClass('bulletin-list-item');
  });

  test('does not render unknown content types', () => {
    render(<Bulletin />);
    expect(screen.queryByText('This should not render')).not.toBeInTheDocument();
  });

  test('renders all content in correct order', () => {
    const { container } = render(<Bulletin />);
    const bulletinContainer = container.querySelector('.bulletin-container');
    const children = bulletinContainer.children;
    
    expect(children).toHaveLength(4); // header + paragraph + 2 list items
    expect(children[0]).toHaveTextContent('Test Header');
    expect(children[1]).toHaveTextContent('Test paragraph content');
    expect(children[2]).toHaveTextContent('Test list item 1');
    expect(children[3]).toHaveTextContent('Test list item 2');
  });
});