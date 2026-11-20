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
