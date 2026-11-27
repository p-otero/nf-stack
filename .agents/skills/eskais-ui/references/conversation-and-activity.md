# Conversation and activity log

Part of the `eskais-ui` skill.

## Conversation

```tsx
<div className="h-128">
  <Conversation label="Thread with Atlas" composer={<ConversationComposer onSend={send} placeholder="Ask Atlas" />}>
    {messages.map((m) => (
      <ConversationMessage
        key={m.id}
        messageId={m.id}
        from={m.from}
        author={m.from === "assistant" ? "Atlas" : undefined}
        avatar={m.from === "assistant" ? <AgentAvatar … /> : undefined}
        time={m.at}
        now={now}
        streaming={m.streaming}
      >
        {m.text}
      </ConversationMessage>
    ))}
  </Conversation>
</div>
```

- It fills its parent: give the parent a height. The log is a named `role="log"`, so new messages are announced; don't add another live region.
- It follows the newest message while the reader is at the end, also while the last message grows as it streams. Scrolling up stops following; the pill then reads `labels.jumpToLatest`, or `labels.newBelow(count)` once messages arrive below. Pressing it scrolls back (instantly under reduced motion) and moves focus to the log.
- `from` is `user`, `assistant`, `agent`, `system` or `tool`, written as `data-from` for styling. A message without `author` is named by its role for screen readers (`labels` on the message).
- Set `streaming` while a reply arrives: the article is `aria-busy`, so screen readers read it once.
- `ConversationComposer onSend` gets the trimmed text; the field empties once it returns or its Promise resolves, unless it returns `false`. Sending jumps to the newest message. Enter sends and Shift+Enter starts a line (`submitShortcut="mod+enter"` swaps them).
- Inside a `Conversation`, `useConversation()` returns `jumpToLatest()`, `release()` and `loadOlder()`.
- Every message renders. For long threads keep the newest few hundred in state and pass `hasOlder` and `onLoadOlder`: the button keeps the view in place while the older messages are added above in one update.
- Agents read messages as the thread's items (`query({ within: label })` returns "Author: text") and call `jumpToLatest` and `loadOlder`; they send by setting the Message field and pressing Send.

## Activity log

```ts
// In the browser entry, after createAgent and before the app renders (from activity-log-store):
const log = createActivityLog(agent, { within: () => document.getElementById("workspace") })
```

```tsx
<ActivityLog log={log} label="Activity" header={<h2 className="text-title-sm">Activity</h2>} now={now} />
```

- It records changes to UI SDK controls (`value`, `checked`, `pressed` by default; `keys` changes it) from people, agents and the app's code, each with `actor` (`agent`, `person`, `app`), a `description`, `at` and the control's `row` text. Limit it with `within`: a message field's drafts are rarely worth an entry.
- `log.record({ label, description, actor, previous, value, undo, redo })` records a change to your own data, like a task an agent moved. Undo and redo should change your state, not controls.
- `log.undo()`, `redo()`, `seek(n)` (0 is the start) and `undoActor("agent")` resolve with what they couldn't put back. Restoring goes through the agent bridge, so permissions and change callbacks still apply; requests, saves and removed components are not undone, and password, card and one-time-code fields are never put back.
- The list is newest first; pressing an entry seeks to just after it, the current point has `aria-current="step"`. Undo and Redo bind Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z (listed in `ShortcutsDialog`), never inside a text field; `shortcuts={false}` for a second log.
- Agents call `undo`, `redo` and `seek` (a position or an entry's sentence). A seek back over more than `confirmAbove` entries (3) carries `data-agent-confirm`, so a person approves it.
- `undoToast(title, { log })` shows a toast whose Undo steps back before the newest change; `{ onUndo }` runs your own, like `() => log.undoActor("agent")`.
- Descriptions are UI SDK's English sentences ("Agent set Status to Done"); pass `describe` for the page's language. The underlying UI SDK history is experimental; only `ActivityLog` types appear in the API.
