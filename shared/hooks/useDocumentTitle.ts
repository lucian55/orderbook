'use client'

import { useEffect, useRef } from 'react'

/**
 * 同步 document.title。组件卸载时自动恢复挂载前的初始 title，
 * 避免页面切走后仍残留旧标题。
 */
export function useDocumentTitle(title: string) {
  const originalRef = useRef<string | null>(null)

  useEffect(() => {
    if (originalRef.current === null) {
      originalRef.current = document.title
    }
    document.title = title
  }, [title])

  useEffect(() => {
    return () => {
      if (originalRef.current !== null) {
        document.title = originalRef.current
      }
    }
  }, [])
}
