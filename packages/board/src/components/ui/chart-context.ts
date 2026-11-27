"use client"

import { createContext, use } from "react"

import type { ChartConfig } from "@/lib/chart-config"

const ChartContext = createContext<{ config: ChartConfig } | null>(null)

function useChart() {
  const context = use(ChartContext)
  if (!context) throw new Error("Chart parts must be rendered inside a <ChartContainer />")
  return context
}

export { ChartContext, useChart }
