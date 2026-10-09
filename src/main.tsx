import { Board } from "./Board";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { TeamDesk } from "./TeamDesk";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get("view") === "team" ? (
      <TeamDesk />
    ) : new URLSearchParams(window.location.search).get("view") === "checks" ? (
      <App />
    ) : (
      <Board />
    )}
  </React.StrictMode>,
);
