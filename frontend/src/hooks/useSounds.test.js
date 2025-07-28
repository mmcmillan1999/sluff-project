import { renderHook, act } from '@testing-library/react';
import { useSounds } from './useSounds';

describe('useSounds hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.Audio.mockClear();
  });

  test('initializes with sound disabled', () => {
    const { result } = renderHook(() => useSounds());
    const { isSoundEnabled } = result.current;
    expect(isSoundEnabled).toBe(false);
  });

  test('loads all sound files on mount', () => {
    const { result } = renderHook(() => useSounds());
    
    // Check that all sounds are loaded
    expect(global.Audio).toHaveBeenCalledTimes(5);
    expect(global.Audio).toHaveBeenCalledWith('/Sounds/turn_alert.mp3');
    expect(global.Audio).toHaveBeenCalledWith('/Sounds/card_play.mp3');
    expect(global.Audio).toHaveBeenCalledWith('/Sounds/trick_win.mp3');
    expect(global.Audio).toHaveBeenCalledWith('/Sounds/card_dealing_10s_v3.mp3');
    expect(global.Audio).toHaveBeenCalledWith('/Sounds/no_peaking_cheater.mp3');
  });

  test('enables sound when enableSound is called', () => {
    const { result } = renderHook(() => useSounds());
    
    expect(result.current.isSoundEnabled).toBe(false);
    
    act(() => {
      result.current.enableSound();
    });
    
    expect(result.current.isSoundEnabled).toBe(true);
  });

  test('disables sound when disableSound is called', () => {
    const { result } = renderHook(() => useSounds());
    
    act(() => {
      result.current.enableSound();
    });
    
    expect(result.current.isSoundEnabled).toBe(true);
    
    act(() => {
      result.current.disableSound();
    });
    
    expect(result.current.isSoundEnabled).toBe(false);
  });

  test('plays sound when enabled', () => {
    const { result } = renderHook(() => useSounds());
    
    act(() => {
      result.current.enableSound();
    });
    
    act(() => {
      result.current.playSound('turnAlert');
    });
    
    // Check that play was called on one of the Audio instances
    const audioInstances = global.Audio.mock.results.map(r => r.value);
    const playCalled = audioInstances.some(instance => instance.play.mock.calls.length > 0);
    expect(playCalled).toBe(true);
  });

  test('does not play sound when disabled', () => {
    const { result } = renderHook(() => useSounds());
    
    act(() => {
      result.current.playSound('turnAlert');
    });
    
    // Since sounds are disabled, play should not be called
    const audioInstances = global.Audio.mock.results.map(r => r.value);
    const playCalled = audioInstances.some(instance => instance.play.mock.calls.length > 0);
    expect(playCalled).toBe(false);
  });

  test('handles play error gracefully', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    
    // Create a custom Audio mock for this test that rejects play
    const originalAudio = global.Audio;
    global.Audio = jest.fn().mockImplementation((src) => ({
      src,
      currentTime: 0,
      volume: 1,
      play: jest.fn().mockRejectedValue(new Error('Play failed')),
      load: jest.fn(),
    }));
    
    const { result } = renderHook(() => useSounds());
    
    act(() => {
      result.current.enableSound();
    });
    
    await act(async () => {
      result.current.playSound('turnAlert');
    });
    
    // Wait a bit for the promise to reject
    await new Promise(resolve => setTimeout(resolve, 0));
    
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error playing turnAlert:'),
      expect.any(Error)
    );
    
    consoleErrorSpy.mockRestore();
    global.Audio = originalAudio;
  });
});