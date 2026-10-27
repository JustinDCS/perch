import "./styles.css";
import { mountApp } from "./ui/app";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

mountApp(root).catch((err: unknown) => {
  root.textContent = `Perch could not start: ${err instanceof Error ? err.message : String(err)}`;
});
