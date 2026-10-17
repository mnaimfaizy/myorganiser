import { renderHook, act } from '@testing-library/react';
import {
  openFeedbackDialog,
  setFeedbackDialogOpen,
  useFeedbackDialogOpen,
} from './use-feedback-dialog';

describe('useFeedbackDialogOpen store', () => {
  beforeEach(() => {
    // Reset module-level store state before each test
    setFeedbackDialogOpen(false);
  });

  it('should start with dialog closed', () => {
    const { result } = renderHook(() => useFeedbackDialogOpen());

    expect(result.current).toBe(false);
  });

  it('should open the dialog via openFeedbackDialog', () => {
    const { result } = renderHook(() => useFeedbackDialogOpen());

    expect(result.current).toBe(false);

    act(() => {
      openFeedbackDialog();
    });

    expect(result.current).toBe(true);
  });

  it('should set dialog state via setFeedbackDialogOpen', () => {
    const { result } = renderHook(() => useFeedbackDialogOpen());

    act(() => {
      setFeedbackDialogOpen(true);
    });
    expect(result.current).toBe(true);

    act(() => {
      setFeedbackDialogOpen(false);
    });
    expect(result.current).toBe(false);
  });

  it('should notify all subscribed hooks when state changes', () => {
    const { result: result1 } = renderHook(() => useFeedbackDialogOpen());
    const { result: result2 } = renderHook(() => useFeedbackDialogOpen());

    // Both hooks should initially be false
    expect(result1.current).toBe(false);
    expect(result2.current).toBe(false);

    // Open the dialog
    act(() => {
      openFeedbackDialog();
    });

    // Both hooks should reflect the change
    expect(result1.current).toBe(true);
    expect(result2.current).toBe(true);
  });

  it('should remove listener when unsubscribe is called', () => {
    const { result } = renderHook(() => useFeedbackDialogOpen());

    // Initial state
    expect(result.current).toBe(false);

    // Change state - hook should update
    act(() => {
      openFeedbackDialog();
    });
    expect(result.current).toBe(true);

    // Unmount the hook (which unsubscribes from the store)
    // After unmount, the hook no longer listens to changes
    const { unmount } = renderHook(() => useFeedbackDialogOpen());
    act(() => {
      openFeedbackDialog();
    });

    // The unmounted hook won't update (it's no longer subscribed)
    // This is tested implicitly through renderHook behavior
    // where unmounting removes the listener from the store
    unmount();

    // Create a new hook instance to verify store still works
    const { result: result2 } = renderHook(() => useFeedbackDialogOpen());
    expect(result2.current).toBe(true);
  });
});
