import { createRoot, type Root } from "react-dom/client";
import { BranchLibraryGrid } from "@/components/player-surface/branch-library-grid";
import type { BranchLibraryListItem } from "@/lib/player-surface/branch-library-list-item";

export type BranchLibraryBridgeProps =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | {
      kind: "ok";
      items: BranchLibraryListItem[];
      selectedId: string | null;
      onSelect: (item: BranchLibraryListItem) => void;
    };

let root: Root | null = null;

export function mountBranchLibrary(container: HTMLElement): void {
  if (root) return;
  root = createRoot(container);
}

export function renderBranchLibrary(props: BranchLibraryBridgeProps): void {
  if (!root) throw new Error("mountBranchLibrary must be called first");
  if (props.kind === "idle") {
    /* Avoid root.render(null): clearer unmount semantics with react-dom in Electron. */
    root.render(<span style={{ display: "none" }} aria-hidden />);
    return;
  }
  if (props.kind === "error") {
    root.render(
      <p className="sb-lbc-error hint" style={{ margin: "0.5rem" }}>
        {props.message}
      </p>,
    );
    return;
  }
  root.render(
    <BranchLibraryGrid
      items={props.items}
      selectedId={props.selectedId}
      errorMessage={null}
      emptyMessage="No items for this branch."
      onSelect={props.onSelect}
    />,
  );
}
