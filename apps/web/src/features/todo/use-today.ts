import { type DueDate, localDueDate } from "@hejmly/app-todo/shared";
import { useEffect, useState } from "react";

const msUntilNextDay = (now: Date): number => {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime() + 1000;
};

export const useToday = (): DueDate => {
  const [today, setToday] = useState(() => localDueDate(new Date()));

  useEffect(() => {
    const refresh = () => setToday(localDueDate(new Date()));
    let timer = setTimeout(function tick() {
      refresh();
      timer = setTimeout(tick, msUntilNextDay(new Date()));
    }, msUntilNextDay(new Date()));
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return today;
};
