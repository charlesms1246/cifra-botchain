"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { BOOKS, bookByKey, defaultBook, type Book } from "./books";

/** Book selection, mirrored into ?book= so a link carries which book it refers to. */
export function useBook(): [Book, (b: Book) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [fallback, setFallback] = useState<Book>(defaultBook);

  const current = params.get("book") ? bookByKey(params.get("book")!) : fallback;

  const set = useCallback(
    (b: Book) => {
      setFallback(b);
      const next = new URLSearchParams(Array.from(params.entries()));
      next.set("book", b.key);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router]
  );

  return [BOOKS.some((b) => b.key === current.key) ? current : defaultBook, set];
}
