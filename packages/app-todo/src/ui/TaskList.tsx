import type { ReactElement } from "react";
import { isDone, type SyncState, type Task, type TaskId } from "../shared/index.ts";
import { TaskRow, type TaskRowHandlers } from "./TaskRow.tsx";

type TaskListProps = {
  tasks: readonly Task[];
  syncStateOf: (id: TaskId) => SyncState;
  handlersFor: (id: TaskId) => TaskRowHandlers;
};

export const TaskList = ({ tasks, syncStateOf, handlersFor }: TaskListProps): ReactElement => {
  const open = tasks.filter((t) => !isDone(t.status));
  const done = tasks.filter((t) => isDone(t.status));
  const row = (task: Task): ReactElement => (
    <TaskRow key={task.id} task={task} syncState={syncStateOf(task.id)} {...handlersFor(task.id)} />
  );

  return (
    <div className="flex-1 overflow-y-auto bg-white pb-24">
      {open.length === 0 ? (
        <p className="px-5 pt-6 pb-2 text-center text-slate-500 text-sm">
          Everything here is done.
        </p>
      ) : (
        <ul aria-label="Open tasks" className="divide-y divide-slate-100">
          {open.map(row)}
        </ul>
      )}
      {done.length > 0 && (
        <>
          <h2 className="bg-white px-5 pt-5 pb-2 font-semibold text-[11px] text-slate-600 uppercase tracking-[0.12em]">
            {`Done · ${done.length}`}
          </h2>
          <ul aria-label="Done tasks" className="divide-y divide-slate-100">
            {done.map(row)}
          </ul>
        </>
      )}
    </div>
  );
};
