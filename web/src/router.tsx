import type { ComponentChildren } from "preact";
import { createStore } from "./store";

export const path = createStore(location.pathname);

export function navigate(to: string): void {
  if (to === location.pathname) return;
  history.pushState(null, "", to);
  path.set(to);
}

window.addEventListener("popstate", () => path.set(location.pathname));

export function Link(props: { href: string; class?: string; children: ComponentChildren; "aria-current"?: "page" }) {
  return (
    <a
      {...props}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let the browser open new tabs
        e.preventDefault();
        navigate(props.href);
      }}
    />
  );
}
