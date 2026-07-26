import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MeritMobile } from "./components/MeritMobile";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MeritMobile />
  </StrictMode>,
);
