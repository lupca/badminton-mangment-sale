// Điều hướng bằng hash (#/programs/abc) — không cần cấu hình máy chủ, tải lại trang vẫn giữ đúng màn hình.
import React, { useMemo, useSyncExternalStore } from "react";

function currentHash(): string {
  const hash = window.location.hash.replace(/^#/, "");
  return hash.startsWith("/") ? hash : "/";
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

export interface Route {
  path: string; // vd "/programs/abc" (không gồm phần ?query)
  parts: string[]; // vd ["programs", "abc"]
  query: URLSearchParams; // vd #/orders?program=abc → query.get("program") === "abc"
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, currentHash);
  return useMemo(() => {
    const at = hash.indexOf("?");
    const path = at >= 0 ? hash.slice(0, at) : hash;
    return {
      path,
      parts: path.split("/").filter(Boolean).map(decodeURIComponent),
      query: new URLSearchParams(at >= 0 ? hash.slice(at + 1) : ""),
    };
  }, [hash]);
}

/** Chuyển màn hình, vd navigate("/orders/abc"). `replace` = không thêm vào lịch sử trình duyệt. */
export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace) {
    window.location.replace(`#${to}`);
  } else {
    window.location.hash = to;
  }
  window.scrollTo(0, 0);
}

/** Liên kết nội bộ, vd <Link to="/programs">. */
export function Link({
  to,
  children,
  ...rest
}: { to: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <a href={`#${to}`} {...rest}>
      {children}
    </a>
  );
}

/**
 * Trạng thái của một danh sách (ô tìm, bộ lọc, sắp xếp, trang) giữ trong phần ?query của địa chỉ trang,
 * để tải lại hoặc gửi đường dẫn vẫn giữ nguyên chỗ đang xem.
 * Trạng thái nằm trong React trước rồi mới ghi lên địa chỉ (history.replaceState, không thêm lịch sử),
 * nên gõ phím không bị chậm. Địa chỉ đổi từ bên ngoài (bấm liên kết, nút Lùi) thì nhận giá trị mới.
 * Giá trị bằng mặc định thì không ghi lên địa chỉ cho gọn.
 */
export function useQueryState<T extends Record<string, string>>(
  defaults: T,
): [T, (patch: Partial<T>) => void] {
  const route = useRoute();
  const queryText = route.query.toString();
  const fromUrl = (): T => {
    const out = { ...defaults };
    for (const key of Object.keys(defaults) as Array<keyof T & string>) {
      const value = route.query.get(key);
      if (value !== null) out[key] = value as T[typeof key];
    }
    return out;
  };
  const [state, setState] = React.useState<T>(fromUrl);
  // Chuỗi query do chính hook này ghi gần nhất; hashchange không xảy ra với replaceState,
  // nhưng nếu trang khác cùng đường dẫn đổi địa chỉ thì nhận lại từ địa chỉ.
  const written = React.useRef(queryText);
  React.useEffect(() => {
    if (queryText !== written.current) {
      written.current = queryText;
      setState(fromUrl());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryText]);

  const update = React.useCallback(
    (patch: Partial<T>) => {
      setState((prev) => {
        const next = { ...prev, ...patch };
        const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
        for (const key of Object.keys(defaults)) {
          const value = next[key];
          if (value === undefined || value === defaults[key]) params.delete(key);
          else params.set(key, value);
        }
        const text = params.toString();
        written.current = text;
        const path = currentHash().split("?")[0];
        window.history.replaceState(window.history.state, "", `#${path}${text ? `?${text}` : ""}`);
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return [state, update];
}
