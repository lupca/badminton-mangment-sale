import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Hàm có danh tính cố định nhưng luôn gọi bản mới nhất của `fn`.
 * Dùng để truyền hàm xử lý cho các dòng React.memo mà không làm chúng vẽ lại sau mỗi lần gõ.
 */
export function useStableCallback<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}
