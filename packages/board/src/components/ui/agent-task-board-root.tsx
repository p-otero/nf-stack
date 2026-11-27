"use client"

import { createParts } from "@ui-sdk/react/primitive"
import type { ComponentProps } from "react"

import {
  agentTaskBoard,
  createAgentTaskBoardController,
  type AgentTaskBoardOptions,
} from "@/components/ui/agent-task-board-primitive"
import { agentTaskMoves } from "@/components/ui/agent-task-moves-primitive"
import { agentTaskProposals } from "@/components/ui/agent-task-proposals-primitive"

const { Root: BoardRoot } = createParts(agentTaskBoard, { root: "div" })
const { Root: AgentTaskProposalsRoot } = createParts(agentTaskProposals, { root: "div" })
const { Root: AgentTaskMovesRoot } = createParts(agentTaskMoves, { root: "div" })

type AgentTaskBoardRootProps = Omit<ComponentProps<typeof BoardRoot>, "onSelectedTaskIdChange"> & {
  onSelectTask?: AgentTaskBoardOptions["onSelectedTaskIdChange"]
}

function AgentTaskBoardRoot({ onSelectTask, ...props }: AgentTaskBoardRootProps) {
  return <BoardRoot onSelectedTaskIdChange={onSelectTask} {...props} />
}

export { AgentTaskBoardRoot, AgentTaskMovesRoot, AgentTaskProposalsRoot, createAgentTaskBoardController }
export type { AgentTaskBoardRootProps }
