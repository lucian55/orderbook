'use client'

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

/**
 * 捕获子树的渲染异常，展示降级 UI，防止整个页面白屏。
 * React error boundary 必须用 class 组件实现。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-[#131B29] text-[#F0F4F8] w-72 flex items-center justify-center h-[300px] text-sm text-[#8698aa]">
          Something went wrong. Please refresh the page.
        </div>
      )
    }
    return this.props.children
  }
}
