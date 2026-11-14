import { useEffect, useState } from 'react';

interface LoadState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// Small hook around the cached loaders in data.ts.
export function useData<T>(loader: () => Promise<T>, deps: unknown[] = []): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ data: null, loading: true, error: null });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    loader()
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((e: unknown) =>
        alive &&
        setState({
          data: null,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        })
      );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
